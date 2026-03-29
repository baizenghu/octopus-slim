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

/**
 * 基于统一 ToolSource 白名单计算 tools RPC 参数（profile + alsoAllow + deny）
 *
 * @param allowedSources  允许的 ToolSource 名称列表（null = 全部放行，[] = 全部禁止）
 * @param toolsFilter     原生工具过滤（read/write/exec），保持现有逻辑
 * @param agentName       agent 名，非 default 的专业 agent 会 deny subagents 等
 */
export function computeToolsFromAllowedSources(
  allowedSources: string[] | null,
  toolsFilter: string[] | null | undefined,
  agentName: string,
): { profile: string; alsoAllow: string[]; deny?: string[] } {
  const isDefault = agentName === 'default';
  const newProfile = 'coding';
  const newAlsoAllow = isDefault
    ? ['group:plugins', 'agents_list']
    : ['group:plugins'];

  // 1. 原生工具 deny（read/write/exec 组）
  const toolsDeny = computeToolsDeny(toolsFilter ?? null);

  // 2. 专业 agent 限制（非 default agent deny subagents 相关工具）
  const specialistDeny = isDefault ? [] : ['sessions_spawn', 'subagents', 'agents_list', 'sessions_list', 'sessions_history', 'sessions_send'];

  // 3 & 4. MCP deny + run_skill deny：基于 allowedSources 白名单
  let mcpDeny: string[] = [];
  let runSkillDeny: string[] = [];
  if (allowedSources !== null) {
    const allMcpTools = readMcpToolsCache();
    const allMcpServerIds = new Set(allMcpTools.map(t => t.serverId));

    // MCP deny：deny 所有不在 allowedSources 中的 MCP 工具
    if (allMcpTools.length > 0) {
      const allowedMcpServers = new Set(
        allowedSources.filter(s => allMcpServerIds.has(s)),
      );
      mcpDeny = allMcpTools
        .filter(t => !allowedMcpServers.has(t.serverId))
        .map(t => t.nativeToolName);
    }

    // run_skill deny：allowedSources 中没有 skill 类型来源（非 MCP serverId）→ deny
    const hasSkillSource = allowedSources.some(s => !allMcpServerIds.has(s));
    if (!hasSkillSource) {
      runSkillDeny = ['run_skill'];
    }
  }

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
    /** @deprecated 已由 allowedToolSources 取代，保留兼容旧调用方 */
    skillsFilter?: string[];
    /** @deprecated 已由 allowedToolSources 取代，保留兼容旧调用方 */
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
    // 从 DB 读取已预计算的 tools 配置（由 computeToolsFromAllowedSources 在 agent 创建/更新时写入）
    if (opts.toolsFilter !== undefined || opts.mcpFilter !== undefined || opts.skillsFilter !== undefined) {
      try {
        const { getPrismaClient } = await import('@octopus/database');
        const prisma = getPrismaClient();
        const dbAgent = await prisma.agent.findFirst({
          where: { ownerId: userId, name: opts.agentName },
          select: { toolsProfile: true, toolsDeny: true, toolsAllow: true, allowedToolSources: true, toolsFilter: true },
        });
        if (dbAgent) {
          const toolsConfig: Record<string, unknown> = {
            profile: dbAgent.toolsProfile || 'coding',
            alsoAllow: Array.isArray(dbAgent.toolsAllow) ? dbAgent.toolsAllow : [],
          };
          const deny = Array.isArray(dbAgent.toolsDeny) ? dbAgent.toolsDeny as string[] : [];
          if (deny.length > 0) toolsConfig.deny = deny;
          updateParams.tools = toolsConfig;
          logger.info(`tools: ${targetId} → ${JSON.stringify(updateParams.tools)}`);

          // skills（run_skill allowedSources 驱动，直接从 DB 读取 allowedToolSources 中的 skill 名称）
          const allowedSources = Array.isArray(dbAgent.allowedToolSources) ? dbAgent.allowedToolSources as string[] : null;
          if (allowedSources !== null) {
            const { readToolsCacheAsync } = await import('../utils/tools-cache');
            const allMcpTools = await readToolsCacheAsync();
            const mcpServerIds = new Set(allMcpTools.map((t: { serverId: string }) => t.serverId));
            const skillSources = allowedSources.filter(s => !mcpServerIds.has(s));
            updateParams.skills = skillSources;
            logger.info(`skills: ${targetId} → [${skillSources.join(', ')}]`);
          }
        }
      } catch { /* DB 查询失败时跳过 tools 同步，不阻塞 model/subagents 更新 */ }
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

        // 每个 agent 只能访问自己的记忆（agent:{id} 格式）
        const oldDefault = JSON.stringify(scopes.agentAccess[defaultId]);
        scopes.agentAccess[defaultId] = [`agent:${defaultId}`];
        if (JSON.stringify(scopes.agentAccess[defaultId]) !== oldDefault) changed = true;

        for (const sid of specialistIds) {
          const oldSpec = JSON.stringify(scopes.agentAccess[sid]);
          scopes.agentAccess[sid] = [`agent:${sid}`];
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
