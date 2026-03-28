/**
 * AgentConfigSync — 统一 agent 原生配置同步
 *
 * 通过引擎 RPC（agents.update / agents.delete）同步 agent 配置，
 * 仅 memory scope 仍需 configTransaction（plugin 配置无专用 RPC）。
 *
 * ensureAndSyncNativeAgent — 统一 agent 原生引擎同步（创建 + 文件写入）
 * 合并 chat.ts ensureNativeAgent 与 agents.ts syncToNative 的共享逻辑。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { EngineAdapter } from './EngineAdapter';
import { TenantEngineAdapter } from './TenantEngineAdapter';
import type { WorkspaceManager } from '@octopus/workspace';
import { getSoulTemplate } from './SoulTemplate';
import { createLogger } from '../utils/logger';
import { readToolsCache } from '../utils/tools-cache';
import type { EngineConfig } from '../types/engine';

const logger = createLogger('AgentConfigSync');

/**
 * 根据 toolsFilter（read/write/exec 三组）计算需要 deny 的文件/命令工具
 */
function computeToolsDeny(toolsFilter: string[] | null): string[] {
  const deny: string[] = [];
  const tf = new Set(toolsFilter || []);
  if (!tf.has('read'))  deny.push('read', 'edit', 'apply_patch');
  if (!tf.has('write')) deny.push('write');
  if (!tf.has('exec'))  deny.push('exec', 'process');
  return deny;
}

/** 从 tools-cache.json 读取所有 MCP 工具，返回 { serverId, nativeToolName }[] */
function readMcpToolsCache(): Array<{ serverId: string; nativeToolName: string }> {
  return readToolsCache();
}

/** 根据 mcpFilter 白名单计算需要 deny 的 MCP 工具名列表 */
function computeMcpDenyTools(mcpFilter: string[] | null): string[] {
  if (!Array.isArray(mcpFilter)) return [];
  const allTools = readMcpToolsCache();
  if (allTools.length === 0) return [];
  const allowSet = new Set(mcpFilter);
  return allTools
    .filter(t => !allowSet.has(t.serverId))
    .map(t => t.nativeToolName);
}

/**
 * 计算 tools RPC 参数（profile + alsoAllow + deny）
 */
export function computeToolsUpdate(
  agentName: string,
  toolsFilter: string[] | null | undefined,
  mcpFilter: string[] | null | undefined,
  skillsFilter: string[] | undefined,
  currentDeny: string[],
): { profile: string; alsoAllow: string[]; deny?: string[] } {
  const isDefault = agentName === 'default';
  const newProfile = 'coding';
  const newAlsoAllow = isDefault
    ? ['group:plugins', 'agents_list']
    : ['group:plugins'];

  // 1. toolsFilter deny（read/write/exec 组）
  const toolsDeny = computeToolsDeny(toolsFilter ?? null);

  // 2. 专业 agent 限制
  const specialistDeny = isDefault ? [] : ['sessions_spawn', 'subagents', 'agents_list', 'sessions_list', 'sessions_history', 'sessions_send'];

  // 3. MCP deny
  let mcpDeny: string[] = [];
  if (mcpFilter !== undefined) {
    mcpDeny = computeMcpDenyTools(mcpFilter);
  } else {
    mcpDeny = currentDeny.filter((t: string) => t.startsWith('mcp_'));
  }

  // 4. run_skill deny（由 skillsFilter 管理）
  const hasSkills = Array.isArray(skillsFilter) && skillsFilter.length > 0;
  const runSkillDeny = (hasSkills || skillsFilter === undefined)
    ? []  // 有技能或未指定 → 不 deny
    : ['run_skill'];  // 技能全部禁用 → deny

  const newDeny = [...new Set([...toolsDeny, ...specialistDeny, ...mcpDeny, ...runSkillDeny])];

  return {
    profile: newProfile,
    alsoAllow: newAlsoAllow,
    ...(newDeny.length > 0 ? { deny: newDeny } : {}),
  };
}

/**
 * 统一 agent 原生配置同步。
 *
 * 通过引擎 RPC 直接同步：
 * - agents.update: model / tools / skills / subagents
 * - agents.delete: 删除 agent
 * 仅 memory scope 仍需 configTransaction（plugin 配置无专用 RPC）。
 */
