/**
 * AgentConfigSync — 统一 agent 原生配置同步
 *
 * 合并 syncAllowAgents + syncAgentNativeConfig + 删除清理，
 * 只做 1 次 config read + 1 次 config write，减少竞态和 rate limit 风险。
 *
 * ensureAndSyncNativeAgent — 统一 agent 原生引擎同步（创建 + 文件写入）
 * 合并 chat.ts ensureNativeAgent 与 agents.ts syncToNative 的共享逻辑。
 */

import * as fs from 'fs';
import * as path from 'path';
import type { EngineAdapter } from './EngineAdapter';
import type { WorkspaceManager } from '@octopus/workspace';
import { getSoulTemplate, getMemoryTemplate } from './SoulTemplate';

/**
 * 根据 toolsFilter（read/write/exec 三组）计算需要 deny 的文件/命令工具
 * - toolsFilter 不含 read → deny read, edit, apply_patch
 * - toolsFilter 不含 write → deny write
 * - toolsFilter 不含 exec → deny exec, process
 * - toolsFilter 为空/null → deny 全部
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
  const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const candidates = [
    path.join(projectRoot, '.octopus-state/tools-cache.json'),
    path.join(projectRoot, 'plugins/mcp/tools-cache.json'),
  ];
  const cachePath = candidates.find(p => fs.existsSync(p));
  if (!cachePath) return [];
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return [];
  }
}

/** 根据 mcpFilter 白名单计算需要 deny 的 MCP 工具名列表 */
function computeMcpDenyTools(mcpFilter: string[] | null): string[] {
  if (!Array.isArray(mcpFilter)) return [];
  const allTools = readMcpToolsCache();
  if (allTools.length === 0) return [];
  const allowSet = new Set(mcpFilter);
  // mcpFilter 为空数组 = 全部禁用
  return allTools
    .filter(t => !allowSet.has(t.serverId))
    .map(t => t.nativeToolName);
}

