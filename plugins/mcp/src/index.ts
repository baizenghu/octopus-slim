import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { MCPExecutor, type MCPTool, setSandboxConfig, sandboxConfig } from './executor';
import { Type } from '@sinclair/typebox';

/** 从 native agentId（如 ent_user-baizh_xxx）提取企业 userId */
function extractUserIdFromAgentId(agentId: string): string | null {
  const match = agentId.match(/^ent_(user-[^_]+)_/);
  return match ? match[1] : null;
}

/** 从 native agentId（如 ent_user-baizh_salary-agent）提取 agentName */
function extractAgentNameFromAgentId(agentId: string): string | null {
  const match = agentId.match(/^ent_user-[^_]+_(.+)$/);
  return match ? match[1] : null;
}

// ─── MCP 工具连续失败计数器（per-agent + per-tool 熔断）──────────────────────
/** key = "agentId:toolName" */
const toolFailureCounter = new Map<string, { count: number; lastFailedAt: number }>();
const TOOL_MAX_CONSECUTIVE_FAILURES = 3;
const TOOL_FAILURE_RESET_MS = 5 * 60 * 1000; // 5 分钟后自动重置

// ─── 通用 agent 字段缓存（mcpFilter / allowedConnections，TTL 60s）─────────
type AgentFilterField = 'mcpFilter' | 'allowedConnections';
const _filterCache = new Map<string, { data: string[] | null; ts: number }>();
const FILTER_CACHE_TTL = 60_000;

/** DB column name for each AgentFilterField */
const FIELD_TO_COLUMN: Record<AgentFilterField, string> = {
  mcpFilter: 'mcp_filter',
  allowedConnections: 'allowed_connections',
};

/** 查 DB 获取 agent 的指定字段，带缓存 */
async function getAgentFilter(
  field: AgentFilterField,
  userId: string,
  agentName: string,
): Promise<string[] | null> {
  const key = `${field}:${userId}:${agentName}`;
  const cached = _filterCache.get(key);
  if (cached && Date.now() - cached.ts < FILTER_CACHE_TTL) return cached.data;

  const col = FIELD_TO_COLUMN[field];
  try {
    // $queryRaw with tagged template doesn't support dynamic column names,
    // so we use $queryRawUnsafe with parameterized values for the WHERE clause
    const agent = await _prisma!.$queryRawUnsafe<Array<Record<string, string | null>>>(
      `SELECT ${col} FROM agents WHERE owner_id = ? AND name = ? AND enabled = 1 LIMIT 1`,
      userId, agentName,
    );
    let data: string[] | null = null;
    if (agent.length > 0 && agent[0][col]) {
      const raw = agent[0][col];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length > 0) data = parsed;
    }
    _filterCache.set(key, { data, ts: Date.now() });
    return data;
  } catch {
    return null; // DB 查询失败不阻塞，降级为不限制
  }
}

/** 检查 MCP server 是否在白名单内（null/[] = 全部禁用，有值数组 = 白名单） */
function isMcpServerAllowed(serverNameOrId: string, filter: string[] | null): boolean {
  if (!filter || filter.length === 0) return false; // null/[] = 全部禁用
  return filter.includes(serverNameOrId);
}

/** 熔断检查：连续失败次数超限时返回拒绝消息，否则返回 null */
function checkCircuitBreaker(agentId: string, toolName: string): string | null {
  const failKey = `${agentId}:${toolName}`;
  const failure = toolFailureCounter.get(failKey);
  if (failure && failure.count >= TOOL_MAX_CONSECUTIVE_FAILURES) {
    if (Date.now() - failure.lastFailedAt < TOOL_FAILURE_RESET_MS) {
      return `该工具（${toolName}）已连续失败 ${failure.count} 次，请停止重试并告知用户该操作暂时不可用。原因可能是参数错误或服务异常。`;
    }
    toolFailureCounter.delete(failKey);
  }
  return null;
}

/** 记录工具调用失败（熔断计数器 +1） */
function recordToolFailure(agentId: string, toolName: string) {
  const failKey = `${agentId}:${toolName}`;
  const f = toolFailureCounter.get(failKey) || { count: 0, lastFailedAt: 0 };
  f.count++;
  f.lastFailedAt = Date.now();
  toolFailureCounter.set(failKey, f);
}

/** 清除工具调用失败记录（成功后重置） */
function clearToolFailure(agentId: string, toolName: string) {
  toolFailureCounter.delete(`${agentId}:${toolName}`);
}

/** 需要校验 connection_name 的 MCP 工具名列表 */
const CONN_TOOLS = new Set(['execute_sql', 'list_tables', 'describe_table', 'list_connections']);

/** 校验 connection_name 是否在白名单内，不在则抛错（null/[] = 全部禁用） */
function checkConnectionAllowed(
  toolName: string,
  params: Record<string, any>,
  allowed: string[] | null,
): void {
  // null/[] = 全部禁用
  if (!allowed || allowed.length === 0) {
    throw new Error('Access denied: no database connections allowed for this agent');
  }
  if (toolName === 'list_connections') return; // list_connections 走后处理过滤
  const connName = params?.connection_name;
  if (connName && !allowed.includes(connName)) {
    throw new Error(
      `Access denied: agent is not allowed to access connection "${connName}". ` +
      `Allowed connections: ${allowed.join(', ')}`,
    );
  }
}

/** 过滤 list_connections 返回结果，只保留白名单内的连接 */
function filterListConnectionsResult(resultText: string, allowed: string[] | null): string {
  if (!allowed) return resultText;
  try {
    const result = JSON.parse(resultText);
    if (result.connections && Array.isArray(result.connections)) {
      result.connections = result.connections.filter(
        (c: any) => allowed.includes(c.name),
      );
      result.count = result.connections.length;
    }
    return JSON.stringify(result);
  } catch {
    return resultText;
  }
}


/**
 * 共享 MCP 工具执行逻辑（企业/个人、直连/缓存 4 种 execute 的统一入口）
 *
 * @param executor   MCPExecutor 实例（缓存模式下可能为 null，需等待 _initDone）
 * @param agentId    原生 agentId（如 ent_user-baizh_default）
 * @param serverId   MCP server ID
 * @param serverName MCP server 显示名
 * @param toolName   原始 MCP 工具名（如 list_tables）
 * @param params     工具参数
 * @param opts.scope enterprise / personal
 * @param opts.waitForReady 缓存模式需等待 executor 就绪
 * @param opts.ownerId 个人 MCP 所有者 ID（用于 callTool 的 userId 参数）
 */
