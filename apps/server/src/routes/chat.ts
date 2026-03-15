/**
 * 对话路由 — Native Bridge 版本
 *
 * POST /api/chat                              - 发送消息（非流式）
 * POST /api/chat/stream                       - 发送消息（SSE 流式）
 * GET  /api/chat/models                       - 获取可用模型列表
 * GET  /api/chat/sessions                     - 列出用户会话
 * PUT  /api/chat/sessions/:id/title           - 重命名会话
 * POST /api/chat/sessions/:id/generate-title  - 兼容占位（原生 agent 自动标注）
 * GET  /api/chat/search?q=keyword             - 搜索历史消息（暂不支持）
 * GET  /api/chat/history/:sessionId           - 获取完整会话历史
 * GET  /api/chat/export/:sessionId            - 导出会话（暂不支持）
 * DELETE /api/chat/history/:sessionId         - 清除会话
 *
 * 所有 AI 对话委托 Native Octopus Gateway（通过 EngineAdapter WebSocket RPC）
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { GatewayConfig } from '../config';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { Role, type AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import type { AuditLogger } from '@octopus/audit';
import { EngineAdapter } from '../services/EngineAdapter';
import { getSoulTemplate, getMemoryTemplate } from '../services/SoulTemplate';
import type { QuotaManager } from '@octopus/quota';

import { validateSessionOwnership } from '../utils/ownership';
import { getSkillsForUser, buildSkillsSystemPromptSection } from '../services/SkillsInfo';

/** Session 级偏好存储（进程级，重启清空） */
const sessionPrefs = new Map<string, { mcpId?: string; skillId?: string }>();

/** Session 级已计量 Token 总数缓存（用于增量计费，重启归零，上限 2000 条） */
const sessionTokens = new Map<string, number>();
const SESSION_TOKENS_MAX = 2000;
function setSessionTokens(key: string, value: number) {
  sessionTokens.delete(key); // 重新插入以保持 Map 顺序
  sessionTokens.set(key, value);
  if (sessionTokens.size > SESSION_TOKENS_MAX) {
    const oldest = sessionTokens.keys().next().value;
    if (oldest !== undefined) sessionTokens.delete(oldest);
  }
}