/**
 * 统一 agent 原生配置同步。
 *
 * 合并以下三个操作到 1 次 config read + 1 次 config write：
 * - syncAllowAgents: 更新 default agent 的 subagents.allowAgents
 * - syncAgentNativeConfig: 更新指定 agent 的 model + tools.allow
 * - 删除 agent entry: 从 agents.list 中移除
 *
 * @param bridge - EngineAdapter 实例
 * @param userId - 用户 ID
 * @param opts - 同步选项
 *   - agentName: 要更新 model/tools 的 agent 名称
 *   - model: 模型配置（"provider/modelId" 格式），null 表示清除
 *   - toolsFilter: 工具白名单（引擎原生名: read/write/exec），null 表示不改变
 *   - enabledAgentNames: 该用户所有 enabled 的 agent 名称列表（用于 allowAgents 同步）
 *   - deleteAgentName: 要从 agents.list 中删除的 agent 名称
 *   - skillsFilter: 技能白名单（空数组 = 禁用所有技能 → deny run_skill）
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
    /** 技能白名单（空数组 = 禁用技能 → deny run_skill，有值 = 启用 → 移除 deny） */
    skillsFilter?: string[];
    /** MCP 白名单（serverId 数组），变更时同步 tools.deny 隐藏未授权 MCP 工具 */
    mcpFilter?: string[] | null;
    /** 心跳配置同步。传对象 = 创建/更新心跳，null = 删除心跳 */
    heartbeat?: { every: string; prompt: string } | null;
  },
): Promise<void> {
  if (!bridge.isConnected) return;

  const { config } = await bridge.configGetParsed();
  const agentsList: any[] = (config as any)?.agents?.list || [];
  let changed = false;

  // 延迟导入 EngineAdapter 类以获取静态方法（避免循环依赖）
  const { EngineAdapter: EA } = await import('./EngineAdapter');

  // 1. 删除 agent entry
  if (opts.deleteAgentName) {
    const deleteId = EA.userAgentId(userId, opts.deleteAgentName);
    const before = agentsList.length;
    (config as any).agents.list = agentsList.filter((a: any) => a.id !== deleteId);
    if ((config as any).agents.list.length !== before) {
      changed = true;
      console.log(`[AgentConfigSync] deleted agent entry: ${deleteId}`);
    }
  }

  // 当前 agents.list（可能已被步骤 1 修改）
  const currentList: any[] = (config as any)?.agents?.list || [];

  // 2. 更新 model + tools.allow
  if (opts.agentName && (opts.model !== undefined || opts.toolsFilter !== undefined || opts.mcpFilter !== undefined || opts.skillsFilter !== undefined)) {
    const targetId = EA.userAgentId(userId, opts.agentName);
    const entry = currentList.find((a: any) => a.id === targetId);
    if (entry) {
      // model 同步
      if (opts.model !== undefined) {
        const oldModel = entry.model ?? null;
        const newModel = opts.model || null;
        if (JSON.stringify(oldModel) !== JSON.stringify(newModel)) {
          if (newModel) {
            entry.model = newModel;
          } else {
            delete entry.model;
          }
          changed = true;
          console.log(`[AgentConfigSync] model: ${targetId} → ${newModel || '(global default)'}`);
        }
      }

      // toolsFilter + mcpFilter → profile + alsoAllow + deny
      if (opts.toolsFilter !== undefined || opts.mcpFilter !== undefined) {
        const isDefault = opts.agentName === 'default';

        // profile: coding 已包含 read/write/exec/memory/sessions/cron/image
        const newProfile = 'coding';
        // alsoAllow: group:plugins（MCP 工具）+ agents_list（仅 default）
        const newAlsoAllow = isDefault
          ? ['group:plugins', 'agents_list']
          : ['group:plugins'];

        // deny 合并三个来源：toolsFilter 关闭的工具组 + 专业 agent 限制 + MCP deny + skill deny
        const currentDeny: string[] = entry.tools?.deny || [];

        // 1. toolsFilter deny（read/write/exec 组）
        const tf = opts.toolsFilter !== undefined ? opts.toolsFilter : (entry.tools?._toolsFilter as string[] | null);
        const toolsDeny = computeToolsDeny(tf ?? null);

        // 2. 专业 agent 限制
        const specialistDeny = isDefault ? [] : ['sessions_spawn', 'subagents', 'agents_list'];

        // 3. MCP deny（保留已有非 MCP deny 项中的 run_skill 等）
        let mcpDeny: string[] = [];
        if (opts.mcpFilter !== undefined) {
          mcpDeny = computeMcpDenyTools(opts.mcpFilter);
        } else {
          mcpDeny = currentDeny.filter((t: string) => t.startsWith('mcp_'));
        }

        // 4. 保留 run_skill deny（由 skillsFilter 逻辑管理）
        const runSkillDeny = currentDeny.includes('run_skill') ? ['run_skill'] : [];

        const newDeny = [...new Set([...toolsDeny, ...specialistDeny, ...mcpDeny, ...runSkillDeny])];

        // 比较并更新
        const oldTools = JSON.stringify({
          profile: entry.tools?.profile,
          alsoAllow: entry.tools?.alsoAllow,
          allow: entry.tools?.allow,
          deny: entry.tools?.deny,
        });
        const newTools: Record<string, unknown> = {
          profile: newProfile,
          alsoAllow: newAlsoAllow,
          deny: newDeny.length > 0 ? newDeny : undefined,
          // 保存 toolsFilter 原值用于后续增量同步（引擎忽略未知字段）
          _toolsFilter: tf,
        };
        // 清理 allow 字段（迁移到 profile 后不再需要）
        const newToolsStr = JSON.stringify({
          profile: newTools.profile,
          alsoAllow: newTools.alsoAllow,
          allow: undefined,
          deny: newTools.deny,
        });
        if (oldTools !== newToolsStr) {
          entry.tools = newTools;
          if (!entry.tools.deny) delete entry.tools.deny;
          changed = true;
          console.log(`[AgentConfigSync] tools: ${targetId} → profile=${newProfile}, alsoAllow=[${newAlsoAllow}], deny=[${newDeny.join(', ')}]`);
        }
      }

      // skillsFilter → 双重隔离
      //   1. tools.deny: run_skill（无技能权限时阻止调用）
      //   2. skills = []（始终阻止引擎注入 <available_skills>，由 SystemPromptBuilder 按白名单注入）
      if (opts.skillsFilter !== undefined) {
        const hasSkills = Array.isArray(opts.skillsFilter) && opts.skillsFilter.length > 0;
        const currentDeny: string[] = entry.tools?.deny || [];
        const hasRunSkillDeny = currentDeny.includes('run_skill');

        // 始终阻止引擎自行注入 skill 描述，由企业层 SystemPromptBuilder 按 skillsFilter 白名单控制
        if (!Array.isArray((entry as any).skills) || (entry as any).skills.length !== 0) {
          (entry as any).skills = [];
          changed = true;
        }

        if (!hasSkills && !hasRunSkillDeny) {
          // 技能全部禁用 → deny run_skill
          entry.tools = { ...entry.tools, deny: [...currentDeny, 'run_skill'] };
          changed = true;
          console.log(`[AgentConfigSync] skills disabled: ${targetId} → deny run_skill`);
        } else if (hasSkills && hasRunSkillDeny) {
          // 有技能权限 → 移除 deny（允许调用 run_skill）
          const newDeny = currentDeny.filter(t => t !== 'run_skill');
          entry.tools = { ...entry.tools, deny: newDeny.length > 0 ? newDeny : undefined };
          if (!entry.tools.deny) delete entry.tools.deny;
          changed = true;
          console.log(`[AgentConfigSync] skills enabled: ${targetId} → removed run_skill deny`);
        }
      }
    }
  }

  // 2.5 更新心跳配置
  if (opts.heartbeat !== undefined && opts.agentName) {
    const targetId = EA.userAgentId(userId, opts.agentName);
    const entry = currentList.find((a: any) => a.id === targetId);
    if (entry) {
      if (opts.heartbeat === null) {
        // 删除心跳
        if (entry.heartbeat) {
          delete entry.heartbeat;
          changed = true;
          console.log(`[AgentConfigSync] heartbeat deleted: ${targetId}`);
        }
      } else {
        const oldHb = JSON.stringify(entry.heartbeat);
        entry.heartbeat = opts.heartbeat;
        if (oldHb !== JSON.stringify(entry.heartbeat)) {
          changed = true;
          console.log(`[AgentConfigSync] heartbeat updated: ${targetId} → every=${opts.heartbeat.every}`);
        }
      }
    }
  }

  // 3. 更新 allowAgents（default agent 可 spawn 专业 agent，专业 agent 不可 spawn 子 agent）
  if (opts.enabledAgentNames) {
    const defaultId = EA.userAgentId(userId, 'default');
    const specialistIds = opts.enabledAgentNames
      .filter(n => n !== 'default')
      .map(n => EA.userAgentId(userId, n));

    for (const entry of currentList) {
      if (entry.id === defaultId) {
        // default agent: allowAgents = 专业 agent ID 列表
        const newAllow = specialistIds.length > 0 ? specialistIds : undefined;
        const oldAllow = entry.subagents?.allowAgents;
        if (JSON.stringify(oldAllow) !== JSON.stringify(newAllow)) {
          entry.subagents = { ...entry.subagents, allowAgents: newAllow };
          changed = true;
        }
      } else if (specialistIds.includes(entry.id)) {
        // 专业 agent: 不可 spawn 子 agent（与现有行为一致）
        const oldAllow = entry.subagents?.allowAgents;
        if (JSON.stringify(oldAllow) !== JSON.stringify([])) {
          entry.subagents = { ...entry.subagents, allowAgents: [] };
          changed = true;
        }
      }
    }

    if (changed) {
      console.log(`[AgentConfigSync] allowAgents updated for user ${userId}, specialists: [${specialistIds.join(', ')}]`);
    }
  }

  // 4. 同步 memory-lancedb-pro agentAccess（记忆隔离）
  if (opts.enabledAgentNames) {
    const memoryPlugin = (config as any).plugins?.entries?.['memory-lancedb-pro'];
    if (memoryPlugin?.config?.scopes) {
      const scopes = memoryPlugin.config.scopes;
      const defaultId = EA.userAgentId(userId, 'default');
      const specialistIds = opts.enabledAgentNames
        .filter((n: string) => n !== 'default')
        .map((n: string) => EA.userAgentId(userId, n));

      const allUserAgentIds = [defaultId, ...specialistIds];
      scopes.agentAccess = scopes.agentAccess || {};

      // default agent 可访问所有该用户 agent 的记忆
      const oldDefault = JSON.stringify(scopes.agentAccess[defaultId]);
      scopes.agentAccess[defaultId] = allUserAgentIds;
      if (JSON.stringify(scopes.agentAccess[defaultId]) !== oldDefault) changed = true;

      // 每个专业 agent 只能访问自己和 default 的记忆
      for (const sid of specialistIds) {
        const oldSpec = JSON.stringify(scopes.agentAccess[sid]);
        scopes.agentAccess[sid] = [sid, defaultId];
        if (JSON.stringify(scopes.agentAccess[sid]) !== oldSpec) changed = true;
      }
    }
  }

  // 删除 agent 时清理 agentAccess
  if (opts.deleteAgentName) {
    const deleteId = EA.userAgentId(userId, opts.deleteAgentName);
    const memoryPlugin = (config as any).plugins?.entries?.['memory-lancedb-pro'];
    if (memoryPlugin?.config?.scopes?.agentAccess?.[deleteId]) {
      delete memoryPlugin.config.scopes.agentAccess[deleteId];
      changed = true;
    }
  }

  if (changed) {
    // 增量 patch：只传变更的部分，避免全量覆盖
    const patch: Record<string, unknown> = {};

    // agents.list 是数组，deep merge 会整体替换，所以传完整 list
    patch.agents = { list: (config as any).agents?.list || [] };

    // 如果涉及 memory-lancedb-pro plugin 变更，只传 plugin patch
    if (opts.enabledAgentNames || opts.deleteAgentName) {
      const memoryPlugin = (config as any).plugins?.entries?.['memory-lancedb-pro'];
      if (memoryPlugin) {
        patch.plugins = {
          entries: {
            'memory-lancedb-pro': {
              config: {
                scopes: {
                  agentAccess: memoryPlugin.config?.scopes?.agentAccess || {},
                },
              },
            },
          },
        };
      }
    }

    await bridge.configApply(patch);
    console.log(`[AgentConfigSync] config applied (incremental) for user ${userId}`);
  } else {
    console.log(`[AgentConfigSync] no changes needed for user ${userId}`);
  }
}