async function executeMCPTool(
  executor: MCPExecutor | null,
  agentId: string,
  serverId: string,
  serverName: string,
  toolName: string,
  params: any,
  opts: { scope: 'enterprise' | 'personal'; waitForReady: boolean; ownerId?: string | null },
): Promise<{ content: Array<{ type: 'text'; text: string }>; details?: any } | string> {
  // 1. 熔断检查
  const breakerMsg = checkCircuitBreaker(agentId, toolName);
  if (breakerMsg) return breakerMsg;

  // 2. 提取 userId / agentName
  const userId = extractUserIdFromAgentId(agentId) || undefined;
  const agentName = extractAgentNameFromAgentId(agentId);

  // 3. 企业 scope: mcpFilter + allowedConnections 校验
  if (opts.scope === 'enterprise') {
    if (userId && agentName && _prisma) {
      const filter = await getAgentFilter('mcpFilter', userId, agentName);
      if (!isMcpServerAllowed(serverName, filter) && !isMcpServerAllowed(serverId, filter)) {
        throw new Error(`Access denied: agent "${agentName}" is not allowed to use MCP server "${serverName}"`);
      }
    }

    if (userId && agentName && _prisma && CONN_TOOLS.has(toolName)) {
      const allowed = await getAgentFilter('allowedConnections', userId, agentName);
      checkConnectionAllowed(toolName, params, allowed);
    }
  }

  // 4. 加载用户环境变量
  const userEnv = userId ? await loadUserEnv(userId, _prisma) : {};
  if (CONN_TOOLS.has(toolName)) {
    const dbEnvKeys = Object.keys(userEnv).filter((k) => /^DB_.+_(TYPE|HOST|PORT|USER|PASSWORD|DATABASE)$/.test(k)).sort();
    console.log(`[enterprise-mcp][env] tool=${toolName} userId=${userId} dbEnvKeys=${dbEnvKeys.join(',') || '(none)'}`);
  }

  // 5. waitForReady: 等待 executor 就绪（缓存模式）
  if (opts.waitForReady) {
    const deadline = Date.now() + 15_000;
    while (!_initDone && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (!_executor || !_initDone) {
      throw new Error(`MCP server (${serverName}) not ready yet, please retry`);
    }
    executor = _executor;
  }

  if (!executor) {
    throw new Error(`MCP executor not available for server "${serverName}"`);
  }

  // 6. callTool + 结果处理
  const logTag = opts.scope === 'personal' ? '[personal]' : opts.waitForReady ? '' : '[connected]';
  console.log(`[enterprise-mcp]${logTag} callTool: ${toolName} userId=${userId} agent=${agentName}`);
  try {
    let result = await executor.callTool(serverId, toolName, params || {}, userId, userEnv);

    // list_connections 结果过滤（仅企业 scope）
    if (opts.scope === 'enterprise' && toolName === 'list_connections' && userId && agentName && _prisma) {
      const allowed = await getAgentFilter('allowedConnections', userId, agentName);
      result = filterListConnectionsResult(result, allowed);
    }

    console.log(`[enterprise-mcp]${logTag} callTool OK: ${toolName} result=${String(result).slice(0, 300)}`);
    clearToolFailure(agentId, toolName);
    return {
      content: [{ type: 'text' as const, text: result }],
      details: result,
    };
  } catch (err: any) {
    console.error(`[enterprise-mcp]${logTag} callTool ERROR: ${toolName} error=${err.message}`);
    recordToolFailure(agentId, toolName);
    throw err;
  }
}

/** 解密 AES-256-GCM 加密的密码（格式 iv:tag:encrypted），兼容明文旧数据 */
function decryptDbPassword(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext; // 明文旧数据
  const key = process.env.DB_ENCRYPTION_KEY;
  if (!key) return ciphertext;
  try {
    const [ivHex, tagHex, encHex] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return ciphertext; // 解密失败降级为原始值
  }
}

/** 从数据库读取用户已启用的数据库连接，生成 DB_{name}_xxx 环境变量 */
async function loadUserEnv(userId: string, prisma: PrismaClient | null): Promise<Record<string, string>> {
  if (!userId || !prisma) return {};
  const env: Record<string, string> = {};

  try {
    const connections = await prisma.databaseConnection.findMany({
      where: { userId, enabled: true },
    });
    for (const conn of connections) {
      env[`DB_${conn.name}_TYPE`] = conn.dbType;
      env[`DB_${conn.name}_HOST`] = conn.host;
      env[`DB_${conn.name}_PORT`] = String(conn.port);
      env[`DB_${conn.name}_USER`] = conn.dbUser;
      env[`DB_${conn.name}_PASSWORD`] = decryptDbPassword(conn.dbPassword);
      env[`DB_${conn.name}_DATABASE`] = conn.dbName;
    }
  } catch {
    // DB 查询失败不阻塞
  }

  return env;
}

/** MCP 工具的磁盘缓存格式 */
interface CachedMCPTool {
  serverId: string;
  serverName: string;
  toolName: string;        // 原始 MCP 工具名（如 "list_tables"）
  nativeToolName: string;  // native plugin 注册名（如 "mcp_mcp_xxx_list_tables"）
  description: string;
  inputSchema: Record<string, unknown>;
  // ── Phase 2.5: 个人 MCP 支持 ──
  scope?: 'enterprise' | 'personal';
  ownerId?: string | null;
}

const TOOLS_CACHE_PATH = path.join(
  process.env.OCTOPUS_STATE_DIR || path.join(__dirname, '..', '..', '..', '.octopus-state'),
  'tools-cache.json'
);

/** 在模块加载时同步读取磁盘缓存 — 保证即使模块被重新加载也能立即拿到工具列表 */
let _cachedTools: CachedMCPTool[] = [];
try {
  _cachedTools = JSON.parse(fs.readFileSync(TOOLS_CACHE_PATH, 'utf8'));
} catch {
  // 首次启动无缓存，异步初始化后会写入
}

// ─── 模块级单例 ────────────────────────────────────────────────────────────
let _executor: MCPExecutor | null = null;
let _prisma: PrismaClient | null = null;
let _initDone = false;
/** 已注册的个人工具 server 前缀（防止重复注册） */
const _registeredPersonalTools = new Set<string>();
/** 个人 MCP 刷新 interval ID，gateway_stop 时需清理 */
let _refreshInterval: ReturnType<typeof setInterval> | null = null;
let _dataRootGlobal: string = './data';
// ──────────────────────────────────────────────────────────────────────────

/** 根据 serverId + toolName 生成与 native plugin 一致的工具名 */
function nativeToolName(serverId: string, toolName: string): string {
  const name = `mcp_${serverId}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, '_');
  return name.length > 64 ? name.slice(0, 64) : name;
}

/** 个人 MCP 工具名，用 mcp_p_ 前缀区分企业级 */
function personalToolName(serverId: string, toolName: string): string {
  // serverId 较长时用短 hash 防止工具名超 64 字符（Claude API 限制）
  let shortId = serverId.replace(/[^a-zA-Z0-9_]/g, '_');
  if (shortId.length > 16) {
    // 取 serverId 的最后 8 字符作为唯一标识
    shortId = shortId.slice(-8);
  }
  const name = `mcp_p_${shortId}_${toolName}`.replace(/[^a-zA-Z0-9_]/g, '_');
  return name.length > 64 ? name.slice(0, 64) : name;
}

/**
 * Enterprise MCP Plugin
 *
 * 入口必须是同步函数（octopus 忽略 promise 返回值）
 */
export default function enterpriseMcpPlugin(api: any) {
  const config = api.pluginConfig || {};
  const databaseUrl = config.databaseUrl || process.env['DATABASE_URL'];
  if (!databaseUrl) {
    api.logger.warn('databaseUrl not configured, enterprise MCP disabled');
    return;
  }

  // ── 从 plugin config 读取 sandbox 配置，覆盖默认沙箱参数 ──────
  // 配置位于 octopus.json plugins.entries.enterprise-mcp.config.sandbox
  try {
    if ((config as any)?.sandbox) {
      setSandboxConfig((config as any).sandbox);
      api.logger.info('enterprise-mcp: sandbox config loaded from plugin config');
    }
  } catch (err: any) {
    api.logger.warn(`enterprise-mcp: failed to read sandbox config, using defaults: ${err.message}`);
  }

  // ── 从磁盘缓存立即注册工具（同步，覆盖所有 workspace 缓存 miss 的情况）──────
  if (_cachedTools.length > 0) {
    for (const cached of _cachedTools) {
      if (cached.scope === 'personal') {
        registerPersonalMCPToolFromCache(api, cached);
      } else {
        registerMCPToolFromCache(api, cached);
      }
    }
    api.logger.info(`enterprise-mcp: registered ${_cachedTools.length} MCP tool(s) from cache`);
  }

  // ── 全局 executor/prisma 单例 ──────────────────────────────────────────
  // 限制连接池大小：plugin 与 enterprise-audit 共享 native gateway 进程
  const dbUrlWithPoolLimit = databaseUrl.includes('connection_limit')
    ? databaseUrl
    : `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}connection_limit=3`;

  // prisma 可能被 gateway_stop 置 null，每次入口调用都检查并重建
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: dbUrlWithPoolLimit } },
      log: [],
    });
  }

  if (!_executor) {
    _executor = new MCPExecutor();

    // 异步连接 MCP server，完成后刷新磁盘缓存和模块缓存
    initMCPServers(api, _executor, _prisma).catch((err: any) => {
      api.logger.error(`enterprise-mcp init failed: ${err.message}`);
    });
  } else if (_initDone) {
    // executor 已就绪且有新工具（刷新缓存后注册新增工具）
    // 磁盘缓存注册已在上面完成，此处无需重复
  }

  // ── enterprise_agents_list（ToolFactory：仅对默认 agent 开放，专业 agent 无协作能力）──
  api.registerTool((ctx: { agentId?: string }) => {
    const agentId = ctx?.agentId;
    if (!agentId) return null;

    const userId = extractUserIdFromAgentId(agentId);
    if (!userId) return null;

    // 仅对 default agent 开放，专业 agent 不具备协作能力
    const agentName = extractAgentNameFromAgentId(agentId);
    if (agentName !== 'default') return null;

    const prisma = _prisma;
    if (!prisma) return null;

    return {
      name: 'enterprise_agents_list',
      label: '我的 Agent 列表',
      description:
        '列出当前用户拥有的所有企业 Agent（主 Agent + 各专业 Agent），包含名称、职能描述和专长。' +
        '用于了解可用的专业 Agent，便于决策和协作。',
      parameters: Type.Object({}),
      async execute(_toolCallId: string) {
        try {
          const agents = await prisma.$queryRaw<
            Array<{
              name: string;
              description: string | null;
              identity: string | null;
              is_default: number;
              system_prompt: string | null;
            }>
          >`
            SELECT name, description, identity, is_default, system_prompt
            FROM agents
            WHERE owner_id = ${userId} AND enabled = 1
            ORDER BY is_default DESC, created_at ASC
          `;

          const formatted = agents.map((a: any) => {
            a = { ...a, isDefault: !!a.is_default, systemPrompt: a.system_prompt };
            let identity: { name?: string; emoji?: string } | null = null;
            try { identity = a.identity ? JSON.parse(a.identity) : null; } catch { /* ignore */ }
            const displayName = identity?.name || a.name;
            const emoji = identity?.emoji ? `${identity.emoji} ` : '';
            const role = a.isDefault ? '主 Agent' : '专业 Agent';
            const desc = a.description ? `\n  职能：${a.description}` : '';
            const prompt =
              a.systemPrompt && !a.isDefault
                ? `\n  专长：${a.systemPrompt.slice(0, 120)}${a.systemPrompt.length > 120 ? '...' : ''}`
                : '';
            return `- ${emoji}**${displayName}**（${role}，agent 名称：\`${a.name}\`）${desc}${prompt}`;
          });

          const text =
            formatted.length > 0
              ? `你共有 ${agents.length} 个 Agent：\n\n${formatted.join('\n\n')}`
              : '暂无 Agent';

          return {
            content: [{ type: 'text' as const, text }],
            details: { count: agents.length, userId },
          };
        } catch (err: any) {
          return {
            content: [{ type: 'text' as const, text: `查询失败：${err.message}` }],
            details: { error: err.message },
          };
        }
      },
    };
  });

  // ── send_im_message（通用 IM 发消息工具）──────────────────────────────────
  // 通过 HTTP 调用企业 gateway 内部 API，与具体 IM 渠道解耦。
  // 以后新增钉钉/企微等渠道只需在企业 gateway 添加 Adapter，此处无需改动。
  const _imGatewayPort = process.env['GATEWAY_PORT'] || '18790';
  const _imInternalToken = process.env['INTERNAL_API_TOKEN'] || '';

  api.registerTool((ctx: { agentId?: string }) => {
    const agentId = ctx?.agentId;
    if (!agentId) return null;

    const userId = extractUserIdFromAgentId(agentId);
    if (!userId) return null;

    return {
      name: 'send_im_message',
      label: '发送即时消息',
      description:
        '向当前用户绑定的所有即时通讯渠道（飞书、钉钉等）发送文本消息。' +
        '消息将同时推送到用户绑定的所有 IM 渠道。',
      parameters: Type.Object({
        message: Type.String({
          description: '要发送的消息文本内容',
        }),
      }),
      async execute(_toolCallId: string, params: { message: string }) {
        const { message } = params;
        if (!message?.trim()) {
          return {
            content: [{ type: 'text' as const, text: '消息内容不能为空' }],
            details: { error: 'empty message' },
          };
        }

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          const resp = await fetch(`http://127.0.0.1:${_imGatewayPort}/api/_internal/im/send`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ..._imInternalToken ? { 'x-internal-token': _imInternalToken } : {},
            },
            body: JSON.stringify({ userId, message: message.trim() }),
            signal: controller.signal,
          });
          clearTimeout(timeout);

          if (!resp.ok) {
            const body = await resp.json().catch(() => ({ error: resp.statusText }));
            throw new Error((body as any).error || `HTTP ${resp.status}`);
          }

          const result = await resp.json() as { sent: number };
          const text = result.sent > 0
            ? `消息已发送到 ${result.sent} 个 IM 渠道`
            : '未找到已绑定的 IM 渠道，消息未发送（用户需先通过 /bind 命令绑定 IM 账号）';

          return {
            content: [{ type: 'text' as const, text }],
            details: { sent: result.sent, userId },
          };
        } catch (err: any) {
          console.error(`[enterprise-mcp] send_im_message failed:`, err.message);
          return {
            content: [{ type: 'text' as const, text: `发送失败：${err.message}` }],
            details: { error: err.message },
          };
        }
      },
    };
  });

  // ── run_skill（企业/个人 Skill 执行工具）──────────────────────────────────
  // 通过 ToolFactory 注册：根据 agent 的 skillsFilter 控制可见性
  const _dataRoot = process.env['DATA_ROOT'] || './data';
  _dataRootGlobal = _dataRoot;

  api.registerTool((ctx: { agentId?: string }) => {
    const agentId = ctx?.agentId;
    if (!agentId) return null;

    const userId = extractUserIdFromAgentId(agentId);
    if (!userId) return null;

    const agentName = extractAgentNameFromAgentId(agentId);
    if (!_prisma) return null;

    return {
      name: 'run_skill',
      label: '执行技能脚本',
      description:
        '执行已注册的企业或个人技能脚本。根据技能名称自动查找对应脚本并在用户工作空间中隔离执行。' +
        '企业级技能在宿主机子进程中执行，个人技能在 Docker 容器中执行。' +
        '执行结果包括标准输出、错误输出和生成的文件列表。',
      parameters: Type.Object({
        skill_name: Type.String({
          description: '技能名称，与可用技能列表中的名称一致',
        }),
        script: Type.Optional(Type.String({
          description: '指定要执行的脚本相对路径（相对于技能目录），例如 "scripts/data_analyzer.py"。不指定时自动发现入口脚本。',
        })),
        args: Type.Optional(Type.String({
          description: '传递给脚本的命令行参数字符串，例如 "--data sales.xlsx --output outputs/report.html"。如果不需要参数可以留空。',
        })),
      }),
      async execute(_toolCallId: string, params: { skill_name: string; script?: string; args?: string }) {
        // execute 时重新取最新的 _prisma（避免闭包捕获旧引用）
        const prisma = _prisma;
        if (!prisma) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: '数据库连接未就绪，请稍后重试' }) }],
          };
        }

        const skillName = params.skill_name;
        if (!skillName) {
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: '缺少 skill_name 参数' }) }],
          };
        }

        try {
          // 1. 从数据库查找技能
          const skill = await prisma.skill.findFirst({
            where: {
              name: skillName,
              enabled: true,
              OR: [
                { scope: 'enterprise', status: 'approved' },
                { scope: 'personal', ownerId: userId, status: 'active' },
              ],
            },
          });

          if (!skill) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `未找到可用的技能: "${skillName}"。请确认技能名称正确且已启用。`,
              }) }],
            };
          }

          // 2. skillsFilter 校验（enterprise scope 豁免）
          if (skill.scope !== 'enterprise' && agentName && prisma) {
            try {
              const agentRow = await prisma.$queryRaw<Array<{ skills_filter: string | null }>>`
                SELECT skills_filter FROM agents
                WHERE owner_id = ${userId} AND name = ${agentName} AND enabled = 1
                LIMIT 1
              `;
              if (agentRow.length > 0) {
                const raw = agentRow[0].skills_filter;
                const sf: string[] | null = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
                if (!Array.isArray(sf) || sf.length === 0) {
                  return {
                    content: [{ type: 'text' as const, text: JSON.stringify({
                      error: `Agent "${agentName}" 未被授权使用技能`,
                    }) }],
                  };
                }
                if (!sf.includes(skill.name) && !sf.includes(skill.id)) {
                  return {
                    content: [{ type: 'text' as const, text: JSON.stringify({
                      error: `Agent "${agentName}" 未被授权使用技能 "${skillName}"`,
                    }) }],
                  };
                }
              }
            } catch { /* DB 查询失败不阻塞，降级放行 */ }
          }

          // 3. 解析技能目录路径
          const skillPath = skill.scope === 'enterprise'
            ? path.resolve(_dataRoot, 'skills', skill.id)
            : path.resolve(_dataRoot, 'users', skill.ownerId || userId, 'workspace', 'skills', skill.id);

          if (!fs.existsSync(skillPath)) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `技能目录不存在: ${skillPath}。技能可能未正确安装。`,
              }) }],
            };
          }

          // 4. 确定入口脚本（支持 script 参数指定）
          let scriptRelPath: string | null = null;
          if (params.script) {
            const scriptAbs = path.resolve(skillPath, params.script);
            if (!scriptAbs.startsWith(path.resolve(skillPath) + path.sep)) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                  error: `安全拦截：脚本路径 "${params.script}" 超出技能目录范围`,
                }) }],
              };
            }
            if (!fs.existsSync(scriptAbs)) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({
                  error: `指定的脚本不存在: ${params.script}`,
                }) }],
              };
            }
            scriptRelPath = params.script;
          } else {
            scriptRelPath = await resolveSkillScript(skill, skillPath);
          }
          if (!scriptRelPath) {
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({
                error: `无法确定技能 "${skillName}" 的入口脚本。请检查目录中是否包含可执行脚本。`,
              }) }],
            };
          }

          // 5. 用户 workspace 和 outputs 目录（专业 agent 使用独立工作空间）
          const userWorkspacePath = agentName && agentName !== 'default'
            ? path.resolve(_dataRoot, 'users', userId, 'agents', agentName, 'workspace')
            : path.resolve(_dataRoot, 'users', userId, 'workspace');
          const outputsPath = path.join(userWorkspacePath, 'outputs');
          if (!fs.existsSync(outputsPath)) {
            await fsp.mkdir(outputsPath, { recursive: true });
          }

          // 6. 解析参数
          const argsArray = params.args ? parseSkillArgs(params.args) : [];

          // 7. 检测依赖：如有 requirements.txt 但缺 packages/，执行前自动安装（容错）
          const packagesDir = path.join(skillPath, 'packages');
          const requirementsPath = path.join(skillPath, 'requirements.txt');
          if (!fs.existsSync(packagesDir) && fs.existsSync(requirementsPath) && skill.scope === 'personal') {
            console.log(`[enterprise-mcp][run_skill] Auto-installing deps for ${skillName}...`);
            try {
              fs.mkdirSync(packagesDir, { recursive: true });
              const { execSync } = await import('child_process');
              const venvPip = path.resolve(_dataRoot, 'skills', '.venv', 'bin', 'pip');
              const pipCmd = fs.existsSync(venvPip) ? venvPip : 'pip';
              execSync(`${pipCmd} install --target "${packagesDir}" -r "${requirementsPath}" --quiet --disable-pip-version-check`, {
                timeout: 300000,
                stdio: 'pipe',
              });
              console.log(`[enterprise-mcp][run_skill] Deps installed for ${skillName}`);
            } catch (e: any) {
              console.warn(`[enterprise-mcp][run_skill] Auto-install failed: ${e.message}`);
            }
          }
          const hasPackages = fs.existsSync(packagesDir);
          const extraEnv: Record<string, string> = {};
          if (hasPackages) {
            const pkgPath = skill.scope === 'enterprise'
              ? path.resolve(skillPath, 'packages')
              : `/workspace/skills/${skill.id}/packages`;
            extraEnv['PYTHONPATH'] = pkgPath;
          }
          // 注入用户数据库连接环境变量（DB_{name}_HOST 等）
          if (userId && prisma) {
            const userEnv = await loadUserEnv(userId, prisma);
            Object.assign(extraEnv, userEnv);
          }

          // 8. 执行
          console.log(`[enterprise-mcp][run_skill] Executing "${skillName}" (${skill.id}), script: ${scriptRelPath}, scope: ${skill.scope}, args: [${argsArray.join(', ')}]`);

          // 配额拦截：超限时拒绝执行 Skill
          try {
            const quotaStatus = await checkUserQuota(userId, _dataRoot);
            if (quotaStatus.exceeded) {
              const usedMB = Math.round(quotaStatus.used / 1024 / 1024);
              const limitMB = Math.round(quotaStatus.limit / 1024 / 1024);
              return {
                content: [{
                  type: 'text' as const,
                  text: `❌ 存储配额已超限（已用 ${usedMB}MB / 限额 ${limitMB}MB），请让用户清理 outputs 目录后重试。`,
                }],
              };
            }
          } catch { /* 配额检查失败不阻断执行 */ }

          let result: SkillExecResult;
          if (skill.scope === 'enterprise') {
            // 企业 Skill: 宿主机子进程执行
            result = await executeSkillInProcess(skillPath, scriptRelPath, argsArray, userWorkspacePath, outputsPath, extraEnv);
          } else {
            // 个人 Skill: Docker 容器执行
            result = await executeSkillInDocker(skill.id, skillPath, scriptRelPath, argsArray, userWorkspacePath, outputsPath, extraEnv);
          }

          // 9. 构建返回
          console.log(`[enterprise-mcp][run_skill] Result: success=${result.success}, exitCode=${result.exitCode}, duration=${result.duration}ms, stderr=${(result.stderr || '').substring(0, 500)}`);
          const response: Record<string, any> = {
            success: result.success,
            exitCode: result.exitCode,
            duration: `${result.duration}ms`,
          };

          if (result.stdout) {
            response.stdout = result.stdout.length > 5000
              ? result.stdout.substring(0, 5000) + '\n... (输出已截断)'
              : result.stdout;
          }
          if (result.stderr) {
            response.stderr = result.stderr.length > 2000
              ? result.stderr.substring(0, 2000) + '\n... (错误输出已截断)'
              : result.stderr;
          }

          // 收集 outputs 目录的文件列表
          const outputFiles = await collectOutputFiles(outputsPath);

          // 注册生成的文件到数据库
          if (prisma && outputFiles.length > 0) {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // outputs 默认 7 天过期
            try {
              for (const relPath of outputFiles) {
                const fileId = `${userId}:outputs/${relPath}`;
                const absPath = path.join(outputsPath, relPath);
                let fileSize = 0;
                try { fileSize = (await fsp.stat(absPath)).size; } catch { /* 忽略 */ }
                await prisma.generatedFile.upsert({
                  where: { id: fileId },
                  update: { fileSize, expiresAt, status: 'active', skillId: skill.id, agentName: agentName || null },
                  create: {
                    id: fileId,
                    userId,
                    category: 'output',
                    filePath: `outputs/${relPath}`,
                    fileSize,
                    skillId: skill.id,
                    agentName: agentName || null,
                    expiresAt,
                    status: 'active',
                  },
                });
              }
            } catch (regErr: any) {
              console.warn('[mcp] 文件注册失败（不影响执行）:', regErr.message);
            }
          }

          if (outputFiles.length > 0) {
            response.outputFiles = outputFiles;
            response.message = `技能执行${result.success ? '成功' : '失败'}，生成了 ${outputFiles.length} 个文件到 outputs/ 目录`;
          } else {
            response.message = `技能执行${result.success ? '成功' : '失败'}`;
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(response) }],
            details: response,
          };
        } catch (err: any) {
          console.error(`[enterprise-mcp][run_skill] Error executing "${skillName}":`, err.message);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify({ error: `技能执行出错: ${err.message}` }) }],
            details: { error: err.message },
          };
        }
      },
    };
  });

  // gateway 停止时清理（幂等）
  api.on('gateway_stop', () => {
    // 清理个人 MCP 刷新定时器，防止 setInterval 泄漏
    if (_refreshInterval) {
      clearInterval(_refreshInterval);
      _refreshInterval = null;
    }
    if (_executor) {
      _executor.disconnectAll();
      _executor = null;
    }
    if (_prisma) {
      _prisma.$disconnect().catch(() => {});
      _prisma = null;
    }
    _initDone = false;
    api.logger.info('all MCP connections closed');
  });

  // ── 个人 MCP 动态刷新（文件信号 + 定时轮询）──
  const REFRESH_SIGNAL_PATH = path.join(
    process.env.OCTOPUS_STATE_DIR || path.join(__dirname, '..', '..', '..', '.octopus-state'),
    'mcp-refresh-signal'
  );
  let _lastRefreshCheck = 0;
  const REFRESH_INTERVAL = 30_000; // 30s

  // 保存 interval ID，以便 gateway_stop 时清理
  _refreshInterval = setInterval(async () => {
    try {
      const stat = fs.statSync(REFRESH_SIGNAL_PATH);
      const mtime = stat.mtimeMs;
      if (mtime > _lastRefreshCheck && _executor && _prisma && _initDone) {
        _lastRefreshCheck = Date.now();
        api.logger.info('personal MCP refresh signal detected, reloading...');
        await refreshPersonalMCPServers(api, _executor, _prisma);
      }
    } catch {
      // 信号文件不存在，跳过
    }
  }, REFRESH_INTERVAL);

  api.logger.info('enterprise-mcp plugin registered');
}

