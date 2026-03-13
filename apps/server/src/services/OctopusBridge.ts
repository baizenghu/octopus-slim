/**
 * 企业版与 Native Octopus Gateway 的 WebSocket RPC 桥接层
 *
 * 职责：
 * 1. 双连接热备（primary + standby），断线时 0 延迟切换
 * 2. RPC 调用封装（agent/sessions/cron/config/agents）
 * 3. 事件订阅转发（agent 流式事件 → 回调）
 * 4. 用户命名空间隔离（userId → agentId/sessionKey 前缀映射）
 */

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { ConfigBatcher } from '../utils/config-batcher';

// ---- 协议帧类型 ----

interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: unknown;
}

interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
}

interface EventFrame {
  type: 'event';
  event: string;
  payload?: unknown;
  seq?: number;
}

type Frame = RequestFrame | ResponseFrame | EventFrame;

// ---- 配置 ----

export interface BridgeConfig {
  url: string;              // ws://127.0.0.1:18791
  token: string;            // gateway auth token
  reconnectMs?: number;     // 默认 3000
  requestTimeoutMs?: number; // 默认 30000
}

// ---- Agent RPC 参数 ----

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

// ---- 事件回调 ----

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

// ---- 连接槽位 ----

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ConnectionSlot {
  id: number;
  ws: WebSocket | null;
  connected: boolean;
  pendingRequests: Map<string, PendingRequest>;
  connectRequestId: string | null;
  connectResolve: ((v: void) => void) | null;
  connectReject: ((e: Error) => void) | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
}

// ---- 主类 ----

export class OctopusBridge extends EventEmitter {
  private config: Required<BridgeConfig>;
  private primary: ConnectionSlot;
  private standby: ConnectionSlot;
  private shouldReconnect = true;
  private configBatcher: ConfigBatcher;
  /** 由 callAgent 发起的 runId 集合，用于区分心跳等非 callAgent 触发的事件 */
  readonly trackedRunIds = new Set<string>();

  constructor(config: BridgeConfig) {
    super();
    this.config = {
      reconnectMs: 3000,
      requestTimeoutMs: 30000,
      ...config,
    };
    this.primary = this.createSlot(0);
    this.standby = this.createSlot(1);
    this.configBatcher = new ConfigBatcher(
      (patch) => this.configApply(patch),
      2000,
    );
  }

  private createSlot(id: number): ConnectionSlot {
    return {
      id,
      ws: null,
      connected: false,
      pendingRequests: new Map(),
      connectRequestId: null,
      connectResolve: null,
      connectReject: null,
      reconnectTimer: null,
      reconnectAttempt: 0,
    };
  }

  // ---- 连接管理 ----

  async connect(): Promise<void> {
    // 先连 primary，成功后后台连 standby
    await this.connectSlot(this.primary);
    this.connectSlot(this.standby).catch((err) => {
      console.warn(`[bridge] Standby connection failed (will retry): ${err.message}`);
    });
  }

  private async connectSlot(slot: ConnectionSlot): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        slot.connectResolve = resolve;
        slot.connectReject = reject;
        const label = slot === this.primary ? 'primary' : 'standby';
        slot.ws = new WebSocket(this.config.url, {
          headers: { Origin: this.config.url.replace(/^ws/, 'http') },
        });

        slot.ws.on('open', () => {
          console.log(`[bridge] ${label} WebSocket connected`);
        });

        slot.ws.on('message', (data: WebSocket.RawData) => {
          try {
            const frame: Frame = JSON.parse(data.toString());
            this.handleFrame(slot, frame);
          } catch (err) {
            console.error(`[bridge] ${label} parse error:`, err);
          }
        });