// ─── ensureAndSyncNativeAgent ───────────────────────────────────────────────

/** agentFilesSet 带重试：原生 gateway 创建 agent 后异步初始化 workspace，立即调用会 "unknown agent id" */
async function setFileWithRetry(
  bridge: EngineAdapter,
  nativeAgentId: string,
  fileName: string,
  content: string,
  logPrefix: string,
): Promise<void> {
  try {
    await bridge.agentFilesSet(nativeAgentId, fileName, content);
  } catch (e: any) {
    if (logPrefix === '[agents]') {
      console.warn(`${logPrefix} agentFilesSet ${fileName} failed for ${nativeAgentId}, retrying in 1.5s:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1500));
    await bridge.agentFilesSet(nativeAgentId, fileName, content);
  }
}

/**
 * 统一的 agent 原生引擎同步实现
 *
 * 合并 chat.ts ensureNativeAgent 与 agents.ts syncToNative 的共享逻辑。
 * - chat.ts 调用：useCache=true, 不写 IDENTITY, 轻量级
 * - agents.ts 调用：useCache=false, 写完整文件, 初始化工作空间
 *
 * @param bridge - EngineAdapter 实例
 * @param workspaceManager - WorkspaceManager 实例
 * @param userId - 用户 ID
 * @param agentName - agent 名称
 * @param options - 同步选项
 */
export async function ensureAndSyncNativeAgent(
  bridge: EngineAdapter,
  workspaceManager: WorkspaceManager,
  userId: string,
  agentName: string,
  options?: {
    /** 启用缓存（chat.ts 模式），默认 true */
    useCache?: boolean;
    /** 初始化工作空间目录（agents.ts 模式），默认 false */
    initWorkspace?: boolean;
    /** IDENTITY.md 内容：name, emoji, vibe 等 */
    identity?: { name?: string; emoji?: string; vibe?: string } | null;
    /** SOUL.md 自定义内容，null 表示使用模板 */
    systemPrompt?: string | null;
    /** agent 描述（用于 IDENTITY.md creature 字段） */
    description?: string | null;
    /** 是否为更新操作（更新时不覆盖 SOUL.md 模板和 MEMORY.md），默认 false */
    isUpdate?: boolean;
    /** dataRoot 路径（用于 SOUL/MEMORY 模板），默认 '' */
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

  // 延迟导入 EngineAdapter 类以获取静态方法（避免循环依赖）
  const { EngineAdapter: EA } = await import('./EngineAdapter');
  const nativeAgentId = EA.userAgentId(userId, agentName);

  // ── 1. 缓存检查（仅 chat.ts 模式） ──
  // 利用 agentsCreate 幂等性：直接尝试创建，catch "already exists" 即可
  // 无需维护 knownNativeAgents 缓存或轮询 agents.list

  // ── 2. 获取 workspace 路径 ──
  let workspacePath: string;
  if (initWorkspace) {
    // agents.ts 模式：初始化工作空间目录（创建目录结构）
    workspacePath = await workspaceManager.initAgentWorkspace(userId, agentName);
  } else {
    // chat.ts 模式：仅获取路径，不创建目录
    workspacePath = agentName === 'default'
      ? workspaceManager.getSubPath(userId, 'WORKSPACE')
      : workspaceManager.getAgentWorkspacePath(userId, agentName);
  }

  // ── 3. 创建 agent ──
  let agentReady = false;
  let isNewAgent = false;

  if (useCache) {
    // chat.ts 模式：单次尝试，catch "already exists" = 已就绪
    try {
      await bridge.agentsCreate({ name: nativeAgentId, workspace: workspacePath });
      isNewAgent = true;
      agentReady = true;
    } catch (createErr: any) {
      const msg = createErr.message || '';
      if (msg.includes('already exists')) {
        agentReady = true;
      } else {
        console.error(`${logPrefix} agentsCreate failed for ${nativeAgentId}: ${msg}`);
      }
    }
  } else {
    // agents.ts 模式：3 次重试，已存在时更新 workspace
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await bridge.agentsCreate({ name: nativeAgentId, workspace: workspacePath });
        isNewAgent = true;
        agentReady = true;
        break;
      } catch (createErr: any) {
        const msg = createErr.message || '';
        if (msg.includes('already exists')) {
          try {
            await bridge.agentsUpdate({ agentId: nativeAgentId, workspace: workspacePath });
          } catch { /* ignore */ }
          agentReady = true;
          break;
        }
        console.warn(`${logPrefix} agentsCreate attempt ${attempt + 1} failed for ${nativeAgentId}: ${msg}`);
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!agentReady) {
      console.error(`${logPrefix} syncToNative: agent ${nativeAgentId} creation failed after 3 attempts, skipping file sync`);
      return;
    }
  }

  // ── 4. 写文件 ──
  if (!agentReady) return;

  if (useCache && isNewAgent) {
    // chat.ts 模式：新建时无条件写 SOUL.md + MEMORY.md（不写 IDENTITY.md）
    await setFileWithRetry(bridge, nativeAgentId, 'SOUL.md', getSoulTemplate(dataRoot, agentName), logPrefix).catch((e: any) => {
      console.error(`${logPrefix} agentFilesSet SOUL.md failed for ${nativeAgentId}:`, e.message);
    });
    await setFileWithRetry(bridge, nativeAgentId, 'MEMORY.md', getMemoryTemplate(dataRoot, agentName), logPrefix).catch((e: any) => {
      console.error(`${logPrefix} agentFilesSet MEMORY.md failed for ${nativeAgentId}:`, e.message);
    });
  } else if (!useCache) {
    // agents.ts 模式：条件写 IDENTITY.md + SOUL.md + MEMORY.md

    // IDENTITY.md：name, emoji, creature（来自 description）, vibe
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
      await setFileWithRetry(bridge, nativeAgentId, 'IDENTITY.md', identityParts.join('\n'), logPrefix).catch((e: any) => {
        console.error(`${logPrefix} agentFilesSet IDENTITY.md ultimately failed for ${nativeAgentId}:`, e.message);
      });
    }

    // SOUL.md：有明确的 systemPrompt 时写入；否则仅在文件不存在时用模板填充
    if (systemPrompt) {
      await setFileWithRetry(bridge, nativeAgentId, 'SOUL.md', systemPrompt, logPrefix).catch((e: any) => {
        console.error(`${logPrefix} agentFilesSet SOUL.md ultimately failed for ${nativeAgentId}:`, e.message);
      });
    } else if (!isUpdate) {
      try {
        const existing = await bridge.agentFilesGet(nativeAgentId, 'SOUL.md') as any;
        if (!existing?.content) {
          await setFileWithRetry(bridge, nativeAgentId, 'SOUL.md', getSoulTemplate(dataRoot, agentName), logPrefix).catch((e: any) => {
            console.error(`${logPrefix} agentFilesSet SOUL.md ultimately failed for ${nativeAgentId}:`, e.message);
          });
        }
      } catch {
        // 文件不存在，用模板填充
        await setFileWithRetry(bridge, nativeAgentId, 'SOUL.md', getSoulTemplate(dataRoot, agentName), logPrefix).catch((e: any) => {
          console.error(`${logPrefix} agentFilesSet SOUL.md ultimately failed for ${nativeAgentId}:`, e.message);
        });
      }
    }

    // MEMORY.md：仅在文件不存在时写入（保护已有记忆）
    if (!isUpdate) {
      try {
        const existing = await bridge.agentFilesGet(nativeAgentId, 'MEMORY.md') as any;
        if (!existing?.content) {
          const memDisplayName = identity?.name || agentName;
          await setFileWithRetry(bridge, nativeAgentId, 'MEMORY.md', getMemoryTemplate(dataRoot, memDisplayName), logPrefix).catch((e: any) => {
            console.error(`${logPrefix} agentFilesSet MEMORY.md ultimately failed for ${nativeAgentId}:`, e.message);
          });
        }
      } catch {
        const memDisplayName = identity?.name || agentName;
        await setFileWithRetry(bridge, nativeAgentId, 'MEMORY.md', getMemoryTemplate(dataRoot, memDisplayName), logPrefix).catch((e: any) => {
          console.error(`${logPrefix} agentFilesSet MEMORY.md ultimately failed for ${nativeAgentId}:`, e.message);
        });
      }
    }
  }
  // memory-lancedb-pro 默认行为已提供 scope 隔离，无需显式注册
}