async function initMCPServers(api: any, executor: MCPExecutor, prisma: PrismaClient) {
  try {
    await prisma.$connect();
  } catch (err: any) {
    api.logger.error(`DB connection failed: ${err.message}`);
    return;
  }

  let servers: any[];
  try {
    servers = await prisma.mCPServer.findMany({
      where: { scope: 'enterprise', enabled: true },
    });
  } catch (err: any) {
    api.logger.error(`failed to query MCP servers: ${err.message}`);
    return;
  }

  if (servers.length === 0) {
    api.logger.info('no enterprise MCP servers configured');
    _initDone = true;
    return;
  }

  api.logger.info(`found ${servers.length} enterprise MCP server(s)`);

  const freshCache: CachedMCPTool[] = [];

  for (const server of servers) {
    try {
      await executor.connect({
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command || undefined,
        args: Array.isArray(server.args) ? server.args : [],
        url: server.url || undefined,
        env:
          server.env && typeof server.env === 'object'
            ? (server.env as Record<string, string>)
            : {},
      });

      const tools = await executor.listTools(server.id);
      api.logger.info(`${server.name}: ${tools.length} tool(s) registered`);

      for (const tool of tools) {
        const toolName = nativeToolName(server.id, tool.name);

        // 注册到当前 api（本次 workspace 的 plugin registry）
        registerMCPTool(api, executor, server, tool, toolName);

        // 收集到新缓存
        freshCache.push({
          serverId: server.id,
          serverName: server.name,
          toolName: tool.name,
          nativeToolName: toolName,
          description: tool.description || tool.name,
          inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
        });
      }
    } catch (err: any) {
      api.logger.warn(`failed to connect MCP server ${server.name}: ${err.message}`);
    }
  }

  // ── 加载个人 MCP Server ──
  let personalServers: any[];
  try {
    personalServers = await prisma.mCPServer.findMany({
      where: { scope: 'personal', enabled: true },
    });
  } catch (err: any) {
    api.logger.warn(`failed to query personal MCP servers: ${err.message}`);
    personalServers = [];
  }

  if (personalServers.length > 0) {
    api.logger.info(`found ${personalServers.length} personal MCP server(s)`);
  }

  for (const server of personalServers) {
    try {
      const serverCfg = {
        id: server.id,
        name: server.name,
        transport: server.transport,
        command: server.command || undefined,
        args: Array.isArray(server.args) ? (server.args as string[]) : [],
        url: server.url || undefined,
        env: server.env && typeof server.env === 'object'
          ? (server.env as Record<string, string>) : {},
        scope: 'personal' as const,
        ownerId: server.ownerId,
      };
      // 个人 MCP 使用 ownerId 作为 userId，实现 per-user 连接隔离
      await executor.connect(serverCfg, server.ownerId || undefined);

      const tools = await executor.listTools(server.id, server.ownerId || undefined);
      api.logger.info(`personal ${server.name} (owner=${server.ownerId}): ${tools.length} tool(s)`);

      for (const tool of tools) {
        const toolName = personalToolName(server.id, tool.name);
        registerPersonalMCPTool(api, executor, server, tool, toolName);

        freshCache.push({
          serverId: server.id,
          serverName: server.name,
          toolName: tool.name,
          nativeToolName: toolName,
          description: tool.description || tool.name,
          inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
          scope: 'personal',
          ownerId: server.ownerId,
        });
      }
      _registeredPersonalTools.add(`mcp_p_${server.id}`.replace(/[^a-zA-Z0-9_]/g, '_'));
    } catch (err: any) {
      api.logger.warn(`failed to connect personal MCP ${server.name}: ${err.message}`);
    }
  }

  // 写入磁盘缓存（下次模块加载时可同步读取）
  _cachedTools = freshCache;
  _initDone = true;
  try {
    // Atomic write: 先写 .tmp 再 rename，防止进程崩溃时产生损坏的缓存文件
    const tmpPath = TOOLS_CACHE_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(freshCache, null, 2));
    fs.renameSync(tmpPath, TOOLS_CACHE_PATH);
    api.logger.info(`enterprise-mcp: tool cache written (${freshCache.length} tools)`);
  } catch (err: any) {
    api.logger.warn(`enterprise-mcp: failed to write tool cache: ${err.message}`);
  }

  // 预热 mcpFilter 缓存：查询所有 agent 的 mcp_filter，避免首次请求时工具可见性判断失效
  try {
    const allAgents = await prisma.$queryRaw<Array<{ owner_id: string; name: string; mcp_filter: string | null }>>`
      SELECT owner_id, name, mcp_filter FROM agents WHERE enabled = 1
    `;
    for (const a of allAgents) {
      let filter: string[] | null = null;
      if (a.mcp_filter) {
        const parsed = typeof a.mcp_filter === 'string' ? JSON.parse(a.mcp_filter) : a.mcp_filter;
        if (Array.isArray(parsed) && parsed.length > 0) filter = parsed;
      }
      _filterCache.set(`mcpFilter:${a.owner_id}:${a.name}`, { data: filter, ts: Date.now() });
    }
    api.logger.info(`enterprise-mcp: preloaded mcpFilter cache for ${allAgents.length} agent(s)`);
  } catch (err: any) {
    api.logger.warn(`enterprise-mcp: failed to preload mcpFilter cache: ${err.message}`);
  }
}

