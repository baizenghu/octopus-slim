/**
 * EngineAdapter — 引擎适配层
 *
 * 单进程架构下，通过进程内函数调用替代 WebSocket RPC。
 * 纯转发方法已移除，路由直接调用 bridge.call('rpc.method', params)。
 * 保留：callAgent（复杂事件处理）、config*（重试/锁逻辑）、命名空间工具。
 */

import { createHash, randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { Mutex } from 'async-mutex';
import JSON5 from 'json5';
import { deepMerge } from '../utils/deep-merge';
import { ConfigBatcher } from '../utils/config-batcher';
import { getRuntimeConfig } from '../config';
import { createLogger } from '../utils/logger';
import type { EngineRawEvent } from '../types/engine';

const logger = createLogger('EngineAdapter');

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
  /** Context information injected as <context-note> tag before user message (dual-channel injection) */
  contextNote?: string;
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
  toolCallId?: string;
  toolArgs?: string;
  toolResult?: string;
  phase?: string;
  error?: string;
  runId?: string;
}

// ---- 主类 ----

export class EngineAdapter extends EventEmitter {
  private initialized = false;
  private configMutex = new Mutex();
  private configBatcher: ConfigBatcher;
  private engineServer: { close: (opts?: Record<string, unknown>) => Promise<void> } | null = null;
  private unsubAgentEvents: (() => void) | null = null;
  private unsubHeartbeatEvents: (() => void) | null = null;

  /** 由 callAgent 发起的 runId 集合，用于区分心跳等非 callAgent 触发的事件 */
  readonly trackedRunIds = new Set<string>();

  constructor() {
    super();
    this.configBatcher = new ConfigBatcher(
      (patch) => this.configApply(patch),
      getRuntimeConfig().engine.configBatchWindowMs,
    );
  }

  // ---- 生命周期 ----

  async initialize(port = getRuntimeConfig().engine.port): Promise<void> {
    // 动态导入引擎的 gateway 启动函数（不透明导入避免 TS 追踪）
    const { startGatewayServer } = await opaqueImport(`${ENGINE_ROOT}gateway/server.js`);

    // 启动引擎 gateway（它会自动 setFallbackGatewayContext）
    this.engineServer = await startGatewayServer(port, {
      bind: 'loopback',
      controlUiEnabled: false,
    });

    // 订阅全局 agent 事件，转发给 EventEmitter
    const { onAgentEvent } = await opaqueImport(`${ENGINE_ROOT}infra/agent-events.js`);
    this.unsubAgentEvents = onAgentEvent((evt: EngineRawEvent) => {
      this.emit('_raw_event', evt);
    });

    // 订阅心跳事件，转发给 EventEmitter
    try {
      // heartbeat-visibility 导出 onHeartbeatEvent（也可能在 heartbeat-events 中）
      let onHbEvent: ((cb: (evt: EngineRawEvent) => void) => () => void) | undefined;
      for (const mod of ['infra/heartbeat-visibility.js', 'infra/heartbeat-events.js']) {
        try {
          const m = await opaqueImport(`${ENGINE_ROOT}${mod}`);
          if (typeof m.onHeartbeatEvent === 'function') { onHbEvent = m.onHeartbeatEvent; break; }
        } catch { /* try next */ }
      }
      if (onHbEvent) {
        this.unsubHeartbeatEvents = onHbEvent((evt: EngineRawEvent) => {
          logger.info('heartbeat event received:', { event: JSON.stringify(evt).slice(0, 500) });
          this.emit('heartbeat', evt);
        });
        logger.info('Heartbeat event listener registered');
      } else {
        logger.warn('onHeartbeatEvent not found in engine modules');
      }
    } catch (e: unknown) {
      logger.warn('Heartbeat event listener failed:', { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    }

    // 订阅 cron 事件（通过 fallback context 拿到 cron service）
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const state = (globalThis as Record<symbol, any>)[FALLBACK_GATEWAY_CONTEXT_KEY];
      const cronService = state?.context?.cron;
      if (cronService?._state?.deps) {
        const originalOnEvent = cronService._state.deps.onEvent;
        cronService._state.deps.onEvent = (evt: Record<string, unknown>) => {
          originalOnEvent?.(evt);
          if (evt['action'] === 'finished') {
            this.emit('cron_finished', evt);
          }
        };
        logger.info('Cron event listener registered');
      }
    } catch (e: unknown) {
      logger.warn('Cron event listener failed:', { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined });
    }

    this.initialized = true;
    logger.info(`EngineAdapter initialized (single-process, port=${port})`);
  }

  async shutdown(): Promise<void> {
    if (this.unsubAgentEvents) {
      this.unsubAgentEvents();
      this.unsubAgentEvents = null;
    }
    if (this.unsubHeartbeatEvents) {
      this.unsubHeartbeatEvents();
      this.unsubHeartbeatEvents = null;
    }
    if (this.engineServer) {
      await this.engineServer.close({ reason: 'shutdown' });
      this.engineServer = null;
    }
    this.configBatcher.destroy();
    this.initialized = false;
    logger.info('EngineAdapter shut down');
  }

  get isConnected(): boolean {
    return this.initialized;
  }

  // ---- 通用 RPC 调用（public，路由可直接调用）----

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.initialized) {
      throw new Error('[engine] EngineAdapter not initialized');
    }