export async function syncAgentToEngine(
  bridge: EngineAdapter,
  userId: string,
  opts: {
    agentName?: string;
    model?: string | null;
    toolsFilter?: string[] | null;
    enabledAgentNames?: string[];
    deleteAgentName?: string;
    skillsFilter?: string[];
    mcpFilter?: string[] | null;
  },
): Promise<void> {
  if (!bridge.isConnected) return;

  const tenant = TenantEngineAdapter.forUser(bridge, userId);

  // ── 1. 删除 agent ──
  if (opts.deleteAgentName) {
    const deleteId = tenant.agentId(opts.deleteAgentName);
    try {
      await bridge.call('agents.delete', { agentId: deleteId, deleteFiles: true });
      logger.info(`deleted agent via RPC: ${deleteId}`);
    } catch (e: unknown) {
      const msg = (e as Error).message || '';
      // agent 不存在不算错误
      if (!msg.includes('not found')) {
        logger.error(`agents.delete failed for ${deleteId}: ${msg}`);
      }
    }
  }

  // ── 2. 更新 agent 配置（model / tools / skills）──
  if (opts.agentName && (opts.model !== undefined || opts.toolsFilter !== undefined || opts.mcpFilter !== undefined || opts.skillsFilter !== undefined)) {
    const targetId = tenant.agentId(opts.agentName);

    // 构建 agents.update 参数
    const updateParams: Record<string, unknown> = { agentId: targetId };

    // model
    if (opts.model !== undefined) {
      if (opts.model) {
        updateParams.model = opts.model;
      }
      // model 为 null/空字符串时，agents.update 不支持清除 model，
      // 传空字符串不会通过 NonEmptyString 校验，此处跳过（保持引擎默认）
      logger.info(`model: ${targetId} → ${opts.model || '(global default)'}`);
    }

    // tools（profile + alsoAllow + deny）
    if (opts.toolsFilter !== undefined || opts.mcpFilter !== undefined) {
      let currentDeny: string[] = [];
      if (opts.agentName) {
        try {
          const { getPrismaClient } = await import('@octopus/database');
          const prisma = getPrismaClient();
          const dbAgent = await prisma.agent.findFirst({
            where: { ownerId: userId, name: opts.agentName },
            select: { toolsDeny: true },
          });
          if (dbAgent?.toolsDeny && Array.isArray(dbAgent.toolsDeny)) {
            currentDeny = dbAgent.toolsDeny as string[];
          }
        } catch { /* DB 查询失败时使用空 deny，不阻塞同步 */ }
      }
      updateParams.tools = computeToolsUpdate(
        opts.agentName, opts.toolsFilter, opts.mcpFilter, opts.skillsFilter, currentDeny,
      );
      logger.info(`tools: ${targetId} → ${JSON.stringify(updateParams.tools)}`);
    }

    // skills
    if (opts.skillsFilter !== undefined) {
      updateParams.skills = opts.skillsFilter;
      logger.info(`skills: ${targetId} → [${opts.skillsFilter.join(', ')}]`);
    }

    try {
      await bridge.call('agents.update', updateParams);
    } catch (e: unknown) {
      logger.error(`agents.update failed for ${targetId}: ${(e as Error).message}`);
    }
  }

  // ── 3. 更新 allowAgents（每个 agent 独立 RPC 调用）──
  if (opts.enabledAgentNames) {
    const defaultId = tenant.agentId('default');
    const specialistIds = opts.enabledAgentNames
      .filter(n => n !== 'default')
      .map(n => tenant.agentId(n));

    // default agent: allowAgents = 专业 agent ID 列表
    try {
      await bridge.call('agents.update', {
        agentId: defaultId,
        subagents: { allowAgents: specialistIds.length > 0 ? specialistIds : [] },
      });
    } catch (e: unknown) {
      // default agent 可能不存在（首次启动）
      logger.warn(`agents.update subagents failed for ${defaultId}: ${(e as Error).message}`);
    }

    // 专业 agent: 不可 spawn 子 agent
    for (const sid of specialistIds) {
      try {
        await bridge.call('agents.update', {
          agentId: sid,
          subagents: { allowAgents: [] },
        });
      } catch {
        // 专业 agent 可能尚未创建，忽略
      }
    }

    logger.info(`allowAgents updated for user ${userId}, specialists: [${specialistIds.join(', ')}]`);
  }

  // ── 4. memory scope 同步（仍需 configTransaction — plugin 配置无专用 RPC）──
  if (opts.enabledAgentNames || opts.deleteAgentName) {
    await bridge.configTransaction((config) => {
      const engineCfg = config as EngineConfig;
      const memoryPlugin = engineCfg.plugins?.entries?.['memory-lancedb-pro'];
      if (!memoryPlugin?.config?.scopes) return null;

      const scopes = memoryPlugin.config.scopes;
      let changed = false;

      if (opts.enabledAgentNames) {
        const defaultId = tenant.agentId('default');
        const specialistIds = opts.enabledAgentNames
          .filter((n) => n !== 'default')
          .map((n) => tenant.agentId(n));
        const allUserAgentIds = [defaultId, ...specialistIds];
        scopes.agentAccess = scopes.agentAccess || {};

        // default agent 可访问所有该用户 agent 的记忆 + global
        const oldDefault = JSON.stringify(scopes.agentAccess[defaultId]);
        scopes.agentAccess[defaultId] = [...allUserAgentIds, 'global'];
        if (JSON.stringify(scopes.agentAccess[defaultId]) !== oldDefault) changed = true;

        // 每个专业 agent 只能访问自己、default 和 global 的记忆
        for (const sid of specialistIds) {
          const oldSpec = JSON.stringify(scopes.agentAccess[sid]);
          scopes.agentAccess[sid] = [sid, defaultId, 'global'];
          if (JSON.stringify(scopes.agentAccess[sid]) !== oldSpec) changed = true;
        }
      }

      // 删除 agent 时清理 agentAccess（删除自身条目 + 从其他 agent 的 scopes 中移除引用）
      if (opts.deleteAgentName) {
        const deleteId = tenant.agentId(opts.deleteAgentName);
        if (scopes.agentAccess?.[deleteId]) {
          delete scopes.agentAccess[deleteId];
          changed = true;
        }
        // 从其他 agent 的 scopes 列表中移除已删除 agent 的引用
        for (const [agentId, scopeList] of Object.entries(scopes.agentAccess ?? {})) {
          if (Array.isArray(scopeList) && scopeList.includes(deleteId)) {
            scopes.agentAccess![agentId] = scopeList.filter((s: string) => s !== deleteId);
            changed = true;
          }
        }
      }

      if (!changed) return null;

      return {
        plugins: {
          entries: {
            'memory-lancedb-pro': {
              config: {
                scopes: {
                  agentAccess: scopes.agentAccess || {},
                },
              },
            },
          },
        },
      };
    });
  }
}