/** ToolFactory 可见性检查（同步，基于缓存）：企业 MCP 工具仅对 mcpFilter 白名单内 agent 可见 */
function isMcpToolVisibleToAgent(agentId: string, serverName: string, serverId: string): boolean {
  const userId = extractUserIdFromAgentId(agentId);
  const agentName = extractAgentNameFromAgentId(agentId);
  if (!userId || !agentName) return true; // 无法判断时放行（execute 时会做硬校验）
  const cacheKey = `mcpFilter:${userId}:${agentName}`;
  const cached = _filterCache.get(cacheKey);
  if (!cached) return true; // 无缓存时放行
  // ToolFactory 可见性过滤不检查 TTL（execute 时会做实时校验）
  return isMcpServerAllowed(serverName, cached.data) || isMcpServerAllowed(serverId, cached.data);
}

/** 注册已连接 executor 上的企业 MCP 工具 */
function registerMCPTool(api: any, executor: MCPExecutor, server: any, tool: MCPTool, toolName: string) {
  api.registerTool(function (ctx: any) {
    const agentId = ctx?.agentId || '';
    if (!isMcpToolVisibleToAgent(agentId, server.name, server.id)) return null;

    return {
      name: toolName,
      label: `[MCP] ${server.name}: ${tool.name}`,
      description: `${tool.description || tool.name} (来自企业 MCP Server: ${server.name})`,
      parameters: Type.Unsafe((tool.inputSchema as any) || { type: 'object', properties: {} }),
      async execute(_toolCallId: string, params: any) {
        return executeMCPTool(executor, ctx?.agentId || '', server.id, server.name, tool.name, params, {
          scope: 'enterprise', waitForReady: false,
        });
      },
    };
  });
}

