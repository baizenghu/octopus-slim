/**
 * SystemPromptBuilder — 构建企业级系统提示
 *
 * 从 chat.ts 提取的独立模块，负责为每次对话生成 extraSystemPrompt。
 * 包含 (userId, agentId) 维度的缓存，TTL 5 分钟。
 */

import * as fs from 'fs';
import * as path from 'path';
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

// ── MCP 工具段落 ──────────────────────────────────────────────────

/** 读取 enterprise-mcp 插件写入的工具缓存，生成供 agent 使用的 MCP 工具说明 */
async function buildMCPToolsSection(
  mcpFilter: string[] | null | undefined,
  userId: string | undefined,
  allowedConnections: string[] | null | undefined,
  prisma?: any,
): Promise<string> {
  // null 或 [] = 全部禁用，不注入任何 MCP 工具
  if (!Array.isArray(mcpFilter) || mcpFilter.length === 0) return '';

  const ocHome = process.env['OCTOPUS_HOME'] || path.join(process.env['HOME'] || '/tmp', '.octopus-enterprise');
  const cachePath = path.join(ocHome, 'plugins/enterprise-mcp/tools-cache.json');
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    let tools: Array<{
      serverId: string;
      serverName: string;
      toolName: string;
      nativeToolName: string;
      description: string;
    }> = JSON.parse(raw);
    if (tools.length === 0) return '';

    // 按 mcpFilter 白名单过滤
    tools = tools.filter(t => mcpFilter.includes(t.serverId));
    if (tools.length === 0) return '';

    // 按 server 分组
    const byServer = new Map<string, typeof tools>();
    for (const t of tools) {
      if (!byServer.has(t.serverName)) byServer.set(t.serverName, []);
      byServer.get(t.serverName)!.push(t);
    }

    const lines: string[] = [
      '## 可用 MCP 外部工具',
      '你已接入以下企业 MCP 外部工具，可**直接 function call**（无需查找配置文件、无需安装软件）：',
      '',
    ];
    for (const [serverName, serverTools] of byServer) {
      lines.push(`**${serverName}**`);
      for (const t of serverTools) {
        lines.push(`- \`${t.nativeToolName}\`：${t.description}`);
      }
      lines.push('');
    }
    // 注入数据库连接名（从 DB 读取，按 allowedConnections 白名单过滤）
    try {
      if (prisma && userId) {
        const dbConns = await prisma.databaseConnection.findMany({
          where: { userId, enabled: true },
          select: { name: true, dbType: true, host: true, port: true, dbName: true },
        });
        // 按 agent 的 allowedConnections 白名单过滤
        const filtered = (!Array.isArray(allowedConnections) || allowedConnections.length === 0)
          ? [] // null/[] = 全部禁用
          : dbConns.filter((c: { name: string }) => allowedConnections.includes(c.name));
        if (filtered.length > 0) {
          lines.push(`**数据库连接名**（调用包含 list_tables / execute_sql / describe_table 的工具时需要传入 connection_name）：`);
          for (const c of filtered) {
            lines.push(`- \`${c.name}\`：${c.dbType} 数据库 \`${c.dbName}\`@${c.host}:${c.port}`);
          }
          lines.push('');
        }
      }
    } catch {
      // DB 查询失败时忽略
    }
    lines.push('调用上述工具时请直接传入参数，**不要尝试用 shell/Python 脚本绕道查询**。');

    return lines.join('\n');
  } catch {
    return '';  // 缓存文件不存在时静默跳过（首次启动）
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

  // default agent 需要明确的身份声明，防止与专业 agent 身份混淆
  if (!agent || agent.name === 'default') {
    sections.push(
      `## 你的身份\n` +
      `你是 Octopus AI 企业级超级智能助手，是用户 ${user.displayName || user.username} 的主助手。\n` +
      `自我介绍时只说"我是 Octopus AI"，不要说"Octopus AI AI 助手"或其他重复 AI 的表述。\n` +
      `你不是任何专业 Agent，你是通用型主助手，负责处理用户的各种请求。`
    );
  }

  sections.push(`## 用户信息\n当前用户: ${user.username}${user.displayName ? ` (${user.displayName})` : ''}`);

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
      `**文件管理规范（必须遵守）：**\n` +
      `- files/：用户上传的文件，只读取不修改\n` +
      `- outputs/：需要交付给用户的最终成果文件（报告、文档等）\n` +
      `- temp/：你的中间产物（脚本、临时数据、草稿等）必须写入此目录\n` +
      `- 严禁在工作空间根目录直接创建文件\n\n` +
      `**安全约束（必须遵守）：**\n` +
      `- 所有文件读写操作只能在 ${workspacePath} 目录内进行\n` +
      `- 严禁访问、读取或修改该目录之外的任何文件或目录\n` +
      `- 严禁访问其他用户的目录或系统敏感文件（如 /etc/passwd、~/.ssh 等）\n` +
      `- Shell 命令在沙箱容器内执行，可以使用 exec 工具运行命令`
    );
  } catch { /* ignore */ }

  if (agent?.systemPrompt) {
    sections.push(`## Agent 指令\n${agent.systemPrompt}`);
  }

  // 只有主 agent（default）有任务委派权限，其他 agent 不注入专业 agent 列表
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
          `以下是用户创建的专业 Agent，它们各自专注于特定领域。` +
          `你可以在需要时将任务委派给它们，但你自己不是这些 Agent 中的任何一个。\n${list}`
        );
      }
    } catch { /* ignore */ }
  }

  // 注入企业 Skill 和个人 Skill 的操作指南（从数据库读取已启用技能，嵌入 SKILL.md）
  // 权限逻辑：null/[] = 全部禁用（Switch 关闭），有值数组 = 白名单（Switch 开启）
  if (prisma) {
    try {
      let skills = await getSkillsForUser(user.id, prisma, dataRoot);
      const sf = agent?.skillsFilter;
      if (!Array.isArray(sf) || sf.length === 0) {
        skills = []; // null 或 [] → 全部禁用
      } else {
        skills = skills.filter(s => sf.includes(s.name) || sf.includes(s.id));
      }
      const skillsSection = buildSkillsSystemPromptSection(skills);
      if (skillsSection) sections.push(skillsSection);
    } catch { /* ignore */ }
  }

  // 注入 MCP 工具说明
  // 权限逻辑：null/[] = 全部禁用，有值数组 = 白名单
  const mcpSection = await buildMCPToolsSection(agent?.mcpFilter as string[] | null | undefined, user.id, agent?.allowedConnections as string[] | null | undefined, prisma);
  if (mcpSection) sections.push(mcpSection);

  // 工作空间工具权限（按组描述，避免暴露内部工具名）
  // 权限逻辑：null/[] = 全部禁用，有值数组 = 白名单
  const tf = agent?.toolsFilter;
  const TOOL_GROUPS = [
    { group: 'read', label: '文件读取', tools: ['list_files', 'read_file'] },
    { group: 'write', label: '文件写入', tools: ['write_file'] },
    { group: 'exec', label: '命令执行', tools: ['execute_command', 'search_files'] },
  ];

  const enabledTools = new Set(tf || []);
  const allowedGroups = TOOL_GROUPS.filter(g => g.tools.some(t => enabledTools.has(t)));
  const blockedGroups = TOOL_GROUPS.filter(g => !g.tools.some(t => enabledTools.has(t)));

  if (!Array.isArray(tf) || tf.length === 0) {
    sections.push(
      `## 工作空间工具限制\n\n` +
      `你**没有**任何工作空间工具的权限。严禁使用文件读取、文件写入、命令执行工具。` +
      `如果用户要求操作文件或执行命令，请说明你没有该权限。`
    );
  } else if (blockedGroups.length > 0) {
    const allowed = allowedGroups.map(g => g.label).join('、');
    const blocked = blockedGroups.map(g => g.label).join('、');
    sections.push(
      `## 工作空间工具限制\n\n` +
      `你**仅**被授权使用以下工具组：${allowed}。\n` +
      `严禁使用以下工具组：${blocked}。如果用户要求使用受限工具，请说明你没有该权限。`
    );
  }

  // MCP 兜底提示
  const mf = agent?.mcpFilter;
  if (!Array.isArray(mf) || mf.length === 0) {
    sections.push(
      `## MCP 工具限制\n\n` +
      `你**没有**任何 MCP 外部工具的权限。不要声称自己能使用数据库、邮件或其他外部工具。` +
      `如果用户要求使用这些工具，请说明你没有该权限。`
    );
  } else {
    sections.push(
      `## MCP 工具限制\n\n` +
      `你仅被授权使用以下 MCP 服务器的工具：${mf.join(', ')}。` +
      `其他 MCP 服务器的工具对你不可见。`
    );
  }

  sections.push(
    `## 定时提醒\n` +
    `如果用户要求在指定时间后提醒某件事，请在回复末尾（单独一行）加入以下标签，并告知用户提醒已设置：\n` +
    `<enterprise-reminder delay_seconds="180" message="提醒内容" />\n\n` +
    `其中 delay_seconds 为距当前时刻的秒数。`
  );

  // 数据库连接信息注入到系统提示（从 DB 读取）
  try {
    if (prisma) {
      const dbConnections = await prisma.databaseConnection.findMany({
        where: { userId: user.id, enabled: true },
      });
      if (dbConnections.length > 0) {
        const dbEnvLines = dbConnections.flatMap((c: any) => [
          `DB_${c.name}_TYPE=${c.dbType}`,
          `DB_${c.name}_HOST=${c.host}`,
          `DB_${c.name}_PORT=${c.port}`,
          `DB_${c.name}_USER=${c.dbUser}`,
          // 安全：密码不注入 prompt，通过环境变量传递给 MCP 工具进程
          `DB_${c.name}_DATABASE=${c.dbName}`,
        ]);
        sections.push(`## 数据库连接\n${dbEnvLines.join('\n')}`);
      }
    }
  } catch { /* ignore */ }

  const result = sections.join('\n\n');

  // 写入缓存
  promptCache.set(cacheKey, { prompt: result, ts: Date.now() });

  return result;
}
