/**
 * SystemPromptBuilder — 构建企业级系统提示
 *
 * 负责为每次对话生成 extraSystemPrompt。
 * 只注入引擎不知道的企业级信息（用户、工作区、Agent 列表、DB 连接、Skills）。
 * 工具权限由引擎 tools.allow/deny/profile 硬执行，不在 prompt 中重复描述。
 *
 * 包含 (userId, agentId) 维度的缓存，TTL 5 分钟。
 */

import type { WorkspaceManager } from '@octopus/workspace';
import { getSkillsForUser, buildSkillsSystemPromptSection } from './SkillsInfo';

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
  prisma?: any,
): Promise<string> {
  if (!prisma || !Array.isArray(allowedConnections) || allowedConnections.length === 0) return '';
  try {
    const dbConns = await prisma.databaseConnection.findMany({
      where: { userId, enabled: true },
      select: { name: true, dbType: true, host: true, port: true, dbName: true, dbUser: true },
    });
    const filtered = dbConns.filter((c: { name: string }) => allowedConnections.includes(c.name));
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

/** 构建企业级额外系统提示（注入到原生 extraSystemPrompt） */
export async function buildEnterpriseSystemPrompt(
  user: { id: string; username: string; displayName?: string },
  agent: any | null,
  deps: {
    prisma?: any;
    workspaceManager: WorkspaceManager;
    dataRoot: string;
  },
): Promise<string> {
  // 缓存命中检查
  const cacheKey = `${user.id}:${agent?.id || 'default'}`;
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) return cached.prompt;

  const { prisma, workspaceManager, dataRoot } = deps;
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

  // ── Agent 指令 ──
  if (agent?.systemPrompt) {
    sections.push(`## Agent 指令\n${agent.systemPrompt}`);
  }

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

  // ── Skills 注入（按白名单过滤） ──
  if (prisma) {
    try {
      let skills = await getSkillsForUser(user.id, prisma, dataRoot);
      const sf = agent?.skillsFilter;
      if (!Array.isArray(sf) || sf.length === 0) {
        skills = [];
      } else {
        skills = skills.filter(s => sf.includes(s.name) || sf.includes(s.id));
      }
      const skillsSection = buildSkillsSystemPromptSection(skills);
      if (skillsSection) sections.push(skillsSection);
    } catch { /* ignore */ }
  }

  // ── DB 连接名（MCP SQL 工具需要） ──
  const dbSection = await buildDbConnectionsSection(
    user.id,
    agent?.allowedConnections as string[] | null | undefined,
    prisma,
  );
  if (dbSection) sections.push(dbSection);

  // ── 定时提醒 ──
  sections.push(
    `## 定时提醒\n` +
    `设置提醒或定时任务请使用 cron 工具。\n` +
    `示例：cron add，schedule.kind="at"，payload.kind="systemEvent"。`
  );

  const result = sections.join('\n\n');
  promptCache.set(cacheKey, { prompt: result, ts: Date.now() });
  return result;
}