/** 从磁盘缓存注册企业 MCP 工具（executor 尚未就绪时的同步注册，execute 里等待 executor 就绪）*/
function registerMCPToolFromCache(api: any, cached: CachedMCPTool) {
  api.registerTool(function (ctx: any) {
    const agentId = ctx?.agentId || '';
    if (!isMcpToolVisibleToAgent(agentId, cached.serverName, cached.serverId)) return null;

    return {
      name: cached.nativeToolName,
      label: `[MCP] ${cached.serverName}: ${cached.toolName}`,
      description: `${cached.description} (来自企业 MCP Server: ${cached.serverName})`,
      parameters: Type.Unsafe((cached.inputSchema as any) || { type: 'object', properties: {} }),
      async execute(_toolCallId: string, params: any) {
        return executeMCPTool(null, ctx?.agentId || '', cached.serverId, cached.serverName, cached.toolName, params, {
          scope: 'enterprise', waitForReady: true,
        });
      },
    };
  });
}

/** 注册个人 MCP 工具（ToolFactory：仅对所有者可见） */
function registerPersonalMCPTool(
  api: any,
  executor: MCPExecutor,
  server: any,
  tool: MCPTool,
  toolName: string,
) {
  api.registerTool(function (ctx: any) {
    const agentId = ctx?.agentId || '';
    const userId = extractUserIdFromAgentId(agentId);
    if (!userId || userId !== server.ownerId) return null;

    return {
      name: toolName,
      label: `[个人 MCP] ${server.name}: ${tool.name}`,
      description: `${tool.description || tool.name} (个人 MCP: ${server.name})`,
      parameters: Type.Unsafe((tool.inputSchema as any) || { type: 'object', properties: {} }),
      async execute(_toolCallId: string, params: any) {
        return executeMCPTool(executor, agentId, server.id, server.name, tool.name, params, {
          scope: 'personal', waitForReady: false, ownerId: server.ownerId,
        });
      },
    };
  });
}