        slot.ws.on('close', (code, reason) => {
          console.log(`[bridge] ${label} closed: ${code} ${reason.toString()}`);
          const wasConnected = slot.connected;
          slot.connected = false;
          const pendingReject = slot.connectReject;
          slot.connectResolve = null;
          slot.connectReject = null;
          slot.connectRequestId = null;
          this.rejectSlotPending(slot, 'Connection closed');

          // 初始连接尚未完成时 reject connect() promise
          if (pendingReject) {
            pendingReject(new Error(`[bridge] ${label} closed before auth: ${code} ${reason.toString()}`));
          }

          if (!this.shouldReconnect) return;

          if (slot === this.primary) {
            // Primary 断线 → 尝试提升 standby
            if (this.standby.connected) {
              this.promote();
            } else if (wasConnected) {
              // 两条都断了，重连两条
              this.scheduleReconnect(slot);
              if (!this.standby.ws && !this.standby.reconnectTimer) {
                this.scheduleReconnect(this.standby);
              }
            } else {
              this.scheduleReconnect(slot);
            }
          } else {
            // Standby 断线 → 静默重连
            this.scheduleReconnect(slot);
          }
        });

        slot.ws.on('error', (err) => {
          console.error(`[bridge] ${label} error:`, err.message);
          if (!slot.connected) {
            slot.connectResolve = null;
            slot.connectReject = null;
            slot.connectRequestId = null;
            reject(err);
          }
        });
      } catch (err) {
        slot.connectResolve = null;
        slot.connectReject = null;
        slot.connectRequestId = null;
        reject(err);
      }
    });
  }

  /**
   * 提升 standby 为 primary（0 延迟切换）
   */
  private promote(): void {
    const oldPrimary = this.primary;
    this.primary = this.standby;
    this.standby = oldPrimary;
    console.log('[bridge] Promoted standby to primary (hot failover)');
    this.emit('failover');

    // 旧 primary 作为新 standby，后台重连
    if (!this.standby.connected && !this.standby.reconnectTimer) {
      this.scheduleReconnect(this.standby);
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.configBatcher.destroy();
    for (const slot of [this.primary, this.standby]) {
      if (slot.reconnectTimer) clearTimeout(slot.reconnectTimer);
      slot.reconnectTimer = null;
      if (slot.ws) {
        slot.ws.close();
        slot.ws = null;
      }
      slot.connected = false;
      slot.connectResolve = null;
      slot.connectReject = null;
      slot.connectRequestId = null;
      this.rejectSlotPending(slot, 'Disconnecting');
    }
  }

  get isConnected(): boolean {
    return this.primary.connected || this.standby.connected;
  }

  // ---- RPC 调用 ----

  async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    // 优先用 primary，primary 断了自动切 standby
    let slot = this.primary;
    if (!slot.connected || !slot.ws) {
      if (this.standby.connected && this.standby.ws) {
        this.promote();
        slot = this.primary;
      } else {
        throw new Error('[bridge] Not connected to native gateway');
      }
    }

    const id = randomUUID();
    const frame: RequestFrame = { type: 'req', id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        slot.pendingRequests.delete(id);
        reject(new Error(`[bridge] RPC timeout: ${method} (${this.config.requestTimeoutMs}ms)`));
      }, this.config.requestTimeoutMs);

      slot.pendingRequests.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      slot.ws!.send(JSON.stringify(frame));
    });
  }

  // ---- 便捷方法 ----

  /** 调用 agent RPC 并通过回调返回流式事件 */
  async callAgent(
    params: AgentCallParams,
    onEvent: (event: AgentStreamEvent) => void,
  ): Promise<{ runId: string }> {
    const idempotencyKey = params.idempotencyKey || randomUUID();

    let serverRunId: string | null = null;

    const eventHandler = (frame: EventFrame) => {
      if (frame.event !== 'agent') return;
      const p = frame.payload as Record<string, unknown>;
      const eventRunId = p?.runId as string | undefined;
      const eventIdem = p?.idempotencyKey as string | undefined;
      const match =
        eventIdem === idempotencyKey ||
        eventRunId === idempotencyKey ||
        (serverRunId !== null && eventRunId === serverRunId);
      if (!match) return;
      const parsed = this.parseAgentEvent(p);
      onEvent(parsed);
      if (parsed.type === 'done' || parsed.type === 'error') {
        this.off('_raw_event', eventHandler);
        this.trackedRunIds.delete(idempotencyKey);
        if (serverRunId) this.trackedRunIds.delete(serverRunId);
      }
    };

    this.on('_raw_event', eventHandler);
    this.trackedRunIds.add(idempotencyKey);

    try {
      const result = await this.call<{ status: string; runId: string }>('agent', {
        ...params,
        idempotencyKey,
        deliver: params.deliver ?? false,
      });

      serverRunId = result.runId || idempotencyKey;
      this.trackedRunIds.add(serverRunId);
      return { runId: serverRunId };
    } catch (err) {
      this.off('_raw_event', eventHandler);
      this.trackedRunIds.delete(idempotencyKey);
      throw err;
    }
  }

  // Sessions
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

  // Agents CRUD
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

  // Agent files (IDENTITY.md, SOUL.md, etc.)
  async agentFilesSet(agentId: string, fileName: string, content: string) {
    return this.call('agents.files.set', { agentId, name: fileName, content });
  }

  async agentFilesGet(agentId: string, fileName: string) {
    return this.call('agents.files.get', { agentId, name: fileName });
  }

  // Cron
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

  // Config
  async configGet() {
    return this.call('config.get', {});
  }

  /**
   * 应用配置变更（全量替换模式）。
   *
   * 使用 config.set RPC 而非 config.apply，避免触发不必要的 SIGUSR1 重启。
   * config.set 写入配置后由 [reload] 模块智能评估：
   *   - agents.list 等动态路径 → 热加载，不重启
   *   - plugins.entries 等路径 → 仅在确实需要时才重启
   */
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
          console.warn(`[bridge] configApplyFull attempt ${attempt + 1} failed: ${e.message}, retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * 应用配置 patch（自动 read-merge-write）。
   * 使用 config.set RPC，避免强制 SIGUSR1 重启。
   */
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
          console.warn(`[bridge] configApply attempt ${attempt + 1} failed: ${e.message}, retrying in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
  }

  /**
   * 获取当前完整配置（已解析）
   */
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

  /**
   * 批量合并的 configApply（推荐使用）
   */
  async configApplyBatched(patch: Record<string, unknown>): Promise<void> {
    return this.configBatcher.apply(patch);
  }

  // Sessions usage & compact
  async sessionsUsage(params?: { key?: string; startDate?: string; endDate?: string; limit?: number }) {
    return this.call('sessions.usage', params || {});
  }

  async sessionsCompact(key: string, maxLines?: number) {
    return this.call('sessions.compact', { key, ...(maxLines ? { maxLines } : {}) });
  }

  // Tools catalog
  async toolsCatalog(agentId?: string) {
    return this.call('tools.catalog', { ...(agentId ? { agentId } : {}), includePlugins: true });
  }

  // Models
  async modelsList() {
    return this.call('models.list', {});
  }

  // Health
  async health() {
    return this.call('health', {});
  }

  // ---- 用户命名空间 ----

  /** 生成用户隔离的 agent ID */
  static userAgentId(userId: string, agentName: string): string {
    return `ent_${userId}_${agentName}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  }

  /** 生成用户隔离的 session key */
  static userSessionKey(userId: string, agentName: string, sessionId: string): string {
    const agentId = OctopusBridge.userAgentId(userId, agentName);
    return `agent:${agentId}:session:${sessionId}`;
  }

  /** 从 session key 解析 userId */
  static parseSessionKeyUserId(sessionKey: string): string | null {
    const match = sessionKey.match(/^agent:ent_([^_]+)_/);
    return match ? match[1] : null;
  }

  // ---- 内部方法 ----

  private handleFrame(slot: ConnectionSlot, frame: Frame): void {
    switch (frame.type) {
      case 'event':
        this.handleEvent(slot, frame as EventFrame);
        break;
      case 'res':
        this.handleResponse(slot, frame as ResponseFrame);
        break;
    }
  }

  private handleEvent(slot: ConnectionSlot, frame: EventFrame): void {
    if (frame.event === 'connect.challenge') {
      this.sendConnectResponse(slot, frame.payload as { nonce?: string });
      return;
    }

    // 只从 primary 连接 emit 事件，避免重复
    if (slot === this.primary) {
      this.emit('_raw_event', frame);
      this.emit(frame.event, frame.payload);
    }
  }

  private sendConnectResponse(slot: ConnectionSlot, _challenge: { nonce?: string }): void {
    const id = randomUUID();
    slot.connectRequestId = id;
    const frame: RequestFrame = {
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'octopus-control-ui',
          version: '1.0.0',
          platform: process.platform,
          mode: 'backend',
        },
        auth: { token: this.config.token },
        role: 'operator',
        scopes: ['operator.admin'],
        caps: ['tool-events'],
      },
    };
    slot.ws?.send(JSON.stringify(frame));
  }

  private handleResponse(slot: ConnectionSlot, frame: ResponseFrame): void {
    // connect 握手响应
    if (frame.id === slot.connectRequestId) {
      slot.connectRequestId = null;
      const resolve = slot.connectResolve;
      const reject = slot.connectReject;
      slot.connectResolve = null;
      slot.connectReject = null;

      if (frame.ok) {
        slot.connected = true;
        slot.reconnectAttempt = 0;
        const label = slot === this.primary ? 'primary' : 'standby';
        console.log(`[bridge] ${label} authenticated`);
        if (resolve) resolve();
      } else {
        const err = new Error(frame.error?.message || 'Auth failed');
        if (reject) reject(err);
      }
      return;
    }

    // RPC 响应 — 在该 slot 自己的 pendingRequests 中查找
    const pending = slot.pendingRequests.get(frame.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    slot.pendingRequests.delete(frame.id);

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      pending.reject(new Error(frame.error?.message || 'RPC error'));
    }
  }

  private parseAgentEvent(payload: Record<string, unknown>): AgentStreamEvent {
    const data = payload.data as Record<string, unknown> | undefined;

    if (payload?.stream === 'assistant') {
      if (data?.text) {
        return { type: 'text_delta', content: data.text as string, runId: payload.runId as string };
      }
    }
    if (payload?.stream === 'lifecycle') {
      const phase = data?.phase as string | undefined;
      if (phase === 'end') return { type: 'done', runId: payload.runId as string };
      if (phase === 'error') return { type: 'error', error: data?.error as string, runId: payload.runId as string };
      return { type: 'lifecycle', phase: phase ?? 'unknown', runId: payload.runId as string };
    }
    if (payload?.stream === 'tool') {
      return {
        type: 'tool_call',
        toolName: (data?.name ?? data?.toolName) as string,
        toolArgs: data?.args as string,
        runId: payload.runId as string,
      };
    }
    if (payload?.stream === 'thinking') {
      return { type: 'thinking', content: data?.content as string, runId: payload.runId as string };
    }
    return { type: 'lifecycle', phase: 'unknown', runId: payload?.runId as string };
  }

  private scheduleReconnect(slot: ConnectionSlot): void {
    if (slot.reconnectTimer) return;
    const baseMs = this.config.reconnectMs;
    const delay = slot.reconnectAttempt === 0
      ? baseMs
      : Math.min(baseMs * Math.pow(2, slot.reconnectAttempt), 30000);
    slot.reconnectAttempt++;
    const label = slot === this.primary ? 'primary' : 'standby';

    console.log(`[bridge] ${label} reconnecting in ${delay}ms (attempt ${slot.reconnectAttempt})...`);
    slot.reconnectTimer = setTimeout(async () => {
      slot.reconnectTimer = null;
      try {
        await this.connectSlot(slot);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[bridge] ${label} reconnect failed:`, msg);
        if (this.shouldReconnect) {
          this.scheduleReconnect(slot);
        }
      }
    }, delay);
  }

  private rejectSlotPending(slot: ConnectionSlot, reason: string): void {
    for (const [, pending] of slot.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`[bridge] ${reason}`));
    }
    slot.pendingRequests.clear();
  }
}