// ─── ensureAndSyncNativeAgent ───────────────────────────────────────────────

/** agents.files.set 带重试：原生 gateway 创建 agent 后异步初始化 workspace，立即调用会 "unknown agent id" */
async function setFileWithRetry(
  bridge: EngineAdapter,
  nativeAgentId: string,
  fileName: string,
  content: string,
  logPrefix: string,
): Promise<void> {
  try {
    await bridge.call('agents.files.set', { agentId: nativeAgentId, name: fileName, content });
  } catch (e: unknown) {
    if (logPrefix === '[agents]') {
      logger.warn(`${logPrefix} agentFilesSet ${fileName} failed for ${nativeAgentId}, retrying in 1.5s:`, { message: (e as Error).message });
    }
    await new Promise(r => setTimeout(r, 1500));
    await bridge.call('agents.files.set', { agentId: nativeAgentId, name: fileName, content });
  }
}

/**
 * 统一的 agent 原生引擎同步实现
 *
 * 合并 chat.ts ensureNativeAgent 与 agents.ts syncToNative 的共享逻辑。
 * - chat.ts 调用：useCache=true, 不写 IDENTITY, 轻量级
 * - agents.ts 调用：useCache=false, 写完整文件, 初始化工作空间
 */
export async function ensureAndSyncNativeAgent(
  bridge: EngineAdapter,
  workspaceManager: WorkspaceManager,
  userId: string,
  agentName: string,
  options?: {
    useCache?: boolean;
    initWorkspace?: boolean;
    identity?: { name?: string; emoji?: string; vibe?: string } | null;
    systemPrompt?: string | null;
    description?: string | null;
    isUpdate?: boolean;
    dataRoot?: string;
  },
): Promise<void> {
  const {
    useCache = true,
    initWorkspace = false,
    identity = null,
    systemPrompt = null,
    description = null,
    isUpdate = false,
    dataRoot = '',
  } = options || {};

  const logPrefix = useCache ? '[chat]' : '[agents]';
  const nativeAgentId = TenantEngineAdapter.forUser(bridge, userId).agentId(agentName);

  // ── 1. 获取 workspace 路径 ──
  let workspacePath: string;
  if (initWorkspace) {
    workspacePath = await workspaceManager.initAgentWorkspace(userId, agentName);
  } else {
    workspacePath = workspaceManager.getAgentWorkspacePath(userId, agentName);
  }

  // ── 2. 创建 agent ──
  let agentReady = false;
  let isNewAgent = false;

  if (useCache) {
    // chat.ts 模式：单次尝试，catch "already exists" = 已就绪
    try {
      await bridge.call('agents.create', { name: nativeAgentId, workspace: workspacePath });
      isNewAgent = true;
      agentReady = true;
    } catch (createErr: unknown) {
      const msg = (createErr as Error).message || '';
      if (msg.includes('already exists')) {
        agentReady = true;
      } else {
        logger.error(`${logPrefix} agents.create failed for ${nativeAgentId}: ${msg}`);
      }
    }
  } else {
    // agents.ts 模式：3 次重试，已存在时更新 workspace
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await bridge.call('agents.create', { name: nativeAgentId, workspace: workspacePath });
        isNewAgent = true;
        agentReady = true;
        break;
      } catch (createErr: unknown) {
        const msg = (createErr as Error).message || '';
        if (msg.includes('already exists')) {
          try {
            await bridge.call('agents.update', { agentId: nativeAgentId, workspace: workspacePath });
          } catch { /* ignore */ }
          agentReady = true;
          break;
        }
        logger.warn(`${logPrefix} agents.create attempt ${attempt + 1} failed for ${nativeAgentId}: ${msg}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!agentReady) {
      logger.error(`${logPrefix} syncToNative: agent ${nativeAgentId} creation failed after 3 attempts, skipping file sync`);
      return;
    }
  }

  // ── 3. 写文件 ──
  if (!agentReady) return;

  if (useCache && isNewAgent) {
    const soulTemplate = getSoulTemplate(dataRoot, agentName);
    await setFileWithRetry(bridge, nativeAgentId, 'SOUL.md', soulTemplate, logPrefix).catch((e: unknown) => {
      logger.error(`${logPrefix} agentFilesSet SOUL.md failed for ${nativeAgentId}:`, { message: (e as Error).message });
    });
    // 同步写入磁盘（覆盖引擎默认英文模板）
    try { fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), soulTemplate, 'utf-8'); } catch { /* ignore */ }
  } else if (!useCache) {
    // IDENTITY.md
    const identityParts = [
      identity?.name ? `name: ${identity.name}` : '',
      identity?.emoji ? `emoji: ${identity.emoji}` : '',
    ].filter(Boolean);
    if (description) {
      identityParts.push(`creature: ${description}`);
    }
    if (identity?.vibe) {
      identityParts.push(`vibe: ${identity.vibe}`);
    }
    if (identityParts.length > 0) {
      const identityContent = identityParts.join('\n');
      await setFileWithRetry(bridge, nativeAgentId, 'IDENTITY.md', identityContent, logPrefix).catch((e: unknown) => {
        logger.error(`${logPrefix} agentFilesSet IDENTITY.md ultimately failed for ${nativeAgentId}:`, { message: (e as Error).message });
      });
      // 同步写入磁盘
      try { fs.writeFileSync(path.join(workspacePath, 'IDENTITY.md'), identityContent, 'utf-8'); } catch { /* ignore */ }
    }

    // SOUL.md — 优先使用 DB 中的 systemPrompt，否则从 data/templates/ 加载模板
    const soulContent = systemPrompt || getSoulTemplate(dataRoot, agentName);
    if (!isUpdate || systemPrompt) {
      await setFileWithRetry(bridge, nativeAgentId, 'SOUL.md', soulContent, logPrefix).catch((e: unknown) => {
        logger.error(`${logPrefix} agentFilesSet SOUL.md failed for ${nativeAgentId}:`, { message: (e as Error).message });
      });
      // 同步写入磁盘
      try { fs.writeFileSync(path.join(workspacePath, 'SOUL.md'), soulContent, 'utf-8'); } catch { /* ignore */ }
    }
  }
}