/** 从缓存注册个人 MCP 工具（启动时 executor 未就绪） */
function registerPersonalMCPToolFromCache(api: any, cached: CachedMCPTool) {
  api.registerTool(function (ctx: any) {
    const agentId = ctx?.agentId || '';
    const userId = extractUserIdFromAgentId(agentId);
    if (!userId || userId !== cached.ownerId) return null;

    return {
      name: cached.nativeToolName,
      label: `[个人 MCP] ${cached.serverName}: ${cached.toolName}`,
      description: `${cached.description} (个人 MCP: ${cached.serverName})`,
      parameters: Type.Unsafe((cached.inputSchema as any) || { type: 'object', properties: {} }),
      async execute(_toolCallId: string, params: any) {
        return executeMCPTool(null, agentId, cached.serverId, cached.serverName, cached.toolName, params, {
          scope: 'personal', waitForReady: true, ownerId: cached.ownerId,
        });
      },
    };
  });
}

/** 重新加载个人 MCP（CRUD 变更后调用） */
async function refreshPersonalMCPServers(api: any, executor: MCPExecutor, prisma: PrismaClient) {
  try {
    const personalServers = await prisma.mCPServer.findMany({
      where: { scope: 'personal', enabled: true },
    });

    let changed = false;
    for (const server of personalServers) {
      const toolNamePrefix = `mcp_p_${server.id}`.replace(/[^a-zA-Z0-9_]/g, '_');
      const alreadyRegistered = _registeredPersonalTools.has(toolNamePrefix);

      try {
        const serverCfg = {
          id: server.id,
          name: server.name,
          transport: server.transport,
          command: server.command || undefined,
          url: server.url || undefined,
          args: Array.isArray(server.args) ? (server.args as string[]) : [],
          env: server.env && typeof server.env === 'object'
            ? (server.env as Record<string, string>) : {},
          scope: 'personal' as const,
          ownerId: server.ownerId,
        };

        // 断旧连接再重连（处理 session 过期）
        executor.disconnect(server.id, server.ownerId || undefined);
        await executor.connect(serverCfg, server.ownerId || undefined);
        const tools = await executor.listTools(server.id, server.ownerId || undefined);

        if (!alreadyRegistered) {
          for (const tool of tools) {
            const toolName = personalToolName(server.id, tool.name);
            registerPersonalMCPTool(api, executor, server, tool, toolName);
          }
          _registeredPersonalTools.add(toolNamePrefix);
          changed = true;
        }
        api.logger.info(`personal MCP refreshed: ${server.name} (${tools.length} tools)`);
      } catch (err: any) {
        api.logger.warn(`personal MCP refresh failed for ${server.name}: ${err.message}`);
      }
    }

    // 刷新成功后更新缓存文件（确保重启后不丢失 personal 工具）
    if (changed && _cachedTools) {
      // 重建完整缓存：保留企业工具 + 新增 personal 工具
      const enterpriseCache = _cachedTools.filter((t: any) => t.scope !== 'personal');
      const personalCache: CachedMCPTool[] = [];
      for (const server of personalServers) {
        try {
          const tools = await executor.listTools(server.id, server.ownerId || undefined);
          for (const tool of tools) {
            personalCache.push({
              serverId: server.id,
              serverName: server.name,
              toolName: tool.name,
              nativeToolName: personalToolName(server.id, tool.name),
              description: tool.description || tool.name,
              inputSchema: (tool.inputSchema as Record<string, unknown>) || {},
              scope: 'personal',
              ownerId: server.ownerId,
            });
          }
        } catch { /* server 可能刚刚 refresh 失败，跳过 */ }
      }
      const freshCache = [...enterpriseCache, ...personalCache];
      _cachedTools = freshCache;
      try {
        const tmpPath = TOOLS_CACHE_PATH + '.tmp';
        fs.writeFileSync(tmpPath, JSON.stringify(freshCache, null, 2));
        fs.renameSync(tmpPath, TOOLS_CACHE_PATH);
        api.logger.info(`enterprise-mcp: tool cache updated (${freshCache.length} tools)`);
      } catch (err: any) {
        api.logger.warn(`enterprise-mcp: failed to write tool cache: ${err.message}`);
      }
    }
  } catch (err: any) {
    api.logger.error(`personal MCP refresh query failed: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// run_skill 辅助函数
// ═══════════════════════════════════════════════════════════════════════════

interface SkillExecResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

/** 确定技能的入口脚本路径（相对于 skill 目录） */
async function resolveSkillScript(skill: any, skillPath: string): Promise<string | null> {
  // 1. command 字段
  if (skill.command) {
    const cmdPath = skill.command.split(' ')[0];
    if (fs.existsSync(path.join(skillPath, cmdPath))) return cmdPath;
  }
  // 2. scriptPath 字段
  if (skill.scriptPath) {
    if (fs.existsSync(path.join(skillPath, skill.scriptPath))) return skill.scriptPath;
  }
  // 3. 常见入口文件
  const candidates = [
    'main.py', 'index.py', 'run.py', 'app.py',
    'main.js', 'index.js', 'run.js',
    'main.sh', 'run.sh', 'start.sh',
    'main.ts', 'index.ts',
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(skillPath, c))) return c;
  }
  // 4. scripts/ 子目录
  const scriptsDir = path.join(skillPath, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    try {
      const entries = await fsp.readdir(scriptsDir);
      const scriptFile = entries.find(f => /\.(py|js|sh|ts)$/.test(f));
      if (scriptFile) return path.join('scripts', scriptFile);
    } catch { /* ignore */ }
  }
  return null;
}

/** 根据扩展名确定解释器（Python 优先使用 skills 共享 venv） */
function getInterpreter(scriptPath: string): string | null {
  const ext = path.extname(scriptPath).toLowerCase();
  switch (ext) {
    case '.py': {
      // 优先使用 skills 共享虚拟环境的 python3
      const venvPython = path.resolve(_dataRootGlobal, 'skills', '.venv', 'bin', 'python3');
      return fs.existsSync(venvPython) ? venvPython : 'python3';
    }
    case '.js': return 'node';
    case '.sh': return 'bash';
    case '.ts': return 'npx';
    default: return null;
  }
}

/** 在宿主机子进程中执行 Skill（企业级） */
function executeSkillInProcess(
  skillPath: string,
  scriptRelPath: string,
  args: string[],
  userWorkspacePath: string,
  outputsPath: string,
  extraEnv: Record<string, string>,
): Promise<SkillExecResult> {
  const startTime = Date.now();
  const timeout = 300_000; // 5 min
  const scriptAbsPath = path.resolve(skillPath, scriptRelPath);

  // 安全校验
  const skillRoot = path.resolve(skillPath);
  if (!scriptAbsPath.startsWith(skillRoot + path.sep) && scriptAbsPath !== skillRoot) {
    return Promise.resolve({
      success: false, exitCode: 1, stdout: '', duration: 0,
      stderr: `安全拦截：脚本路径 "${scriptRelPath}" 超出 skill 目录范围`,
    });
  }
  if (!fs.existsSync(scriptAbsPath)) {
    return Promise.resolve({
      success: false, exitCode: -1, stdout: '', duration: 0,
      stderr: `脚本不存在: ${scriptRelPath}`,
    });
  }

  const interpreter = getInterpreter(scriptAbsPath);
  const cmd = interpreter || scriptAbsPath;
  const cmdArgs = interpreter ? [scriptAbsPath, ...args] : args;
  // npx 需要额外参数：npx tsx script.ts ...
  if (interpreter === 'npx') {
    cmdArgs.unshift('tsx');
  }

  return new Promise<SkillExecResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child: ChildProcess = spawn(cmd, cmdArgs, {
      cwd: userWorkspacePath,
      env: {
        ...extraEnv,
        PATH: process.env.PATH || '/usr/bin:/usr/local/bin',
        HOME: userWorkspacePath,
        PYTHONIOENCODING: 'utf-8',
        LANG: 'en_US.UTF-8',
        WORKSPACE_PATH: userWorkspacePath,
        OUTPUTS_PATH: outputsPath,
        SKILL_DIR: skillPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > 1024 * 1024) { child.kill('SIGKILL'); killed = true; }
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > 1024 * 1024) { child.kill('SIGKILL'); killed = true; }
    });

    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: !killed && code === 0,
        exitCode: code ?? -1,
        stdout: stdout.substring(0, 100_000),
        stderr: killed
          ? `执行超时或输出过大，已强制终止\n${stderr.substring(0, 10_000)}`
          : stderr.substring(0, 100_000),
        duration: Date.now() - startTime,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false, exitCode: -1, stdout,
        stderr: `进程启动失败: ${err.message}`,
        duration: Date.now() - startTime,
      });
    });
  });
}

/** 在 Docker 容器中执行 Skill（个人级） */
function executeSkillInDocker(
  skillId: string,
  skillPath: string,
  scriptRelPath: string,
  args: string[],
  userWorkspacePath: string,
  outputsPath: string,
  extraEnv: Record<string, string>,
): Promise<SkillExecResult> {
  const startTime = Date.now();
  const timeout = 305_000; // 5 min + 5s Docker overhead
  const image = 'octopus-sandbox:enterprise';

  // 安全校验：防止路径穿越
  const normalized = path.normalize(scriptRelPath);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    return Promise.resolve({
      success: false, exitCode: 1, stdout: '', duration: 0,
      stderr: `安全拦截：脚本路径 "${scriptRelPath}" 不合法`,
    });
  }

  // 构建容器内命令
  const containerScriptPath = `/skill/${normalized}`;
  const ext = path.extname(scriptRelPath).toLowerCase();
  let dockerCmd: string[];
  switch (ext) {
    case '.py': dockerCmd = ['python3', containerScriptPath, ...args]; break;
    case '.js': dockerCmd = ['node', containerScriptPath, ...args]; break;
    case '.sh': dockerCmd = ['bash', containerScriptPath, ...args]; break;
    default: dockerCmd = [containerScriptPath, ...args]; break;
  }

  const dockerArgs = [
    'run', '--rm',
    `--memory=${sandboxConfig.skill.memory}`, `--cpus=${sandboxConfig.skill.cpus}`,
    `--network=${sandboxConfig.skill.network}`,
    '-v', `${skillPath}:/skill:ro`,
    '-v', `${userWorkspacePath}:/workspace`,
    '-w', '/workspace',
    ...Object.entries(extraEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
    '-e', 'WORKSPACE_PATH=/workspace',
    '-e', 'OUTPUTS_PATH=/workspace/outputs',
    '-e', 'SKILL_DIR=/skill',
    '-e', 'PYTHONIOENCODING=utf-8',
    image,
    ...dockerCmd,
  ];

  return new Promise<SkillExecResult>((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn('docker', dockerArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: !killed && code === 0,
        exitCode: code ?? -1,
        stdout: stdout.substring(0, 100_000),
        stderr: killed
          ? `容器执行超时\n${stderr.substring(0, 10_000)}`
          : stderr.substring(0, 100_000),
        duration: Date.now() - startTime,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false, exitCode: -1, stdout: '',
        stderr: `Docker 启动失败: ${err.message}`,
        duration: Date.now() - startTime,
      });
    });
  });
}

/** 收集 outputs 目录文件列表 */
async function collectOutputFiles(outputsDir: string): Promise<string[]> {
  if (!fs.existsSync(outputsDir)) return [];
  const files: string[] = [];
  const walk = async (dir: string) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        files.push(path.relative(outputsDir, fullPath));
      }
    }
  };
  await walk(outputsDir);
  return files;
}

/** 检查用户存储配额（轻量版，不依赖 WorkspaceManager 实例） */
async function checkUserQuota(userId: string, dataRoot: string): Promise<{
  used: number; limit: number; exceeded: boolean;
}> {
  const userRoot = path.join(dataRoot, 'users', userId);
  if (!fs.existsSync(userRoot)) return { used: 0, limit: 5 * 1024 * 1024 * 1024, exceeded: false };

  // 读取用户元数据中的配额设置（与 WorkspaceManager.checkQuota 保持一致）
  let limitGB = 5; // 默认 5GB
  try {
    const metaPath = path.join(userRoot, 'metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(await fsp.readFile(metaPath, 'utf-8'));
      if (meta.quotas?.storage) limitGB = meta.quotas.storage;
    }
  } catch { /* 读取失败用默认值 */ }

  let used = 0;
  const walk = async (dir: string) => {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) { const s = await fsp.stat(p); used += s.size; }
      }
    } catch { /* 忽略权限错误 */ }
  };
  await walk(userRoot);

  const limit = limitGB * 1024 * 1024 * 1024;
  return { used, limit, exceeded: used > limit };
}

/** 解析参数字符串为数组（支持引号分隔） */
function parseSkillArgs(argsStr: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inQuote) {
      if (ch === quoteChar) { inQuote = false; } else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = true; quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) { result.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) result.push(current);
  return result;
}
