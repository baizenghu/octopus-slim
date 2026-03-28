/**
 * SystemPromptBuilder — 构建企业级系统提示
 *
 * 负责为每次对话生成 extraSystemPrompt。
 * 只注入引擎不知道的企业级信息（用户、工作区、Agent 列表、DB 连接）。
 * 工具权限由引擎 tools.allow/deny/profile 硬执行，不在 prompt 中重复描述。
 *
 * 包含 (userId, agentId) 维度的缓存，TTL 5 分钟。
 */

import type { WorkspaceManager } from '@octopus/workspace';
import type { AppPrismaClient } from '../types/prisma';

// ── 缓存 ──────────────────────────────────────────────────────────
const promptCache = new Map<string, { prompt: string; ts: number }>();
const PROMPT_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

/** 清除指定用户的所有 prompt 缓存（agent 配置变更时调用） */
export function invalidatePromptCache(userId: string) {
  for (const [key] of promptCache) {
    if (key.startsWith(userId)) promptCache.delete(key);
  }
}

// ── DB 连接名注入 ─────────────────────────────────────────────────

/** 注入 agent 可用的数据库连接名（MCP SQL 工具需要 connection_name 参数） */
async function buildDbConnectionsSection(
  userId: string,
  allowedConnections: string[] | null | undefined,
  prisma?: AppPrismaClient,
): Promise<string> {
  if (!prisma || !Array.isArray(allowedConnections) || allowedConnections.length === 0) return '';
  try {
    const dbConns = await prisma.databaseConnection.findMany({
      where: { userId, enabled: true },
      select: { name: true, dbType: true, host: true, port: true, dbName: true, dbUser: true },
    });
    const filtered = dbConns.filter((c) => allowedConnections.includes(c.name));
    if (filtered.length === 0) return '';

    const lines = [
      '## 数据库连接',
      '调用 SQL 相关工具时需要传入 connection_name 参数：',
      '',
    ];
    for (const c of filtered) {
      lines.push(`- \`${c.name}\`：${c.dbType} \`${c.dbName}\`@${c.host}:${c.port} (user: ${c.dbUser})`);
    }
    return lines.join('\n');
  } catch {
    return '';
  }
}

// ── 主函数 ────────────────────────────────────────────────────────

/** Agent 基本信息（从 Prisma 查询结果中需要的字段） */
interface AgentInfo {
  id?: string;
  name?: string;
  systemPrompt?: string | null;
  allowedConnections?: string[] | null;
  identity?: unknown;
}

/** 构建企业级额外系统提示（注入到原生 extraSystemPrompt） */
export async function buildEnterpriseSystemPrompt(
  user: { id: string; username: string; displayName?: string },
  agent: AgentInfo | null,
  deps: {
    prisma?: AppPrismaClient;
    workspaceManager: WorkspaceManager;
    dataRoot: string;
  },
): Promise<string> {
  // 缓存命中检查
  const cacheKey = `${user.id}:${agent?.id || 'default'}`;
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) return cached.prompt;

  const { prisma, workspaceManager } = deps;
  const sections: string[] = [];

  // ── 身份 ──
  if (!agent || agent.name === 'default') {
    sections.push(
      `## 你的身份\n` +
      `你是 Octopus AI 企业级超级智能助手，是用户 ${user.displayName || user.username} 的主助手。\n` +
      `自我介绍时只说"我是 Octopus AI"，不要说"Octopus AI AI 助手"或其他重复 AI 的表述。`
    );
  }

  // ── 用户信息 ──
  sections.push(`## 用户信息\n当前用户: ${user.username}${user.displayName ? ` (${user.displayName})` : ''}`);

  // ── 工作区 ──
  try {
    const workspacePath = workspaceManager.getSubPath(user.id, 'WORKSPACE');
    const filesPath = workspaceManager.getSubPath(user.id, 'FILES');
    const outputsPath = workspaceManager.getSubPath(user.id, 'OUTPUTS');
    const tempPath = workspaceManager.getSubPath(user.id, 'TEMP');
    sections.push(
      `## 工作区\n` +
      `工作空间根目录: ${workspacePath}\n` +
      `用户上传文件: ${filesPath}\n` +
      `用户可下载文件: ${outputsPath}\n` +
      `临时工作目录: ${tempPath}\n\n` +
      `**文件管理规范：**\n` +
      `- files/：用户上传的文件，只读取不修改\n` +
      `- outputs/：交付给用户的成果文件。系统会**自动**将 outputs/ 中的新文件发送给用户（包括 IM 渠道）\n` +
      `- temp/：中间产物（脚本、临时数据、草稿）写入此目录\n` +
      `- 不要在工作空间根目录直接创建文件`
    );
  } catch { /* ignore */ }

  // Agent 行为准则由引擎从 workspace/SOUL.md 原生读取，不在 extraSystemPrompt 中重复注入
  // systemPrompt 字段仅作 DB 备份，不再注入到 prompt

  // ── 专业 Agent 列表（仅 default agent） ──
  if ((!agent || agent.name === 'default') && prisma) {
    try {
      const specialists = await prisma.agent.findMany({
        where: { ownerId: user.id, enabled: true, isDefault: false },
        select: { name: true, description: true, identity: true },
        orderBy: { createdAt: 'asc' },
      });
      if (specialists.length > 0) {
        const list = specialists.map((a: { name: string; description: string | null; identity: unknown }) => {
          const identity = a.identity as { name?: string } | null;
          const displayName = identity?.name || a.name;
          const desc = a.description ? ` — ${a.description}` : '';
          return `- **${displayName}**（agent 名称: ${a.name}）${desc}`;
        }).join('\n');
        sections.push(
          `## 可委派的专业 Agent\n` +
          `以下是用户创建的专业 Agent，可在需要时委派任务。\n${list}`
        );
      }
    } catch { /* ignore */ }
  }


  // ── DB 连接名（MCP SQL 工具需要） ──
  const dbSection = await buildDbConnectionsSection(
    user.id,
    agent?.allowedConnections,
    prisma,
  );
  if (dbSection) sections.push(dbSection);

  // ── 定时提醒 ──
  sections.push(
    `## 定时提醒\n` +
    `设置提醒或定时任务请使用 cron 工具。\n` +
    `**必须使用** sessionTarget="isolated"，payload.kind="agentTurn"，delivery.mode="none"。\n` +
    `提醒送达：在 payload.message 中指示 agent 用 send_im_message 发送通知。\n` +
    `示例：cron add，job={ "schedule": { "kind": "at", "at": "<ISO时间>" }, "sessionTarget": "isolated", "payload": { "kind": "agentTurn", "message": "你是提醒助手。请立即用 send_im_message 向用户发送提醒：xxx" }, "delivery": { "mode": "none" } }\n` +
    `**禁止** sessionTarget="main"、payload.kind="systemEvent"、delivery.mode="announce"，均会报错。`
  );

  const result = sections.join('\n\n');
  promptCache.set(cacheKey, { prompt: result, ts: Date.now() });
  return result;
}