export function createChatRouter(
  _config: GatewayConfig,
  authService: AuthService,
  workspaceManager: WorkspaceManager,
  bridge: EngineAdapter | undefined,
  prisma?: any,
  auditLogger?: AuditLogger,
  _reminderCache?: unknown,
  quotaManager?: QuotaManager,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);

  /**
   * 斜杠命令处理器
   * 返回 null 表示不是斜杠命令
   * 返回 { reply } 表示纯斜杠命令，直接返回结果
   * 返回 { reply, passthrough } 表示设置偏好后，passthrough 作为正常消息继续处理
   */
  async function handleSlashCommand(
    message: string,
    userId: string,
    sessionId: string,
    agent?: { mcpFilter?: string[] | null; skillsFilter?: string[] | null } | null,
  ): Promise<{ reply: string; passthrough?: string } | null> {
    if (!message.startsWith('/')) return null;

    const trimmed = message.trim();
    const spaceIdx = trimmed.indexOf(' ');
    const cmd = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
    const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    switch (cmd) {
      case '/help':
        return { reply: [
          '**可用命令：**',
          '- `/help` — 显示此帮助信息',
          '- `/quota` — 查看当前配额使用情况',
          '- `/mcp <名称> [问题]` — 使用指定 MCP 工具（可直接附带问题）',
          '- `/skill <名称> [问题]` — 使用指定 Skill（可直接附带问题）',
        ].join('\n') };

      case '/quota': {
        if (!quotaManager) return { reply: '配额系统未启用' };
        try {
          const usage = await quotaManager.getUsage(userId);
          return { reply: [
            '**当前配额使用情况：**',
            `- 今日 Token: ${usage.tokenDaily} / ${usage.limits.token_daily === -1 ? '无限制' : usage.limits.token_daily}`,
            `- 本月 Token: ${usage.tokenMonthly} / ${usage.limits.token_monthly === -1 ? '无限制' : usage.limits.token_monthly}`,
            `- 本小时请求: ${usage.requestHourly} / ${usage.limits.request_hourly === -1 ? '无限制' : usage.limits.request_hourly}`,
          ].join('\n') };
        } catch (err: any) {
          return { reply: `配额查询失败: ${err.message}` };
        }
      }

      case '/mcp': {
        const mcpParts = arg.split(/\s+/);
        const mcpArg = mcpParts[0];
        if (!mcpArg) return { reply: '用法: `/mcp <名称> [问题]` — 请指定 MCP 工具' };
        // 按 id 或 name 查找
        const mcpServer = await prisma.mCPServer.findFirst({
          where: { OR: [{ id: mcpArg }, { name: mcpArg }] },
        });
        const mcpId = mcpServer?.id || mcpArg;
        const mcpName = mcpServer?.name || mcpArg;
        // 校验 agent 的 mcpFilter 白名单（null/[] = 全部禁用，有值数组 = 白名单）
        const mcpAllow = agent?.mcpFilter as string[] | null | undefined;
        if (!Array.isArray(mcpAllow) || mcpAllow.length === 0 || (!mcpAllow.includes(mcpId) && !mcpAllow.includes(mcpName))) {
          return { reply: `当前 Agent 不允许使用 MCP 工具 \`${mcpName}\`` };
        }
        const prefs = sessionPrefs.get(sessionId) || {};
        prefs.mcpId = mcpId;
        sessionPrefs.set(sessionId, prefs);
        // 提取附带问题
        const mcpQuestion = mcpParts.slice(1).join(' ').trim();
        if (mcpQuestion) {
          return { reply: `使用 MCP: \`${mcpName}\``, passthrough: `[请使用 ${mcpName} MCP 工具完成以下任务]\n${mcpQuestion}` };
        }
        return { reply: `已设置本会话 MCP 偏好: \`${mcpName}\`，后续消息将优先使用该工具` };
      }

      case '/skill': {
        const skillParts = arg.split(/\s+/);
        const skillArg = skillParts[0];
        if (!skillArg) return { reply: '用法: `/skill <名称> [问题]` — 请指定 Skill 名称\n例如: `/skill ppt-generator 做一个PPT`' };
        // 按 id 或 name 查找（精确匹配）
        let skillRecord = await prisma.skill.findFirst({
          where: { OR: [{ id: skillArg }, { name: skillArg }] },
        });
        // 未找到时尝试模糊匹配（用户可能没写完整名称）
        if (!skillRecord) {
          skillRecord = await prisma.skill.findFirst({
            where: { OR: [
              { name: { contains: skillArg } },
              { id: { contains: skillArg } },
            ] },
          });
        }
        if (!skillRecord) {
          // 列出可用 Skill 帮助用户
          const available = await prisma.skill.findMany({ where: { enabled: true }, select: { name: true } });
          const list = available.map((s: { name: string }) => `\`${s.name}\``).join(', ');
          return { reply: `未找到 Skill \`${skillArg}\`\n\n可用 Skill: ${list || '无'}\n\n用法: \`/skill <名称> [问题]\`` };
        }
        const skillId = skillRecord.id;
        const skillName = skillRecord.name;
        // 校验 agent 的 skillsFilter 白名单（null/[] = 全部禁用，有值数组 = 白名单）
        const skillAllow = agent?.skillsFilter as string[] | null | undefined;
        if (!Array.isArray(skillAllow) || skillAllow.length === 0 || (!skillAllow.includes(skillId) && !skillAllow.includes(skillName))) {
          return { reply: `当前 Agent 不允许使用 Skill \`${skillName}\`，请联系管理员授权` };
        }
        const prefs = sessionPrefs.get(sessionId) || {};
        prefs.skillId = skillId;
        sessionPrefs.set(sessionId, prefs);
        // 提取附带问题
        const skillQuestion = skillParts.slice(1).join(' ').trim();
        if (skillQuestion) {
          // 将 skill 指令注入消息，让 agent 明确知道要使用哪个 skill
          return { reply: `使用 Skill: \`${skillName}\``, passthrough: `[请严格按照 ${skillName} skill 的操作指南执行以下任务，必须使用技能自带的脚本，禁止自行编写替代代码]\n${skillQuestion}` };
        }
        return { reply: `已设置本会话 Skill 偏好: \`${skillName}\`，后续消息将优先使用该 Skill` };
      }

      case '/lesson': {
        // 系统内置技能：直接 passthrough 给 native agent 处理
        const lessonContent = arg || '请从当前对话中提取经验教训并存入记忆系统';
        return { reply: '正在存储经验教训...', passthrough: `/lesson ${lessonContent}` };
      }

      default:
        return { reply: `未知命令: \`${cmd}\`\n输入 \`/help\` 查看可用命令` };
    }
  }

  /** SOUL 模板：从 data/templates/ 文件加载，变量替换后返回 */
  const dataRoot = _config.workspace.dataRoot;


  /** 已确认存在的 native agent 缓存，避免每次 chat 都调 RPC */
  const knownNativeAgents = new Set<string>();

  /** 确保 native gateway 中存在对应 agent，不存在时自动创建；同时配置 memory scope 隔离 */
  async function ensureNativeAgent(userId: string, agentName: string) {
    if (!bridge?.isConnected) return;
    const nativeAgentId = EngineAdapter.userAgentId(userId, agentName);

    // 内存缓存命中，跳过 RPC
    if (knownNativeAgents.has(nativeAgentId)) return;

    // 先检查引擎中是否已有该 agent
    try {
      const result = await bridge.agentsList() as any;
      const agents: any[] = result?.agents || [];
      for (const a of agents) knownNativeAgents.add(a.id);
      if (knownNativeAgents.has(nativeAgentId)) return;
    } catch {
      // agents.list 失败时 fallback 到 create
    }

    // 专业 agent 使用独立 workspace，防止文件互相覆盖（IDENTITY.md/SOUL.md 等）
    const workspacePath = agentName === 'default'
      ? workspaceManager.getSubPath(userId, 'WORKSPACE')
      : workspaceManager.getAgentWorkspacePath(userId, agentName);
    let isNewAgent = false;
    try {
      await bridge.agentsCreate({ name: nativeAgentId, workspace: workspacePath });
      isNewAgent = true;
    } catch {
      // 忽略"已存在"等错误
      knownNativeAgents.add(nativeAgentId);
    }
    // 首次创建时等待 config reload 完成，再写入默认文件
    if (isNewAgent) {
      // agents.create 触发 config 重写 → native gateway 需要 ~1s reload，等待 agent 就绪
      await new Promise(r => setTimeout(r, 2000));
      const setFileWithRetry = async (fileName: string, content: string) => {
        try {
          await bridge.agentFilesSet(nativeAgentId, fileName, content);
        } catch {
          await new Promise(r => setTimeout(r, 1500));
          await bridge.agentFilesSet(nativeAgentId, fileName, content);
        }
      };
      const soulTemplate = getSoulTemplate(dataRoot, agentName);
      await setFileWithRetry('SOUL.md', soulTemplate).catch((e) => {
        console.error(`[chat] agentFilesSet SOUL.md failed for ${nativeAgentId}:`, e.message);
      });
      await setFileWithRetry('MEMORY.md', getMemoryTemplate(dataRoot, agentName)).catch((e) => {
        console.error(`[chat] agentFilesSet MEMORY.md failed for ${nativeAgentId}:`, e.message);
      });
    }
    // memory-lancedb-pro 默认行为已提供 scope 隔离，无需显式注册
  }

  /** 加载用户的 Agent 配置 */
  async function loadAgent(userId: string, agentId?: string) {
    if (!prisma) return null;
    try {
      if (agentId) {
        return await prisma.agent.findFirst({ where: { id: agentId, ownerId: userId, enabled: true } });
      }
      return await prisma.agent.findFirst({ where: { ownerId: userId, isDefault: true, enabled: true } });
    } catch {
      return null;
    }
  }

  /** 读取 enterprise-mcp 插件写入的工具缓存，生成供 agent 使用的 MCP 工具说明 */
  async function buildMCPToolsSection(mcpFilter?: string[] | null, userId?: string, allowedConnections?: string[] | null): Promise<string> {
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

  /** 构建企业级额外系统提示（注入到原生 extraSystemPrompt） */
  async function buildEnterpriseSystemPrompt(
    user: { id: string; username: string; displayName?: string },
    agent: any | null,
  ): Promise<string> {
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
        let skills = await getSkillsForUser(user.id, prisma, _config.workspace.dataRoot);
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
    const mcpSection = await buildMCPToolsSection(agent?.mcpFilter as string[] | null | undefined, user.id, agent?.allowedConnections as string[] | null | undefined);
    if (mcpSection) sections.push(mcpSection);

    // 工作空间工具权限
    // 权限逻辑：null/[] = 全部禁用，有值数组 = 白名单
    const tf = agent?.toolsFilter;
    const allWorkspaceTools = ['list_files', 'read_file', 'write_file', 'execute_command', 'search_files'];
    if (!Array.isArray(tf) || tf.length === 0) {
      sections.push(
        `## 工作空间工具限制\n\n` +
        `你**没有**任何工作空间工具的权限。严禁使用 ${allWorkspaceTools.join(', ')} 等工具。` +
        `如果用户要求操作文件或执行命令，请说明你没有该权限。`
      );
    } else {
      const blockedTools = allWorkspaceTools.filter(t => !tf.includes(t));
      if (blockedTools.length > 0) {
        sections.push(
          `## 工作空间工具限制\n\n` +
          `你**仅**被授权使用以下工具：${tf.join(', ')}。\n` +
          `严禁使用以下工具：${blockedTools.join(', ')}。如果用户要求使用受限工具，请说明你没有该权限。`
        );
      }
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

    return sections.join('\n\n');
  }

  /**
   * 流式对话（SSE）— 通过 Native Gateway agent RPC
   */
  router.post('/stream', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const { message, sessionId: rawSessionId, agentId: reqAgentId, attachments } = req.body;

    if (!message?.trim() && (!attachments || attachments.length === 0)) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // 处理附件：保存到 agent workspace 的 files/ 目录，并将路径信息附加到消息
    const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB base64 (~7.5MB 实际文件)
    let finalMessage = message?.trim() || '';
    if (Array.isArray(attachments) && attachments.length > 0) {
      const agent = await loadAgent(user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      // 使用与 agent 一致的 workspace（default agent 用用户主 workspace，专业 agent 用独立 workspace）
      const wsRoot = agentName === 'default'
        ? workspaceManager.getSubPath(user.id, 'WORKSPACE')
        : workspaceManager.getAgentWorkspacePath(user.id, agentName);
      const filesDir = path.join(wsRoot, 'files');
      await fs.promises.mkdir(filesDir, { recursive: true });

      const savedPaths: string[] = [];
      for (const att of attachments) {
        if (!att.name || !att.content) continue;
        if (att.content.length > MAX_ATTACHMENT_SIZE) {
          res.status(413).json({ error: `附件 "${att.name}" 超过大小限制（最大 10MB）` });
          return;
        }
        const safeName = att.name.replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_');
        let targetPath = path.join(filesDir, safeName);
        // 防重名
        if (fs.existsSync(targetPath)) {
          const ext = path.extname(safeName);
          const base = path.basename(safeName, ext);
          targetPath = path.join(filesDir, `${base}_${Date.now()}${ext}`);
        }
        // 判断是文本还是 base64
        const isText = att.type?.startsWith('text/') || /\.(txt|md|csv|json|xml|yaml|yml|js|ts|py|sql|sh|log|html|css)$/i.test(att.name);
        if (isText) {
          await fs.promises.writeFile(targetPath, att.content, 'utf-8');
        } else {
          await fs.promises.writeFile(targetPath, Buffer.from(att.content, 'base64'));
        }
        // 返回相对于 workspace 的路径（agent 只能看到 workspace 内的文件）
        savedPaths.push(path.relative(wsRoot, targetPath));
      }

      if (savedPaths.length > 0) {
        const fileList = savedPaths.map(p => `- ${p}`).join('\n');
        finalMessage = `[用户上传了 ${savedPaths.length} 个文件，已保存到工作空间]\n${fileList}\n\n${finalMessage}`;
      }
    }

    // 斜杠命令拦截
    const sid0 = rawSessionId || 'tmp';
    const slashAgent = await loadAgent(user.id, reqAgentId);
    const slashResult = await handleSlashCommand(message.trim(), user.id, sid0, slashAgent);
    if (slashResult !== null) {
      if (slashResult.passthrough) {
        // 有附带问题：先发偏好提示，再用剩余文本继续走正常对话流程
        // 保留附件前缀（如果有的话）
        const attachmentPrefix = finalMessage.match(/^(\[用户上传了 \d+ 个文件，已保存到工作空间\]\n(?:- .+\n?)+\n)/);
        finalMessage = attachmentPrefix ? attachmentPrefix[1] + slashResult.passthrough : slashResult.passthrough;
      } else {
        // 纯斜杠命令：直接返回结果
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        res.write(`data: ${JSON.stringify({ content: slashResult.reply, done: false })}\n\n`);
        res.write(`data: ${JSON.stringify({ content: '', done: true, sessionId: sid0 })}\n\n`);
        res.end();
        return;
      }
    }

    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }

    // 加载 Agent 配置
    const agent = await loadAgent(user.id, reqAgentId);
    const agentName = agent?.name || 'default';
    const nativeAgentId = EngineAdapter.userAgentId(user.id, agentName);
    // 若前端传来的 sessionId 已经是完整 native session key（历史会话继续聊天），直接使用
    let sessionKey: string;
    let sid: string;
    if (rawSessionId && rawSessionId.startsWith('agent:')) {
      // 安全校验：确保 session key 属于当前用户
      if (!validateSessionOwnership(rawSessionId, user.id)) {
        res.status(403).json({ error: 'Access denied: session does not belong to current user' });
        return;
      }
      sessionKey = rawSessionId;
      sid = rawSessionId;
    } else {
      sid = rawSessionId || randomUUID().replace(/-/g, '').slice(0, 16);
      sessionKey = EngineAdapter.userSessionKey(user.id, agentName, sid);
    }

    // 确保 native gateway 有此 agent（首次对话时自动创建）
    await ensureNativeAgent(user.id, agentName);

    // 审计日志
    try {
      await (auditLogger as any)?.log?.({ userId: user.id, action: 'chat', details: { agentId: nativeAgentId, sessionId: sid } });
    } catch { /* ignore */ }

    // SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Session-Id': sessionKey,
    });

    req.setTimeout(0);
    res.setTimeout(0);

    // 流式状态标记：客户端断连后停止写入
    let streamDone = false;

    // 心跳保活
    const heartbeat = setInterval(() => {
      try { if (!streamDone) res.write(': heartbeat\n\n'); } catch { /* closed */ }
    }, 15000);
    res.on('close', () => {
      if (!streamDone) {
        streamDone = true;
        // 客户端断开连接，通知引擎终止生成
        bridge?.chatAbort(sessionKey).catch(() => {});
      }
      clearInterval(heartbeat);
    });

    // 构建企业级 extraSystemPrompt
    const extraPrompt = await buildEnterpriseSystemPrompt(user, agent);

    // 注入 session 级 skill/mcp 偏好到消息中（类似 CC 的 /skill 指令效果）
    const prefs = sessionPrefs.get(sid0);
    if (prefs && !finalMessage.startsWith('[请使用')) {
      if (prefs.skillId) {
        const skillRec = await prisma.skill.findFirst({ where: { id: prefs.skillId } });
        if (skillRec) {
          finalMessage = `[请优先使用 ${skillRec.name} skill]\n${finalMessage}`;
        }
      } else if (prefs.mcpId) {
        const mcpRec = await prisma.mCPServer.findFirst({ where: { id: prefs.mcpId } });
        if (mcpRec) {
          finalMessage = `[请优先使用 ${mcpRec.name} MCP 工具]\n${finalMessage}`;
        }
      }
    }

    // 调用原生 agent RPC（events 通过回调异步推送）
    // native data.text 是累积全量文本，prevContent 追踪已发送的部分，每次只推新增 delta
    let prevContent = '';
    let hasDelegation = false; // 是否有 sessions_spawn 委派调用
    // 思考模式：追踪已发送的 thinking / answer 文本，分离推送
    let prevThinkingSent = '';
    let prevAnswerSent = '';
    try {
      await bridge.callAgent(
        {
          message: finalMessage,
          agentId: nativeAgentId,
          sessionKey,
          extraSystemPrompt: extraPrompt,
          deliver: false,
          isAdmin: Array.isArray(user.roles) && user.roles.includes(Role.ADMIN),
        },
        (event) => {
          if (streamDone) return;
          switch (event.type) {
            case 'text_delta': {
              const fullText = event.content || '';
              prevContent = fullText;

              // 检测是否包含 <think> 标签（思考模式）
              const thinkOpenIdx = fullText.indexOf('<think>');
              if (thinkOpenIdx === -1) {
                // 普通模式：直接推送增量
                const delta = fullText.startsWith(prevAnswerSent)
                  ? fullText.slice(prevAnswerSent.length)
                  : fullText;
                prevAnswerSent = fullText;
                if (delta) {
                  res.write(`data: ${JSON.stringify({ content: delta, done: false })}\n\n`);
                }
              } else {
                // 思考模式：分离 thinking 和 answer
                const thinkCloseIdx = fullText.indexOf('</think>');
                const thinkContent = thinkCloseIdx !== -1
                  ? fullText.slice(thinkOpenIdx + 7, thinkCloseIdx)
                  : fullText.slice(thinkOpenIdx + 7);

                // 提取正文（</think> 之后，去掉 <final>/</ final> 包装）
                let answerContent = '';
                if (thinkCloseIdx !== -1) {
                  const afterThink = fullText.slice(thinkCloseIdx + 8);
                  answerContent = afterThink.replace(/<\/?final>/g, '').trim();
                }

                // 推送 thinking 增量
                const thinkDelta = thinkContent.startsWith(prevThinkingSent)
                  ? thinkContent.slice(prevThinkingSent.length)
                  : thinkContent;
                prevThinkingSent = thinkContent;
                if (thinkDelta) {
                  res.write(`data: ${JSON.stringify({ thinking: thinkDelta, done: false })}\n\n`);
                }

                // 推送 answer 增量
                const answerDelta = answerContent.startsWith(prevAnswerSent)
                  ? answerContent.slice(prevAnswerSent.length)
                  : answerContent;
                prevAnswerSent = answerContent;
                if (answerDelta) {
                  res.write(`data: ${JSON.stringify({ content: answerDelta, done: false })}\n\n`);
                }
              }
              break;
            }
            case 'tool_call':
              if (event.toolName?.includes('sessions_spawn')) hasDelegation = true;
              res.write(`data: ${JSON.stringify({ content: '', toolCall: true, tools: [event.toolName], done: false })}\n\n`);
              break;
            case 'thinking': {
              // 原生 thinking stream：直接推送思考内容增量
              const thinkText = event.content || '';
              if (thinkText) {
                const thinkDelta2 = thinkText.startsWith(prevThinkingSent)
                  ? thinkText.slice(prevThinkingSent.length)
                  : thinkText;
                prevThinkingSent = thinkText;
                if (thinkDelta2) {
                  res.write(`data: ${JSON.stringify({ thinking: thinkDelta2, done: false })}\n\n`);
                }
              }
              break;
            }
            case 'done': {
              streamDone = true;
              // Parse enterprise reminder tag from accumulated response
              // Format: <enterprise-reminder delay_seconds="180" message="..." />
              const reminderMatch = prevContent.match(
                /<enterprise-reminder\s+delay_seconds="(\d+)"\s+message="([^"]+)"\s*\/?>/
              );
              if (reminderMatch && bridge?.isConnected) {
                const delaySeconds = Math.max(1, parseInt(reminderMatch[1], 10));
                const reminderMsg = reminderMatch[2];
                const reminderId = randomUUID().replace(/-/g, '').slice(0, 16);
                const fireAt = new Date(Date.now() + delaySeconds * 1000).toISOString();
                // 使用原生 cron 持久化提醒（重启不丢失）
                bridge.cronAdd({
                  name: `ent-reminder:${user.id}:${reminderId}`,
                  agentId: nativeAgentId,
                  schedule: { kind: 'at', at: fireAt },
                  sessionTarget: 'isolated',
                  payload: { kind: 'agentTurn', message: reminderMsg },
                  deleteAfterRun: false,
                }).then(() => {
                  console.log(`[chat] Reminder scheduled via cron: ${fireAt} → "${reminderMsg}" for ${user.username}`);
                }).catch((err: any) => {
                  console.error(`[chat] Failed to schedule reminder:`, err.message);
                });
              }
              // 返回完整 sessionKey（而非短 sid），前端轮询和后续请求需要完整 key
              res.write(`data: ${JSON.stringify({ content: '', done: true, sessionId: sessionKey, ...(hasDelegation ? { delegated: true } : {}) })}\n\n`);
              clearInterval(heartbeat);
              res.end();
              // 异步生成标题（不阻塞响应）
              autoGenerateTitle(sessionKey).catch(err => console.error('[TitleGen] Failed:', err));
              // 异步 token 计费：获取会话 token 用量增量，消费 token_daily/token_monthly
              if (quotaManager && bridge?.isConnected) {
                bridge.sessionsUsage({ key: sessionKey }).then((usage: any) => {
                  const sessions = Array.isArray(usage) ? usage : (usage?.sessions || [usage]);
                  const s = sessions.find((x: any) => x?.key === sessionKey || x?.sessionKey === sessionKey) || sessions[0];
                  if (s?.totalTokens) {
                    const prev = sessionTokens.get(sessionKey) || 0;
                    const delta = Math.max(0, s.totalTokens - prev);
                    setSessionTokens(sessionKey, s.totalTokens);
                    if (delta > 0) {
                      quotaManager!.consumeQuota(user.id, 'token_daily', delta).catch(() => {});
                      quotaManager!.consumeQuota(user.id, 'token_monthly', delta).catch(() => {});
                    }
                  }
                }).catch(() => {});
              }
              break;
            }
            case 'error':
              streamDone = true;
              res.write(`data: ${JSON.stringify({ error: event.error, done: true })}\n\n`);
              clearInterval(heartbeat);
              res.end();
              break;
          }
        },
      );
    } catch (err) {
      clearInterval(heartbeat);
      if (!streamDone) {
        if (!res.headersSent) {
          next(err);
        } else {
          try {
            res.write(`data: ${JSON.stringify({ error: 'Internal server error', done: true })}\n\n`);
            res.end();
          } catch { /* closed */ }
        }
      }
    }
  });

  /**
   * 非流式对话
   */
  router.post('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const { message, sessionId: rawSessionId, agentId: reqAgentId, attachments: attNonStream } = req.body;

    if (!message?.trim() && (!attNonStream || attNonStream.length === 0)) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // 处理附件（与流式端点逻辑一致）
    const MAX_ATTACHMENT_SIZE_NS = 10 * 1024 * 1024; // 10MB base64 (~7.5MB 实际文件)
    let finalMsgNonStream = message?.trim() || '';
    if (Array.isArray(attNonStream) && attNonStream.length > 0) {
      const agentNS = await loadAgent(user.id, reqAgentId);
      const agentNameNS = agentNS?.name || 'default';
      const wsRootNS = agentNameNS === 'default'
        ? workspaceManager.getSubPath(user.id, 'WORKSPACE')
        : workspaceManager.getAgentWorkspacePath(user.id, agentNameNS);
      const filesDirNS = path.join(wsRootNS, 'files');
      await fs.promises.mkdir(filesDirNS, { recursive: true });

      const savedPathsNS: string[] = [];
      for (const att of attNonStream) {
        if (!att.name || !att.content) continue;
        if (att.content.length > MAX_ATTACHMENT_SIZE_NS) {
          res.status(413).json({ error: `附件 "${att.name}" 超过大小限制（最大 10MB）` });
          return;
        }
        const safeName = att.name.replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_');
        let targetPath = path.join(filesDirNS, safeName);
        if (fs.existsSync(targetPath)) {
          const ext = path.extname(safeName);
          const base = path.basename(safeName, ext);
          targetPath = path.join(filesDirNS, `${base}_${Date.now()}${ext}`);
        }
        const isText = att.type?.startsWith('text/') || /\.(txt|md|csv|json|xml|yaml|yml|js|ts|py|sql|sh|log|html|css)$/i.test(att.name);
        if (isText) {
          await fs.promises.writeFile(targetPath, att.content, 'utf-8');
        } else {
          await fs.promises.writeFile(targetPath, Buffer.from(att.content, 'base64'));
        }
        savedPathsNS.push(path.relative(wsRootNS, targetPath));
      }
      if (savedPathsNS.length > 0) {
        const fileList = savedPathsNS.map(p => `- ${p}`).join('\n');
        finalMsgNonStream = `[用户上传了 ${savedPathsNS.length} 个文件，已保存到工作空间]\n${fileList}\n\n${finalMsgNonStream}`;
      }
    }

    // 斜杠命令拦截
    const sid0 = rawSessionId || 'tmp';
    const slashAgentNS = await loadAgent(user.id, reqAgentId);
    const slashResult = await handleSlashCommand(message?.trim() || '', user.id, sid0, slashAgentNS);
    if (slashResult !== null) {
      if (slashResult.passthrough) {
        finalMsgNonStream = slashResult.passthrough;
      } else {
        res.json({ message: slashResult.reply, sessionId: sid0 });
        return;
      }
    }

    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }

    const agent = await loadAgent(user.id, reqAgentId);
    const agentName = agent?.name || 'default';
    const nativeAgentId = EngineAdapter.userAgentId(user.id, agentName);
    let sessionKey: string;
    let sid: string;
    if (rawSessionId && rawSessionId.startsWith('agent:')) {
      if (!validateSessionOwnership(rawSessionId, user.id)) {
        res.status(403).json({ error: 'Access denied: session does not belong to current user' });
        return;
      }
      sessionKey = rawSessionId;
      sid = rawSessionId;
    } else {
      sid = rawSessionId || randomUUID().replace(/-/g, '').slice(0, 16);
      sessionKey = EngineAdapter.userSessionKey(user.id, agentName, sid);
    }
    await ensureNativeAgent(user.id, agentName);
    const extraPrompt = await buildEnterpriseSystemPrompt(user, agent);

    // 注入 session 级 skill/mcp 偏好
    const prefsNS = sessionPrefs.get(sid0);
    if (prefsNS && !finalMsgNonStream.startsWith('[请使用')) {
      if (prefsNS.skillId) {
        const sr = await prisma.skill.findFirst({ where: { id: prefsNS.skillId } });
        if (sr) finalMsgNonStream = `[请优先使用 ${sr.name} skill]\n${finalMsgNonStream}`;
      } else if (prefsNS.mcpId) {
        const mr = await prisma.mCPServer.findFirst({ where: { id: prefsNS.mcpId } });
        if (mr) finalMsgNonStream = `[请优先使用 ${mr.name} MCP 工具]\n${finalMsgNonStream}`;
      }
    }

    let fullContent = '';
    try {
      await new Promise<void>((resolve, reject) => {
        bridge!.callAgent(
          { message: finalMsgNonStream, agentId: nativeAgentId, sessionKey, extraSystemPrompt: extraPrompt, deliver: false, isAdmin: Array.isArray(user.roles) && user.roles.includes(Role.ADMIN) },
          (event) => {
            // native data.text 是累积全量文本（不是增量片段），直接替换
            if (event.type === 'text_delta') fullContent = event.content || fullContent;
            if (event.type === 'done') resolve();
            if (event.type === 'error') reject(new Error(event.error || 'Agent error'));
          },
        ).catch(reject);
      });

      // 响应净化：剔除记忆标签、时间戳、审计日志等无关内容
      const purified = fullContent
        .replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>/g, '')
        .replace(/^\[[A-Za-z]{3}\s\d{4}-\d{2}-\d{2}.*?\]\s*/gm, '')
        .replace(/\[UNTRUSTED DATA[\s\S]*?\[END UNTRUSTED DATA\]/g, '')
        .trim();

      // 异步尝试生成标题（不阻塞对话响应）
      autoGenerateTitle(sessionKey).catch(err => console.error('[TitleGen] Failed:', err));
      // 异步 token 计费
      if (quotaManager && bridge?.isConnected) {
        bridge.sessionsUsage({ key: sessionKey }).then((usage: any) => {
          const sessions = Array.isArray(usage) ? usage : (usage?.sessions || [usage]);
          const s = sessions.find((x: any) => x?.key === sessionKey || x?.sessionKey === sessionKey) || sessions[0];
          if (s?.totalTokens) {
            const prev = sessionTokens.get(sessionKey) || 0;
            const delta = Math.max(0, s.totalTokens - prev);
            setSessionTokens(sessionKey, s.totalTokens);
            if (delta > 0) {
              quotaManager!.consumeQuota(user.id, 'token_daily', delta).catch(() => {});
              quotaManager!.consumeQuota(user.id, 'token_monthly', delta).catch(() => {});
            }
          }
        }).catch(() => {});
      }

      res.json({ message: purified, sessionId: sessionKey });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 获取可用模型
   */
  router.get('/models', authMiddleware, async (_req: AuthenticatedRequest, res) => {
    if (!bridge?.isConnected) {
      res.json({ models: [] });
      return;
    }
    try {
      const result = await bridge.modelsList() as any;
      const allModels: any[] = result?.models || result || [];

      // 从 octopus.json 读取已配置的 providers，只返回这些 provider 的模型
      const { config: octopusCfg } = await bridge.configGetParsed();
      const configuredProviders = new Set<string>();
      // models.providers 中显式配置的
      const providers = (octopusCfg as any)?.models?.providers;
      if (providers && typeof providers === 'object') {
        for (const key of Object.keys(providers)) {
          configuredProviders.add(key);
        }
      }
      // agents.defaults.model 中引用的 provider
      const defaultModel = (octopusCfg as any)?.agents?.defaults?.model;
      const primaryStr = typeof defaultModel === 'string' ? defaultModel : defaultModel?.primary;
      if (primaryStr && primaryStr.includes('/')) {
        configuredProviders.add(primaryStr.split('/')[0]);
      }
      const fallbacks: string[] = defaultModel?.fallbacks || [];
      for (const fb of fallbacks) {
        if (fb && fb.includes('/')) configuredProviders.add(fb.split('/')[0]);
      }

      // 过滤：只保留已配置 provider 的模型
      const filtered = configuredProviders.size > 0
        ? allModels.filter((m: any) => {
            const provider = m.provider || (m.id?.includes('/') ? m.id.split('/')[0] : '');
            return configuredProviders.has(provider);
          })
        : allModels;

      // 补充：octopus.json 中自定义 provider 的模型可能不在引擎列表中，手动添加
      const existingIds = new Set(filtered.map((m: any) => `${m.provider}/${m.id}`));
      if (providers && typeof providers === 'object') {
        for (const [providerKey, providerCfg] of Object.entries(providers)) {
          const cfg = providerCfg as any;
          const modelEntries: any[] = cfg?.models || [];
          for (const entry of modelEntries) {
            const modelId = typeof entry === 'string' ? entry : entry?.id;
            const modelName = typeof entry === 'string' ? entry : (entry?.name || entry?.id);
            if (modelId && !existingIds.has(`${providerKey}/${modelId}`)) {
              filtered.push({ id: modelId, name: modelName, provider: providerKey });
            }
          }
        }
      }

      res.json({ models: filtered });
    } catch {
      res.json({ models: [] });
    }
  });

  /**
   * 列出用户的会话（按 agentId 过滤）
   */
  router.get('/sessions', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      // 确定过滤前缀：若传了 agentId 则精确匹配该 agent，否则取默认 agent
      let agentPrefix: string;
      let nativeAgentId: string | undefined;
      const reqAgentId = req.query.agentId as string | undefined;
      if (prisma) {
        const agent = reqAgentId
          ? await prisma.agent.findFirst({ where: { id: reqAgentId, ownerId: user.id } })
          : await prisma.agent.findFirst({ where: { ownerId: user.id, isDefault: true } });
        const agentName = agent?.name || 'default';
        nativeAgentId = EngineAdapter.userAgentId(user.id, agentName);
        agentPrefix = `agent:${nativeAgentId}:session:`;
      } else {
        // 无 DB 时退回到用户级别过滤
        agentPrefix = `agent:ent_${user.id}_`;
      }

      // 传入 agentId 让 Native Gateway 服务端过滤，减少全量数据暴露
      const result = await bridge.sessionsList(nativeAgentId) as any;
      // 保留客户端 filter 作为二次防御
      const rawSessions = ((result?.sessions || result) as any[] || [])
        .filter((s: any) => (s.key || s.sessionKey || '').startsWith(agentPrefix));

      // 对没有标题或标题包含脏数据的 session 异步补标题
      const needsTitle = (s: any) => {
        const lbl = s.label || s.title || '';
        return !lbl || lbl === '新对话' || lbl.includes('<relevant-memories') || lbl.includes('[UNTRUSTED DATA');
      };
      const titleTasks = rawSessions
        .filter(needsTitle)
        .slice(0, 5)  // 最多同时补 5 个，避免大量历史 session 拖慢响应
        .map((s: any) => autoGenerateTitle(s.key || s.sessionKey).catch(() => null));
      if (titleTasks.length > 0) {
        await Promise.allSettled(titleTasks);
        // 重新拉一次列表拿到更新后的 label（传入 agentId 服务端过滤）
        const refreshed = await bridge.sessionsList(nativeAgentId) as any;
        const refreshedMap = new Map<string, any>();
        for (const s of ((refreshed?.sessions || refreshed) as any[] || [])) {
          refreshedMap.set(s.key || s.sessionKey, s);
        }
        for (const s of rawSessions) {
          const key = s.key || s.sessionKey;
          const fresh = refreshedMap.get(key);
          if (fresh) {
            s.label = fresh.label || s.label;
            s.title = fresh.title || s.title;
          }
        }
      }

      const sessions = rawSessions.map((s: any) => ({
        sessionId: s.key || s.sessionKey,
        title: (s.label || s.title || '新对话')
          .replace(/^\[请(?:使用|严格按照|优先使用)\s+[^\]]*(?:\]|\S*…)\s*/m, '')
          .replace(/^\/lesson\s+/m, '')
          .trim() || '新对话',
        agentId: s.agentId,
        lastActiveAt: new Date(s.updatedAt || s.lastActiveAt || Date.now()).toISOString(),
        messageCount: s.messageCount || 0,
      }));
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 获取会话历史
   */
  router.get('/history/:sessionId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    let sessionId = req.params.sessionId;
    // 短 ID 兜底：如果传来的不是完整 session key，根据 agentId 构造完整 key
    if (!sessionId.startsWith('agent:')) {
      const reqAgentId = req.query.agentId as string | undefined;
      const agent = await loadAgent(user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      sessionId = EngineAdapter.userSessionKey(user.id, agentName, sessionId);
    }
    // 用户归属校验：确保 session 属于当前用户
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const history = await bridge.chatHistory(sessionId) as any;
      // native gateway 的 content 字段是 [{type:'text', text:'...'}] 数组，转成字符串
      const rawMessages = ((history?.messages || history?.history || []) as any[])
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any) => {
          // map 内部可能返回 null（subagent 内部消息），后面 filter 掉
          let content: string;
          if (Array.isArray(m.content)) {
            content = m.content.map((c: any) => c.text || c.content || '').join('');
          } else if (typeof m.content === 'string') {
            content = m.content;
          } else {
            content = String(m.content ?? '');
          }

          // 用户消息：剥离系统注入的内部上下文
          if (m.role === 'user') {
            // subagent 任务回调消息：完全隐藏（不显示给用户）
            if (content.includes('Octopus runtime context') || content.includes('[Internal task completion event]')) {
              return null;
            }
            content = content
              .replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>/g, '')
              .replace(/\[UNTRUSTED DATA[\s\S]*?\[END UNTRUSTED DATA\]/g, '')
              .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\d{4}-\d{2}-\d{2}[^\]]*\]\s*/m, '')
              .replace(/^\[请(?:使用|严格按照|优先使用)\s+[^\]]*(?:\]|\S*…)\s*/m, '')
              .replace(/^\/lesson\s+/m, '')
              .trim();
          }

          // 助手消息：剥离 enterprise-reminder 标签 + 分离 <think> 内容
          let thinking: string | undefined;
          if (m.role === 'assistant') {
            content = content
              .replace(/<enterprise-reminder[^>]*\/?>(<\/enterprise-reminder>)?/g, '')
              .trim();
            // 提取 <think>...</think> 内容
            const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
            if (thinkMatch) {
              thinking = thinkMatch[1].trim();
              content = content
                .replace(/<think>[\s\S]*?<\/think>\s*/, '')
                .replace(/<\/?final>/g, '')
                .trim();
            }
          }

          return {
            role: m.role as 'user' | 'assistant',
            content,
            ...(thinking ? { thinking } : {}),
            ts: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
          };
        })
        .filter(Boolean) as Array<{ role: 'user' | 'assistant'; content: string; thinking?: string; ts?: string }>;

      // 合并相邻的 assistant 消息（工具调用会将助手回复拆成多段，刷新后应显示为一个气泡）
      const messages: Array<{ role: 'user' | 'assistant'; content: string; thinking?: string; ts?: string }> = [];
      for (const msg of rawMessages) {
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant' && msg.role === 'assistant') {
          last.content = (last.content + (last.content && msg.content ? '\n\n' : '') + msg.content).trim();
          if (msg.thinking) {
            last.thinking = (last.thinking ? last.thinking + '\n' : '') + msg.thinking;
          }
        } else {
          messages.push({ ...msg });
        }
      }

      res.json({ sessionId, messages });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 清除会话
   */
  router.delete('/history/:sessionId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    let sessionId = req.params.sessionId;
    // 短 ID 兜底：构造完整 session key
    if (!sessionId.startsWith('agent:')) {
      const reqAgentId = req.query.agentId as string | undefined;
      const agent = await loadAgent(user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      sessionId = EngineAdapter.userSessionKey(user.id, agentName, sessionId);
    }
    // 用户归属校验：确保 session 属于当前用户
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      await bridge.sessionsDelete(sessionId);
      res.json({ message: 'Session deleted' });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 重命名会话
   */
  router.put('/sessions/:sessionId/title', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    // 用户归属校验：确保 session 属于当前用户
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const { title } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      await bridge.sessionsPatch(sessionId, { label: title.trim() });
      res.json({ message: 'Session renamed', sessionId, title: title.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 内部使用的自动生成标题逻辑
   */
  async function autoGenerateTitle(sessionId: string) {
    if (!bridge?.isConnected) return null;
    try {
      // 1. 检查是否已经有标题（label）
      // 从 sessionKey 解析 agentId 用于服务端过滤
      const agentIdMatch = sessionId.match(/^agent:([^:]+):session:/);
      const titleAgentId = agentIdMatch ? agentIdMatch[1] : undefined;
      const result = await bridge.sessionsList(titleAgentId) as any;
      const sessions = (result?.sessions || result) as any[];
      const session = sessions.find((s: any) => (s.key || s.sessionKey) === sessionId);
      
      // 如果已经有自定义标题，跳过
      if (session?.label && session.label !== '新对话') {
        return session.label;
      }

      // 2. 获取历史记录取首条消息
      const history = await bridge.chatHistory(sessionId) as any;
      const messages = (history?.messages || history?.history || []) as any[];

      const firstUser = messages.find((m: any) => m.role === 'user');
      if (!firstUser) return null;

      let content: string;
      if (Array.isArray(firstUser.content)) {
        content = firstUser.content.map((c: any) => c.text || c.content || '').join('');
      } else {
        content = String(firstUser.content || '');
      }

      // 剥离记忆系统注入的标签、时间戳前缀和附件前缀（与 history 路由相同的净化逻辑）
      content = content
        .replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>/g, '')
        .replace(/\[UNTRUSTED DATA[\s\S]*?\[END UNTRUSTED DATA\]/g, '')
        .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\d{4}-\d{2}-\d{2}[^\]]*\]\s*/m, '')
        .replace(/^\[请(?:使用|严格按照|优先使用)\s+[^\]]*(?:\]|\S*…)\s*/m, '')
        .replace(/^\/lesson\s+/m, '')
        .replace(/^\[用户上传了 \d+ 个文件，已保存到工作空间\]\n(?:- .+\n?)+\n?/m, '')
        .trim();

      if (!content) return null;

      const trimmed = content.replace(/\s+/g, ' ');
      const title = trimmed.length > 24 ? trimmed.slice(0, 24) + '…' : trimmed;

      if (title && title !== '新对话') {
        // 尝试 patch 标题，遇到 label 重复时加时间戳后缀重试（最多 2 次）
        let finalTitle = title;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await bridge.sessionsPatch(sessionId, { label: finalTitle });
            return finalTitle;
          } catch (patchErr: any) {
            const msg = String(patchErr?.message || patchErr || '');
            if (msg.includes('label already in use')) {
              const now = new Date();
              const suffix = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
              finalTitle = `${title} (${suffix}${attempt > 0 ? `-${attempt}` : ''})`;
              console.warn(`[autoGenerateTitle] label 重复，重试: ${finalTitle}`);
              continue;
            }
            // 非 label 重复错误，直接抛出
            throw patchErr;
          }
        }
        // 重试耗尽，静默放弃（不抛出，防止调用方再重试）
        console.warn(`[autoGenerateTitle] label 重复重试耗尽，放弃: ${finalTitle}`);
        return null;
      }
    } catch (err) {
      console.error(`[autoGenerateTitle] ${sessionId}:`, err);
    }
    return null;
  }

  /**
   * 自动生成会话标题：取第一条用户消息截断作为标题
   */
  router.post('/sessions/:sessionId/generate-title', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    let { sessionId } = req.params;

    // 支持短 ID：若不是完整 session key，自动拼接
    if (!sessionId.startsWith('agent:')) {
      const { agentId: reqAgentId } = req.body || {};
      const agent = await loadAgent(user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      sessionId = EngineAdapter.userSessionKey(user.id, agentName, sessionId);
    }

    // 权限校验：session key 必须包含当前用户 ID
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const title = await autoGenerateTitle(sessionId);
    res.json({ sessionId, title });
  });

  /**
   * 获取会话 Token 用量
   */
  router.get('/sessions/:sessionId/usage', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const usage = await bridge.sessionsUsage({ key: sessionId });
      res.json(usage);
    } catch (err) {
      next(err);
    }
  });

  /**
   * 压缩长会话历史
   */
  router.post('/sessions/:sessionId/compact', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const result = await bridge.sessionsCompact(sessionId, req.body.maxLines);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * 终止正在进行的对话
   */
  router.post('/sessions/:sessionId/abort', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      let sessionKey = sessionId;
      if (!sessionId.startsWith('agent:')) {
        // agentId 可能是 DB id，需要查出 name
        const reqAgentId = req.query.agentId as string | undefined;
        const agent = await loadAgent(user.id, reqAgentId);
        const agentName = agent?.name || 'default';
        sessionKey = EngineAdapter.userSessionKey(user.id, agentName, sessionId);
      } else if (!validateSessionOwnership(sessionId, user.id)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const result = await bridge.chatAbort(sessionKey);
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 获取可用工具目录（原生 catalog + 企业 MCP 工具合并）
   */
  router.get('/tools', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const agentName = (req.query.agentName as string) || 'default';
      const nativeAgentId = EngineAdapter.userAgentId(user.id, agentName);
      const catalog = await bridge.toolsCatalog(nativeAgentId);
      res.json(catalog);
    } catch (err) {
      next(err);
    }
  });

  /**
   * 搜索历史消息（原生 bridge 暂不支持，返回空结果）
   */
  router.get('/search', authMiddleware, async (req: AuthenticatedRequest, res) => {
    res.json({ query: req.query.q || '', count: 0, results: [] });
  });

  /**
   * 导出会话（原生 bridge 暂不支持）
   */
  router.get('/export/:sessionId', authMiddleware, async (_req: AuthenticatedRequest, res) => {
    res.status(501).json({ error: 'Export not yet supported with native bridge' });
  });

  return router;
}
