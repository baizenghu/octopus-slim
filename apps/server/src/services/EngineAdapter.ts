/**
 * EngineAdapter — 引擎适配层（替代 OctopusBridge 的 WebSocket RPC）
 *
 * 单进程架构下，通过进程内函数调用替代 WebSocket RPC。
 * 保持与 OctopusBridge 完全相同的 public 方法签名，
 * 路由文件只需替换类名即可完成迁移。
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { ConfigBatcher } from '../utils/config-batcher';

// 全局 Symbol，与引擎 server-plugins.ts 中一致
const FALLBACK_GATEWAY_CONTEXT_KEY = Symbol.for("octopus.fallbackGatewayContextState");

// 不透明动态导入 — 阻止 TypeScript 追踪引擎源码（避免 TS6059 rootDir 错误）
// eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
const opaqueImport = new Function('s', 'return import(s)') as (specifier: string) => Promise<any>;
const ENGINE_ROOT = new URL('../../../../packages/engine/src/', import.meta.url).href;

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
  /** Whether the sender is an admin user (controls owner-only tools like gateway). */
  isAdmin?: boolean;
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
  private engineServer: { close: (opts?: Record<string, unknown>) => Promise<void> } | null = null;
  private unsubAgentEvents: (() => void) | null = null;

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

  async initialize(port = 19791): Promise<void> {
    // 动态导入引擎的 gateway 启动函数（不透明导入避免 TS 追踪）
    const { startGatewayServer } = await opaqueImport(`${ENGINE_ROOT}gateway/server.js`);

    // 启动引擎 gateway（它会自动 setFallbackGatewayContext）
    this.engineServer = await startGatewayServer(port, {
      bind: 'loopback',
      controlUiEnabled: false,
    });

    // 订阅全局 agent 事件，转发给 EventEmitter
    const { onAgentEvent } = await opaqueImport(`${ENGINE_ROOT}infra/agent-events.js`);
    this.unsubAgentEvents = onAgentEvent((evt: any) => {
      this.emit('_raw_event', evt);
    });

    this.initialized = true;
    console.log(`[engine] EngineAdapter initialized (single-process, port=${port})`);
  }

  async shutdown(): Promise<void> {
    if (this.unsubAgentEvents) {
      this.unsubAgentEvents();
      this.unsubAgentEvents = null;
    }
    if (this.engineServer) {
      await this.engineServer.close({ reason: 'shutdown' });
      this.engineServer = null;
    }
    this.configBatcher.destroy();
    this.initialized = false;
    console.log('[engine] EngineAdapter shut down');
  }

  get isConnected(): boolean {
    return this.initialized;
  }

  // ---- 通用 RPC 调用 ----

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.initialized) {
      throw new Error('[engine] EngineAdapter not initialized');
    }

    // 通过全局 Symbol 访问引擎设置的 fallback context
    const state = (globalThis as any)[FALLBACK_GATEWAY_CONTEXT_KEY];
    const context = state?.context;
    if (!context) {
      throw new Error('[engine] No gateway context available — engine not started?');
    }

    // 不透明导入引擎模块
    const { handleGatewayRequest } = await opaqueImport(`${ENGINE_ROOT}gateway/server-methods.js`);
    const { PROTOCOL_VERSION } = await opaqueImport(`${ENGINE_ROOT}gateway/protocol/index.js`);

    // 构造合成 operator 客户端（与引擎 server-plugins.ts 中 createSyntheticOperatorClient 一致）
    const client = {
      connect: {
        minProtocol: PROTOCOL_VERSION,
        maxProtocol: PROTOCOL_VERSION,
        client: {
          id: 'gateway-client' as const,
          version: 'internal',
          platform: 'node',
          mode: 'backend' as const,
        },
        role: 'operator',
        scopes: ['operator.admin', 'operator.approvals', 'operator.pairing'],
      },
    };

    // Promise 包装 respond 回调
    return new Promise<T>((resolve, reject) => {
      let responded = false;

      void handleGatewayRequest({
        req: {
          type: 'req' as const,
          id: `engine-adapter-${randomUUID()}`,
          method,
          params: params ?? {},
        },
        client,
        isWebchatConnect: () => false,
        respond: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
          if (responded) {
            // agent handler 的第二次 respond（异步执行完成/失败后）。
            if (!ok && method === 'agent') {
              const runId = (payload as any)?.runId || (params as any)?.idempotencyKey;
              console.error(`[engine] agent run ${runId} async error:`, error?.message);
              this.emit('_agent_async_error', { runId, error: error?.message ?? 'unknown error' });
            }
            return;
          }
          responded = true;
          if (ok) {
            resolve(payload as T);
          } else {
            reject(new Error(error?.message ?? `Gateway method "${method}" failed`));
          }
        },
        context,
      }).catch((err: Error) => {
        if (!responded) {
          responded = true;
          reject(err);
        }
      });
    });
  }

  // ---- Agent 调用 ----

  async callAgent(
    params: AgentCallParams,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<{ runId: string }> {
    const idempotencyKey = params.idempotencyKey || randomUUID();
    this.trackedRunIds.add(idempotencyKey);
    // 不透明导入事件监听
    const { onAgentEvent, emitAgentEvent } = await opaqueImport(`${ENGINE_ROOT}infra/agent-events.js`);

    // 订阅该次运行的事件
    let serverRunId: string | null = null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
      this.off('_agent_async_error', asyncErrorHandler);
    };

    const unsubscribe = onAgentEvent((evt: any) => {
      // 只处理本次运行的事件
      if (!this.trackedRunIds.has(evt.runId)) return;
      const mapped = this.mapEngineEvent(evt);
      if (mapped) {
        onEvent(mapped);
      }

      // 运行结束时清理
      if (evt.stream === 'lifecycle' && (evt.data.phase === 'end' || evt.data.phase === 'error')) {
        this.trackedRunIds.delete(evt.runId);
        cleanup();
      }
    });

    // 监听异步执行失败（dispatchAgentRunFromGateway 的 .catch 触发）。
    // 引擎的 agent handler 先 respond(accepted) 再异步执行 agentCommandFromIngress。
    // 如果异步执行在 emitAgentEvent(lifecycle:start) 之前就失败（如 agent 不存在、
    // 配置解析错误等），不会发出任何 agent event，listener 永远等不到结束信号。
    // 此处捕获第二次 respond(error) 并合成 lifecycle error 事件来通知 listener。
    const asyncErrorHandler = (data: { runId: string; error: string }) => {
      const effectiveRunId = serverRunId || idempotencyKey;
      if (data.runId !== effectiveRunId) return;
      console.error('[engine] agent async failure, synthesizing error event:', data.error);
      // 合成 lifecycle error 事件，让 listener 能收到结束信号
      emitAgentEvent({
        runId: effectiveRunId,
        stream: 'lifecycle',
        data: { phase: 'error', error: data.error, endedAt: Date.now(), synthetic: true },
      });
    };
    this.on('_agent_async_error', asyncErrorHandler);

    try {
      const { isAdmin, ...rpcParams } = params;
      const result = await this.call<{ runId?: string; accepted?: boolean }>('agent', {
        ...rpcParams,
        idempotencyKey,
        deliver: params.deliver ?? false,
        senderIsOwner: isAdmin === true,
      });

      serverRunId = result.runId || idempotencyKey;
      this.trackedRunIds.add(serverRunId);
      return { runId: serverRunId };
    } catch (err) {
      this.trackedRunIds.delete(idempotencyKey);
      cleanup();
      throw err;
    }
  }

  // ---- 引擎事件映射 ----

  private mapEngineEvent(evt: { stream: string; data: Record<string, unknown>; runId: string }): AgentStreamEvent | null {
    const { stream, data, runId } = evt;

    switch (stream) {
      case 'assistant':
        return {
          type: 'text_delta',
          content: (data.text as string) ?? (data.delta as string) ?? '',
          runId,
        };
      case 'tool':
        return {
          type: 'tool_call',
          toolName: data.toolName as string,
          toolArgs: typeof data.args === 'string' ? data.args : JSON.stringify(data.args ?? ''),
          toolResult: typeof data.result === 'string' ? data.result : JSON.stringify(data.result ?? ''),
          runId,
        };
      case 'lifecycle':
        if (data.phase === 'end') {
          return { type: 'done', runId };
        }
        if (data.phase === 'error') {
          return { type: 'error', error: (data.error as string) ?? 'unknown error', runId };
        }
        return { type: 'lifecycle', phase: data.phase as string, runId };
      case 'thinking':
        return { type: 'thinking', content: (data.text as string) ?? '', runId };
      case 'error':
        return { type: 'error', error: (data.message as string) ?? 'unknown error', runId };
      default:
        return null;
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
