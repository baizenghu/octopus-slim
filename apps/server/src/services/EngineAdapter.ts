/**
 * EngineAdapter — 引擎适配层（替代 OctopusBridge 的 WebSocket RPC）
 *
 * 单进程架构下，通过进程内函数调用替代 WebSocket RPC。
 * 保持与 OctopusBridge 完全相同的 public 方法签名，
 * 路由文件只需替换类名即可完成迁移。
 *
 * TODO: initialize() 中实现引擎初始化，call() 中对接 handleGatewayRequest
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { ConfigBatcher } from '../utils/config-batcher';

// ---- Agent RPC 参数（与 OctopusBridge 一致）----

export interface AgentCallParams {
  message: string;
  agentId: string;
  sessionKey: string;
  idempotencyKey?: string;
  extraSystemPrompt?: string;
  thinking?: string;
  timeout?: number;
  label?: string;
  deliver?: boolean;
  attachments?: Array<{ type?: string; mimeType?: string; fileName?: string; content?: unknown }>;
}

export interface AgentStreamEvent {
  type: 'text_delta' | 'tool_call' | 'lifecycle' | 'thinking' | 'error' | 'done';
  content?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
  phase?: string;
  error?: string;
  runId?: string;
}

// ---- 主类 ----

export class EngineAdapter extends EventEmitter {
  private initialized = false;
  private configBatcher: ConfigBatcher;

  /** 由 callAgent 发起的 runId 集合，用于区分心跳等非 callAgent 触发的事件 */
  readonly trackedRunIds = new Set<string>();

  constructor() {
    super();
    this.configBatcher = new ConfigBatcher(
      (patch) => this.configApply(patch),
      2000,
    );
  }

  // ---- 生命周期 ----

  async initialize(): Promise<void> {
    // TODO: 引擎初始化 — 加载配置、启动 agent manager、cron scheduler、plugin system
    // 待 @octopus/engine 编译通过后实现
    this.initialized = true;
    console.log('[engine] EngineAdapter initialized (single-process mode)');
  }

  async shutdown(): Promise<void> {
    this.configBatcher.destroy();
    this.initialized = false;
    console.log('[engine] EngineAdapter shut down');
  }

  get isConnected(): boolean {
    return this.initialized;
  }

  // ---- 通用 RPC 调用 ----

  /**
   * 进程内 RPC 调用。
   * TODO: 对接 handleGatewayRequest — 将 method+params 路由到对应的引擎 handler
   */
  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.initialized) {
      throw new Error('[engine] EngineAdapter not initialized');
    }
    // TODO: 实现进程内 handler 调用
    // const handler = coreGatewayHandlers[method];
    // return handler({ params, respond, context, ... });
    throw new Error(`[engine] call('${method}') not yet implemented — pending engine integration`);
  }

  // ---- Agent 调用 ----

  async callAgent(
    params: AgentCallParams,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<{ runId: string }> {
    const idempotencyKey = params.idempotencyKey || randomUUID();

    // TODO: 对接引擎的 agent handler
    // 当前占位实现，后续需要：
    // 1. 调用引擎的 agent 执行入口
    // 2. 将引擎产生的事件流通过 onEvent 回调输出
    // 3. 在 done/error 时清理 trackedRunIds

    this.trackedRunIds.add(idempotencyKey);

    try {
      const result = await this.call<{ status: string; runId: string }>('agent', {
        ...params,
        idempotencyKey,
        deliver: params.deliver ?? false,
      });

      const serverRunId = result.runId || idempotencyKey;
      this.trackedRunIds.add(serverRunId);
      return { runId: serverRunId };
    } catch (err) {
      this.trackedRunIds.delete(idempotencyKey);
      throw err;
    }
  }

  // ---- Sessions ----

  async sessionsList(agentId?: string) {
    return this.call('sessions.list', { agentId });
  }

  async sessionsDelete(key: string) {
    return this.call('sessions.delete', { key, deleteTranscript: true });
  }

  async sessionsReset(key: string) {
    return this.call('sessions.reset', { key, reason: 'reset' });
  }

  async sessionsPatch(key: string, patch: Record<string, unknown>) {
    return this.call('sessions.patch', { key, ...patch });
  }

  async chatHistory(sessionKey: string) {
    return this.call('chat.history', { sessionKey });
  }

  async chatAbort(sessionKey: string) {
    return this.call('chat.abort', { sessionKey });
  }

  // ---- Agents CRUD ----

  async agentsList() {
    return this.call('agents.list', {});
  }

  async agentsCreate(params: { name: string; workspace: string; emoji?: string }) {
    return this.call('agents.create', params);
  }

  async agentsUpdate(params: { agentId: string; name?: string; model?: string; workspace?: string }) {
    return this.call('agents.update', params);
  }

  async agentsDelete(agentId: string) {
    return this.call('agents.delete', { agentId, deleteFiles: true });
  }

  // ---- Agent Files ----

  async agentFilesSet(agentId: string, fileName: string, content: string) {
    return this.call('agents.files.set', { agentId, name: fileName, content });
  }

  async agentFilesGet(agentId: string, fileName: string) {
    return this.call('agents.files.get', { agentId, name: fileName });
  }

  // ---- Cron ----

  async cronList(includeDisabled = false) {
    return this.call('cron.list', { includeDisabled });
  }

  async cronAdd(job: {
    name: string;
    schedule: { kind: 'at'; at: string } | { kind: 'every'; everyMs: number } | { kind: 'cron'; expr: string; tz?: string };
    sessionTarget: 'main' | 'isolated';
    payload: { kind: 'systemEvent'; text: string } | { kind: 'agentTurn'; message: string };
    agentId?: string;
    deleteAfterRun?: boolean;
    delivery?: { mode: string; channel?: string; to?: string };
  }) {
    return this.call('cron.add', { job });
  }

  async cronRemove(id: string) {
    return this.call('cron.remove', { id });
  }

  async cronRun(id: string, mode: 'due' | 'force' = 'force') {
    return this.call('cron.run', { id, mode });
  }

  // ---- Config ----

  async configGet() {
    return this.call('config.get', {});
  }

  async configApplyFull(fullConfig: Record<string, unknown>): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { config: latest, hash: baseHash } = await this.configGetParsed();
      if (!baseHash) throw new Error('config.get did not return hash');
      const merged = { ...fullConfig };
      if ((latest as any).messages) merged.messages = (latest as any).messages;
      if ((latest as any).meta) merged.meta = (latest as any).meta;
      try {
        await this.call('config.set', { raw: JSON.stringify(merged), baseHash });
        return;
      } catch (e: any) {
        if (attempt < 4 && (e.message?.includes('config changed since last load') || e.message?.includes('rate limit'))) {
          const delay = e.message?.includes('rate limit')
            ? (parseInt(e.message.match(/retry after (\d+)s/)?.[1] || '10', 10) * 1000 + 1000)
            : (500 * (attempt + 1));
          console.warn(`[engine] configApplyFull attempt ${attempt + 1} failed: ${e.message}, retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  }

  async configApply(patch: Record<string, unknown>): Promise<void> {
    const { deepMerge } = await import('../utils/deep-merge');
    for (let attempt = 0; attempt < 5; attempt++) {
      const { config, hash: baseHash } = await this.configGetParsed();
      if (!baseHash) throw new Error('config.get did not return hash');
      const merged = deepMerge(config, patch);
      try {
        await this.call('config.set', { raw: JSON.stringify(merged), baseHash });
        return;
      } catch (e: any) {
        if (attempt < 4 && (e.message?.includes('config changed since last load') || e.message?.includes('rate limit'))) {
          const delay = e.message?.includes('rate limit')
            ? (parseInt(e.message.match(/retry after (\d+)s/)?.[1] || '10', 10) * 1000 + 1000)
            : (500 * (attempt + 1));
          console.warn(`[engine] configApply attempt ${attempt + 1} failed: ${e.message}, retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  }

  async configGetParsed(): Promise<{ config: Record<string, unknown>; hash: string }> {
    const result = await this.call<{ raw?: string; hash?: string }>('config.get', {});
    const hash = result?.hash || '';
    let config: Record<string, unknown> = {};
    if (result?.raw) {
      try {
        config = JSON.parse(result.raw);
      } catch {
        const JSON5 = (await import('json5')).default;
        config = JSON5.parse(result.raw);
      }
    }
    return { config, hash };
  }

  async configApplyBatched(patch: Record<string, unknown>): Promise<void> {
    return this.configBatcher.apply(patch);
  }

  // ---- Sessions Usage & Compact ----

  async sessionsUsage(params?: { key?: string; startDate?: string; endDate?: string; limit?: number }) {
    return this.call('sessions.usage', params || {});
  }

  async sessionsCompact(key: string, maxLines?: number) {
    return this.call('sessions.compact', { key, ...(maxLines ? { maxLines } : {}) });
  }

  // ---- Tools ----

  async toolsCatalog(agentId?: string) {
    return this.call('tools.catalog', { ...(agentId ? { agentId } : {}), includePlugins: true });
  }

  // ---- Models ----

  async modelsList() {
    return this.call('models.list', {});
  }

  // ---- Health ----

  async health() {
    // 单进程模式下总是健康的
    return { status: 'ok', mode: 'single-process' };
  }

  // ---- 用户命名空间（与 OctopusBridge 完全一致）----

  static userAgentId(userId: string, agentName: string): string {
    return `ent_${userId}_${agentName}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  }

  static userSessionKey(userId: string, agentName: string, sessionId: string): string {
    const agentId = EngineAdapter.userAgentId(userId, agentName);
    return `agent:${agentId}:session:${sessionId}`;
  }

  static parseSessionKeyUserId(sessionKey: string): string | null {
    const match = sessionKey.match(/^agent:ent_([^_]+)_/);
    return match ? match[1] : null;
  }
}
