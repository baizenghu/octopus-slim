/**
 * MCP JSON-RPC Executor
 * 支持 stdio（子进程）和 HTTP（远程服务）两种传输模式
 */

import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  // ── Phase 2.5: 个人 MCP 支持 ──
  scope?: 'enterprise' | 'personal';
  ownerId?: string | null;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface StdioConnection {
  type: 'stdio';
  process: ChildProcess;
  requestId: number;
  pending: Map<number, {
    resolve: (r: any) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
  buffer: string;
  envSignature: string;
}

interface HttpConnection {
  type: 'http';
  url: string;
  requestId: number;
  sessionId?: string;
}

type Connection = StdioConnection | HttpConnection;

const CALL_TIMEOUT = 30_000;

export class MCPExecutor {
  private conns = new Map<string, Connection>();
  private serverConfigs = new Map<string, MCPServerConfig>();

  /** 生成连接 key：按 serverId + userId 隔离 */
  private connKey(serverId: string, userId?: string): string {
    return userId ? `${serverId}__${userId}` : serverId;
  }

  /** 生成用于判断 stdio 子进程是否需要重建的环境指纹 */
  private envSignature(cfg?: MCPServerConfig, userEnv?: Record<string, string>): string {
    const mergedEnv = { ...(cfg?.env || {}), ...(userEnv || {}) };
    const pairs = Object.keys(mergedEnv)
      .sort()
      .map((k) => [k, mergedEnv[k]]);
    return JSON.stringify(pairs);
  }

  private disconnectKey(key: string): void {
    const conn = this.conns.get(key);
    if (!conn) return;
    this.conns.delete(key);
    if (conn.type === 'stdio') {
      try { conn.process.kill(); } catch { /* ignore */ }
    }
  }

  async connect(cfg: MCPServerConfig, userId?: string, userEnv?: Record<string, string>): Promise<void> {
    const key = this.connKey(cfg.id, userId);
    const expectedEnvSignature = this.envSignature(cfg, userEnv);
    const existing = this.conns.get(key);
    if (existing) {
      // stdio 子进程只在启动时读取环境变量；用户连接变化后必须重建
      if (existing.type === 'stdio' && existing.envSignature !== expectedEnvSignature) {
        this.disconnectKey(key);
      } else {
        return;
      }
    }

    // 保存配置供 callTool 按需连接使用
    this.serverConfigs.set(cfg.id, cfg);

    if (cfg.transport === 'http') {
      if (!cfg.url) throw new Error('HTTP MCP server 缺少 url');
      const url = cfg.url;
      const conn: HttpConnection = { type: 'http', url, requestId: 0 };
      // 先不放入 Map，initialize 成功后再放（避免失败时留下无 session 的僵尸连接）
      try {
        await this.sendHttp(conn, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'octopus', version: '1.0.0' },
        });
        // 发 notifications/initialized（部分 MCP server 要求在此之后才接受请求）
        try { await this.notifyHttp(conn, 'notifications/initialized', {}); } catch { /* notification may return 202/204 */ }
      } catch (err) {
        // initialize 失败，不保留连接
        throw err;
      }
      this.conns.set(key, conn);
      return;
    }

    if (cfg.transport !== 'stdio') throw new Error(`transport ${cfg.transport} not supported`);

    const mergedEnv = { ...(cfg.env || {}), ...(userEnv || {}) };
    let child: ChildProcess;

    if (cfg.scope === 'personal' && cfg.ownerId) {
      // 个人 MCP: Docker 沙箱执行
      const dockerArgs = [
        'run', '-i', '--rm',
        '--network', 'octopus-internal',
        '--user', '2000:2000',
        '--memory', '256m',
        '--cpus', '0.5',
      ];
      // 挂载用户工作空间（Docker -v 需要绝对路径）
      const dataRoot = process.env['DATA_ROOT'] || './data';
      const userWorkspace = path.resolve(dataRoot, 'users', cfg.ownerId, 'workspace');
      dockerArgs.push('-v', `${userWorkspace}:/workspace:rw`);
      dockerArgs.push('-w', '/workspace');
      // 注入环境变量
      for (const [k, v] of Object.entries(mergedEnv)) {
        dockerArgs.push('-e', `${k}=${v}`);
      }
      dockerArgs.push('octopus-sandbox:enterprise');
      dockerArgs.push(cfg.command!, ...(cfg.args || []));

      child = spawn('docker', dockerArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      // 企业 MCP: 宿主机直接执行（管理员配置的受信基础设施）
      // 安全：不继承完整 process.env，只传递必要变量 + 管理员显式配置的变量
      child = spawn(cfg.command!, cfg.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME || '/tmp',
          NODE_ENV: process.env.NODE_ENV,
          LANG: process.env.LANG,
          ...mergedEnv,
        },
      });
    }

    const conn: StdioConnection = {
      type: 'stdio',
      process: child,
      requestId: 0,
      pending: new Map(),
      buffer: '',
      envSignature: expectedEnvSignature,
    };

    child.stdout?.on('data', (data: Buffer) => {
      conn.buffer += data.toString();
      const lines = conn.buffer.split('\n');
      conn.buffer = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const res = JSON.parse(t);
          if (res.id !== undefined) {
            const cb = conn.pending.get(res.id);
            if (cb) { clearTimeout(cb.timer); conn.pending.delete(res.id); cb.resolve(res); }
          }
        } catch { /* ignore non-JSON */ }
      }
    });

    child.on('close', () => {
      for (const cb of conn.pending.values()) { clearTimeout(cb.timer); cb.reject(new Error('MCP process exited')); }
      conn.pending.clear();
      this.conns.delete(key);
    });

    this.conns.set(key, conn);

    await this.send(conn, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'octopus', version: '1.0.0' },
    });
    this.notify(conn, 'notifications/initialized', {});
  }

  async listTools(serverId: string, userId?: string): Promise<MCPTool[]> {
    const key = this.connKey(serverId, userId);
    const conn = this.conns.get(key);
    if (!conn) throw new Error(`MCP server not connected: ${serverId}`);
    const res = conn.type === 'http'
      ? await this.sendHttp(conn, 'tools/list', {})
      : await this.sendStdio(conn, 'tools/list', {});
    return (res.result?.tools || []) as MCPTool[];
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    userId?: string,
    userEnv?: Record<string, string>,
  ): Promise<string> {
    const key = this.connKey(serverId, userId);
    let conn = this.conns.get(key);
    const cfg = this.serverConfigs.get(serverId);
    if (!cfg) throw new Error(`MCP server config not found: ${serverId}`);

    const expectedEnvSignature = this.envSignature(cfg, userEnv);
    if (conn?.type === 'stdio' && conn.envSignature !== expectedEnvSignature) {
      this.disconnectKey(key);
      conn = undefined;
    }

    if (!conn) {
      // 按需连接（带入 userEnv）
      await this.connect(cfg, userId, userEnv);
      conn = this.conns.get(key)!;
    }
    const res = conn.type === 'http'
      ? await this.sendHttp(conn, 'tools/call', { name: toolName, arguments: args })
      : await this.sendStdio(conn, 'tools/call', { name: toolName, arguments: args });
    if (res.error) throw new Error(res.error.message);
    const content = res.result?.content;
    if (Array.isArray(content)) {
      const txt = content.find((c: any) => c.type === 'text');
      return txt ? txt.text : JSON.stringify(content);
    }
    return JSON.stringify(res.result);
  }

  /** 断开指定 server 的连接（支持按 userId 隔离） */
  disconnect(serverId: string, userId?: string): void {
    this.disconnectKey(this.connKey(serverId, userId));
  }

  disconnectAll(): void {
    for (const key of Array.from(this.conns.keys())) {
      this.disconnectKey(key);
    }
  }

  /** stdio 模式：通过子进程 stdin/stdout 通信 */
  private sendStdio(conn: StdioConnection, method: string, params: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++conn.requestId;
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, CALL_TIMEOUT);
      conn.pending.set(id, { resolve, reject, timer });
      conn.process.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  /** HTTP 模式：通过 fetch POST JSON-RPC，支持纯 JSON 和 SSE 两种响应格式 */
  private async sendHttp(conn: HttpConnection, method: string, params: unknown): Promise<any> {
    const id = ++conn.requestId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };
      if (conn.sessionId) {
        headers['mcp-session-id'] = conn.sessionId;
      }
      const resp = await fetch(conn.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${resp.statusText} | ${errBody.slice(0, 200)}`);
      }
      // 保存服务端返回的 session ID
      const sid = resp.headers.get('mcp-session-id');
      if (sid) conn.sessionId = sid;
      if (resp.status === 202 || resp.status === 204) return { id, result: {} };

      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream')) {
        // SSE 格式：解析 "event: message\r\ndata: {...}\r\n\r\n"
        const text = await resp.text();
        for (const rawLine of text.split('\n')) {
          const line = rawLine.replace(/\r$/, '');
          if (line.startsWith('data: ')) {
            try { return JSON.parse(line.slice(6)); } catch { /* continue */ }
          }
        }
        throw new Error('SSE response did not contain valid JSON data');
      }
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** HTTP 模式：发送 JSON-RPC notification（无 id 字段，不期望 JSON 响应） */
  private async notifyHttp(conn: HttpConnection, method: string, params: unknown): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };
      if (conn.sessionId) {
        headers['mcp-session-id'] = conn.sessionId;
      }
      const resp = await fetch(conn.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params }),
        signal: controller.signal,
      });
      // 保存服务端返回的 session ID
      const sid = resp.headers.get('mcp-session-id');
      if (sid) conn.sessionId = sid;
      // notification 通常返回 202 或 204，不解析 body
      if (resp.status >= 200 && resp.status < 300) return;
      throw new Error(`HTTP notification ${resp.status}: ${resp.statusText}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private notify(conn: StdioConnection, method: string, params: unknown): void {
    conn.process.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  /** 兼容旧调用：根据连接类型分发 */
  private send(conn: Connection, method: string, params: unknown): Promise<any> {
    return conn.type === 'http' ? this.sendHttp(conn, method, params) : this.sendStdio(conn, method, params);
  }
}