    // 通过全局 Symbol 访问引擎设置的 fallback context
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const state = (globalThis as Record<symbol, any>)[FALLBACK_GATEWAY_CONTEXT_KEY];
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
    const rpcPromise = new Promise<T>((resolve, reject) => {
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
              const typedPayload = payload as { runId?: string } | null;
              const typedParams = params as { idempotencyKey?: string } | null;
              const runId = typedPayload?.runId || typedParams?.idempotencyKey;
              logger.error(`agent run ${runId} async error:`, { error: error?.message });
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

    // agent 方法超时由 SSE 层控制（30 分钟），此处只保护短时 RPC
    if (method === 'agent') {
      return rpcPromise;
    }
    const RPC_TIMEOUT_MS = 60_000;
    const timeoutPromise = new Promise<T>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`RPC timeout after ${RPC_TIMEOUT_MS}ms: ${method}`)),
        RPC_TIMEOUT_MS,
      );
      if (timer.unref) timer.unref();
    });
    // 超时后 rpcPromise 可能仍会 reject，加 noop catch 防 unhandled rejection
    rpcPromise.catch(() => {});
    return Promise.race([rpcPromise, timeoutPromise]);
  }

  // ---- Agent 调用 ----

  async callAgent(
    params: AgentCallParams,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<{ runId: string; cleanup: () => void }> {
    const idempotencyKey = params.idempotencyKey || randomUUID();
    this.trackedRunIds.add(idempotencyKey);
    // 不透明导入事件监听
    const { onAgentEvent, emitAgentEvent } = await opaqueImport(`${ENGINE_ROOT}infra/agent-events.js`);

    // 订阅该次运行的事件
    let serverRunId: string | null = null;
    let cleaned = false;
    // 追踪 pending tool calls，只在 result 阶段发出合并后的事件
    const pendingToolCalls = new Map<string, { name: string; args: unknown }>();
    let forcedCleanupTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      pendingToolCalls.clear();
      if (forcedCleanupTimer) clearTimeout(forcedCleanupTimer);
      unsubscribe();
      this.off('_agent_async_error', asyncErrorHandler);
    };

    const unsubscribe = onAgentEvent((evt: EngineRawEvent) => {
      // 只处理本次运行的事件
      if (!this.trackedRunIds.has(evt.runId)) return;

      // tool 事件特殊处理：合并 start/update/result 为单次发送
      if (evt.stream === 'tool') {
        const data: Record<string, unknown> = evt.data || {};
        const phase = data['phase'] as string;
        const toolCallId = data['toolCallId'] as string | undefined;
        const toolName = (data['name'] || data['toolName']) as string;

        if (phase === 'start' && toolCallId) {
          // 存入 pending，同时发一个不含 result 的事件（让前端感知工具开始执行）
          pendingToolCalls.set(toolCallId, { name: toolName, args: data['args'] });
          onEvent({
            type: 'tool_call',
            toolCallId,
            toolName,
            toolArgs: data['args'] ? (typeof data['args'] === 'string' ? data['args'] : JSON.stringify(data['args'])) : undefined,
            runId: evt.runId,
          });
          return;
        }
        if (phase === 'update') {
          // 忽略 update，不发事件
          return;
        }
        if (phase === 'result' && toolCallId) {
          // 从 pending 取出 args，合并 result，发出一次完整事件
          const pending = pendingToolCalls.get(toolCallId);
          pendingToolCalls.delete(toolCallId);
          const args = pending?.args ?? data['args'];
          const name = pending?.name || toolName;
          onEvent({
            type: 'tool_call',
            toolCallId,
            toolName: name,
            toolArgs: args ? (typeof args === 'string' ? args : JSON.stringify(args)) : undefined,
            toolResult: data['result'] ? (typeof data['result'] === 'string' ? data['result'] : JSON.stringify(data['result'])) : undefined,
            runId: evt.runId,
          });
          return;
        }
        // fallback: 无 toolCallId 或未知 phase，走原有逻辑
      }

      const mapped = this.mapEngineEvent(evt);
      if (mapped) {
        onEvent(mapped);
      }

      // 运行结束时清理
      if (evt.stream === 'lifecycle' && (evt.data['phase'] === 'end' || evt.data['phase'] === 'error')) {
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
      logger.error('agent async failure, synthesizing error event:', { error: data.error });
      // 合成 lifecycle error 事件，让 listener 能收到结束信号
      emitAgentEvent({
        runId: effectiveRunId,
        stream: 'lifecycle',
        data: { phase: 'error', error: data.error, endedAt: Date.now(), synthetic: true },
      });
    };
    this.on('_agent_async_error', asyncErrorHandler);

    // 30min 强制兜底：SSE close 未触发时自动释放监听器，防止 OOM
    const FORCED_CLEANUP_DELAY_MS = 30 * 60 * 1000 + 5_000;
    forcedCleanupTimer = setTimeout(() => {
      if (!cleaned) {
        logger.warn('[callAgent] forced cleanup triggered, possible listener leak', { runId: idempotencyKey });
        cleanup();
      }
    }, FORCED_CLEANUP_DELAY_MS);
    (forcedCleanupTimer as NodeJS.Timeout).unref();

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
      return { runId: serverRunId, cleanup };
    } catch (err) {
      this.trackedRunIds.delete(idempotencyKey);
      cleanup();
      throw err;
    }
  }

  // ---- 引擎事件映射 ----

  private mapEngineEvent(evt: EngineRawEvent): AgentStreamEvent | null {
    const { stream, data, runId } = evt;

    switch (stream) {
      case 'assistant':
        return {
          type: 'text_delta',
          content: (data['text'] as string) ?? (data['delta'] as string) ?? '',
          runId,
        };
      case 'tool':
        return {
          type: 'tool_call',
          toolName: ((data['toolName'] || data['name']) as string) ?? 'unknown',
          toolCallId: data['toolCallId'] as string | undefined,
          toolArgs: data['args'] ? (typeof data['args'] === 'string' ? data['args'] : JSON.stringify(data['args'])) : undefined,
          toolResult: data['result'] ? (typeof data['result'] === 'string' ? data['result'] : JSON.stringify(data['result'])) : undefined,
          runId,
        };
      case 'lifecycle':
        if (data['phase'] === 'end') {
          return { type: 'done', runId };
        }
        if (data['phase'] === 'error') {
          return { type: 'error', error: (data['error'] as string) ?? 'unknown error', runId };
        }
        return { type: 'lifecycle', phase: data['phase'] as string, runId };
      case 'thinking':
        return { type: 'thinking', content: (data['text'] as string) ?? '', runId };
      case 'error':
        return { type: 'error', error: (data['message'] as string) ?? 'unknown error', runId };
      default:
        return null;
    }
  }

  // ---- Config（含重试逻辑）----

  /**
   * 通用 config 重试循环：读取当前 config → 回调生成新 config → 写入，冲突自动重试。
   * @param label 日志标识
   * @param buildMerged 回调接收 (currentConfig, baseHash)，返回最终要写入的 JSON 对象或 null（跳过写入）
   */
  private async configRetryLoop(
    label: string,
    buildMerged: (config: Record<string, unknown>, baseHash: string) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null,
  ): Promise<void> {
    return this.configMutex.runExclusive(async () => {
      const maxRetries = getRuntimeConfig().engine.maxConfigRetries;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        const { config, hash: baseHash } = await this.configGetParsed();
        if (!baseHash) throw new Error('config.get did not return hash');
        const merged = await buildMerged(config, baseHash);
        if (!merged) return;
        try {
          await this.call('config.set', { raw: JSON.stringify(merged), baseHash });
          return;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes('invalid config')) {
            logger.error(`${label}: config.set rejected as invalid`);
          }
          if (attempt < maxRetries - 1 && (msg.includes('config changed since last load') || msg.includes('rate limit'))) {
            const delay = msg.includes('rate limit')
              ? Math.min(
                  (parseInt(msg.match(/retry after (\d+)s/)?.[1] || '10', 10) * 1000 + 1_000),
                  30_000,  // 最多等 30s，不持锁超过半分钟
                )
              : (500 * (attempt + 1));
            logger.warn(`${label} attempt ${attempt + 1} failed: ${msg}, retrying in ${delay}ms`);
            await new Promise(r => setTimeout(r, delay));
            continue;
          }
          throw e;
        }
      }
    });
  }

  async configApplyFull(fullConfig: Record<string, unknown>): Promise<void> {
    return this.configRetryLoop('configApplyFull', (latest) => {
      const merged = { ...fullConfig };
      const typedLatest = latest as { messages?: unknown; meta?: unknown };
      if (typedLatest.messages) merged['messages'] = typedLatest.messages;
      if (typedLatest.meta) merged['meta'] = typedLatest.meta;
      return merged;
    });
  }

  /**
   * 在 configMutex 内执行原子 read-modify-write。
   * 回调接收当前引擎配置，返回 patch（deepMerge 后写入）或 null（跳过写入）。
   */
  async configTransaction(
    fn: (config: Record<string, unknown>) => Promise<Record<string, unknown> | null> | Record<string, unknown> | null,
  ): Promise<void> {
    return this.configRetryLoop('configTransaction', async (config) => {
      const patch = await fn(config);
      if (!patch) return null;
      return deepMerge(config, patch);
    });
  }

  async configApply(patch: Record<string, unknown>): Promise<void> {
    return this.configRetryLoop('configApply', (config) => {
      const merged = deepMerge(config, patch);
      // diff: 无变化时跳过写入，避免不必要的引擎 reload
      if (JSON.stringify(merged) === JSON.stringify(config)) return null;
      return merged;
    });
  }

  async configGetParsed(): Promise<{ config: Record<string, unknown>; hash: string }> {
    const result = await this.call<{ raw?: string; hash?: string }>('config.get', {});
    const hash = result?.hash || '';
    let config: Record<string, unknown> = {};
    if (result?.raw) {
      try {
        config = JSON.parse(result.raw);
      } catch {
        config = JSON5.parse(result.raw);
      }
    }
    return { config, hash };
  }

  async configApplyBatched(patch: Record<string, unknown>): Promise<void> {
    return this.configBatcher.apply(patch);
  }

  // ---- Health ----

  async health() {
    // 单进程模式下总是健康的
    return { status: 'ok', mode: 'single-process' };
  }

  // ---- 用户命名空间（与 OctopusBridge 完全一致）----

  static userAgentId(userId: string, agentName: string): string {
    const raw = `ent_${userId}_${agentName}`.toLowerCase();
    const ascii = raw.replace(/[^a-z0-9_-]/g, '');
    // 如果替换后丢失了字符（含非 ASCII），加 hash 后缀保证唯一性
    if (ascii.length < raw.length) {
      const hash = createHash('md5').update(raw).digest('hex').slice(0, 8);
      return `ent_${userId}_${hash}`;
    }
    return ascii;
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
