/**
 * AgentConfigSync — 统一 agent 原生配置同步
 *
 * 合并 syncAllowAgents + syncAgentNativeConfig + 删除清理，
 * 只做 1 次 config read + 1 次 config write，减少竞态和 rate limit 风险。
 */

import type { EngineAdapter } from './EngineAdapter';

// 引擎 tools.allow 映射：企业语义名 → 引擎原生名
const TOOL_NAME_TO_ENGINE: Record<string, string> = {
  list_files: 'read',       // 引擎用 read 工具读目录
  read_file: 'read',
  write_file: 'write',
  execute_command: 'exec',
  search_files: 'exec',     // 搜索通过 exec 的 grep/find 实现
};

/** 基础工具（所有 agent 都需要的非文件类工具） */
const BASE_TOOLS = [
  'memory_search', 'memory_get',
  'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn',
  'agents_list', 'cron', 'image',
];

/** 将企业 toolsFilter 名称转换为引擎原生工具名（去重） */
function mapToolsToEngine(tools: string[]): string[] {
  const mapped = new Set<string>();
  for (const t of tools) {
    mapped.add(TOOL_NAME_TO_ENGINE[t] || t);
  }
  return [...mapped];
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
 *   - toolsFilter: 工具白名单（企业语义名），null 表示不改变
 *   - enabledAgentNames: 该用户所有 enabled 的 agent 名称列表（用于 allowAgents 同步）
 *   - deleteAgentName: 要从 agents.list 中删除的 agent 名称
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
  if (opts.agentName && (opts.model !== undefined || opts.toolsFilter !== undefined)) {
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

      // toolsFilter → 引擎 tools.allow 硬限制
      if (opts.toolsFilter !== undefined) {
        const tf = opts.toolsFilter;
        // P1-14: 只有 default agent 获得 group:plugins（可访问所有插件工具）
        // 专业 agent 只能使用通过 engineNames 显式授权的工具，遵循最小权限原则
        const isDefault = opts.agentName === 'default';
        let newAllow: string[];
        if (Array.isArray(tf) && tf.length > 0) {
          // 白名单模式：映射为引擎原生工具名 + 基础工具
          const engineTools = mapToolsToEngine(tf);
          newAllow = [...engineTools, ...BASE_TOOLS, ...(isDefault ? ['group:plugins'] : [])];
        } else {
          // 空数组 / null = 全部禁用工作空间工具，但保留基础工具
          newAllow = [...BASE_TOOLS, ...(isDefault ? ['group:plugins'] : [])];
        }
        const oldAllow = JSON.stringify(entry.tools?.allow);
        if (oldAllow !== JSON.stringify(newAllow)) {
          entry.tools = { ...entry.tools, allow: newAllow };
          changed = true;
          console.log(`[AgentConfigSync] tools.allow: ${targetId} → [${newAllow.join(', ')}]`);
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
    await bridge.configApplyFull(config as Record<string, unknown>);
    console.log(`[AgentConfigSync] config applied for user ${userId}`);
  } else {
    console.log(`[AgentConfigSync] no changes needed for user ${userId}`);
  }
}
