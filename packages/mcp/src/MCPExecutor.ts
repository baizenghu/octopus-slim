/**
 * MCPExecutor — MCP Server 调用执行器
 *
 * 通过 stdio JSON-RPC 与 MCP Server 通信。
 * 流程：
 * 1. 启动 MCP Server 子进程
 * 2. 发送 initialize 请求
 * 3. 获取 tools/list（可用工具列表）
 * 4. 调用 tools/call（执行工具）
 * 5. 关闭连接
 *
 * 参考：https://modelcontextprotocol.io/specification
 */

import { spawn, type ChildProcess } from 'child_process';
import type {
  MCPServerConfig,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResult,
  JsonRpcRequest,
  JsonRpcResponse,
  MCPConfig,
} from './types';
import { DEFAULT_MCP_CONFIG } from './types';

/** 活跃的 MCP 连接 */
interface MCPConnection {
  serverId: string;
  process: ChildProcess;
  requestId: number;
  /** 待处理的响应回调 */
  pendingCallbacks: Map<number, {
    resolve: (res: JsonRpcResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>;
  /** 缓冲区（处理不完整的 JSON 行） */
  buffer: string;
}

export class MCPExecutor {
  private config: MCPConfig;
  /** 活跃连接池 */
  private connections: Map<string, MCPConnection> = new Map();

  constructor(config?: Partial<MCPConfig>) {
    this.config = { ...DEFAULT_MCP_CONFIG, ...config };
  }

  /**
   * 连接到 MCP Server
   */
  async connect(serverConfig: MCPServerConfig): Promise<void> {
    if (serverConfig.transport !== 'stdio') {
      throw new Error(`暂不支持 ${serverConfig.transport} 传输模式`);
    }

    if (this.connections.has(serverConfig.id)) {
      return; // 已连接
    }

    const child = spawn(serverConfig.command!, serverConfig.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...serverConfig.env,
      },
    });

    const conn: MCPConnection = {
      serverId: serverConfig.id,
      process: child,
      requestId: 0,
      pendingCallbacks: new Map(),
      buffer: '',
    };

    // 监听 stdout（JSON-RPC 响应）
    child.stdout?.on('data', (data: Buffer) => {
      conn.buffer += data.toString();
      this.processBuffer(conn);
    });

    child.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCPExecutor] ${serverConfig.name} stderr:`, data.toString());
    });

    child.on('close', (code) => {
      console.log(`[MCPExecutor] ${serverConfig.name} 进程退出，code=${code}`);
      // 拒绝所有待处理的请求
      for (const [, cb] of conn.pendingCallbacks) {
        clearTimeout(cb.timer);
        cb.reject(new Error(`MCP Server 进程意外退出 (code=${code})`));
      }
      conn.pendingCallbacks.clear();
      this.connections.delete(serverConfig.id);
    });

    this.connections.set(serverConfig.id, conn);

    // 发送 initialize 请求
    try {
      await this.sendRequest(conn, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'octopus-enterprise',
          version: '1.0.0',
        },
      });

      // 发送 initialized 通知
      this.sendNotification(conn, 'notifications/initialized', {});

      console.log(`[MCPExecutor] 已连接 MCP Server: ${serverConfig.name}`);
    } catch (err: any) {
      this.disconnect(serverConfig.id);
      throw new Error(`MCP Server 初始化失败: ${err.message}`);
    }
  }

  /**
   * 获取 MCP Server 的工具列表
   */
  async listTools(serverId: string): Promise<MCPTool[]> {
    const conn = this.getConnection(serverId);
    const response = await this.sendRequest(conn, 'tools/list', {});
    return (response.result?.tools || []) as MCPTool[];
  }

  /**
   * 调用 MCP 工具
   */
  async callTool(request: MCPToolCallRequest): Promise<MCPToolCallResult> {
    const startTime = Date.now();
    const conn = this.getConnection(request.serverId);

    try {
      const response = await this.sendRequest(conn, 'tools/call', {
        name: request.toolName,
        arguments: request.arguments,
      });

      if (response.error) {
        return {
          success: false,
          content: null,
          error: response.error.message,
          duration: Date.now() - startTime,
        };
      }

      // MCP 工具结果格式：{ content: [{ type, text|data }] }
      const content = response.result?.content;
      let parsedContent: any;

      if (Array.isArray(content) && content.length > 0) {
        // 取第一个文本内容
        const textItem = content.find((c: any) => c.type === 'text');
        if (textItem) {
          try {
            parsedContent = JSON.parse(textItem.text);
          } catch {
            parsedContent = textItem.text;
          }
        } else {
          parsedContent = content;
        }
      } else {
        parsedContent = response.result;
      }

      return {
        success: true,
        content: parsedContent,
        duration: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        content: null,
        error: err.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 测试 MCP Server 连接
   */
  async testConnection(serverConfig: MCPServerConfig): Promise<{ ok: boolean; error?: string; tools?: MCPTool[] }> {
    if (serverConfig.transport === 'http') {
      return this.testHttpConnection(serverConfig);
    }

    try {
      await this.connect(serverConfig);
      const tools = await this.listTools(serverConfig.id);
      return { ok: true, tools };
    } catch (err: any) {
      return { ok: false, error: err.message };
    } finally {
      this.disconnect(serverConfig.id);
    }
  }

  /**
   * 测试 HTTP 传输的 MCP Server 连接
   */
  private async testHttpConnection(serverConfig: MCPServerConfig): Promise<{ ok: boolean; error?: string; tools?: MCPTool[] }> {
    const baseUrl = serverConfig.url?.replace(/\/+$/, '') || '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.callTimeout);

    try {
      // 1. initialize
      const initRes = await fetch(`${baseUrl}/mcp/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'octopus-enterprise', version: '1.0.0' },
          },
        }),
        signal: controller.signal,
      });

      if (!initRes.ok) {
        return { ok: false, error: `HTTP ${initRes.status}: ${initRes.statusText}` };
      }

      // 消费响应体，提取 session ID
      await initRes.text();
      const sessionId = initRes.headers.get('mcp-session-id') || '';

      // 2. tools/list
      const toolsRes = await fetch(`${baseUrl}/mcp/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/list',
          params: {},
        }),
        signal: controller.signal,
      });

      if (!toolsRes.ok) {
        return { ok: false, error: `获取工具列表失败: HTTP ${toolsRes.status}` };
      }

      const toolsText = await toolsRes.text();
      // SSE 格式: "event: message\ndata: {...}\n\n"
      const dataMatch = toolsText.match(/^data:\s*(.+)$/m);
      if (dataMatch) {
        const parsed = JSON.parse(dataMatch[1]);
        return { ok: true, tools: parsed.result?.tools || [] };
      }

      // 尝试直接 JSON 解析
      try {
        const parsed = JSON.parse(toolsText);
        return { ok: true, tools: parsed.result?.tools || [] };
      } catch {
        return { ok: true, tools: [] };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { ok: false, error: `连接超时 (${this.config.callTimeout}ms)` };
      }
      return { ok: false, error: err.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 断开 MCP Server 连接
   */
  disconnect(serverId: string): void {
    const conn = this.connections.get(serverId);
    if (!conn) return;

    // 清理待处理的请求
    for (const [, cb] of conn.pendingCallbacks) {
      clearTimeout(cb.timer);
      cb.reject(new Error('连接已断开'));
    }

    try {
      conn.process.kill();
    } catch { /* ignore */ }

    this.connections.delete(serverId);
  }

  /**
   * 断开所有连接
   */
  disconnectAll(): void {
    for (const [id] of this.connections) {
      this.disconnect(id);
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  // ========== 内部方法 ==========

  /**
   * 获取活跃连接
   */
  private getConnection(serverId: string): MCPConnection {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`MCP Server 未连接: ${serverId}`);
    return conn;
  }

  /**
   * 发送 JSON-RPC 请求并等待响应
   */
  private sendRequest(conn: MCPConnection, method: string, params: any): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = ++conn.requestId;

      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        conn.pendingCallbacks.delete(id);
        reject(new Error(`MCP 请求超时 (${method}, ${this.config.callTimeout}ms)`));
      }, this.config.callTimeout);

      conn.pendingCallbacks.set(id, { resolve, reject, timer });

      const json = JSON.stringify(request) + '\n';
      conn.process.stdin?.write(json);
    });
  }

  /**
   * 发送 JSON-RPC 通知（无需响应）
   */
  private sendNotification(conn: MCPConnection, method: string, params: any): void {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };
    conn.process.stdin?.write(JSON.stringify(notification) + '\n');
  }

  /**
   * 处理 stdout 缓冲区中的 JSON-RPC 响应
   */
  private processBuffer(conn: MCPConnection): void {
    const lines = conn.buffer.split('\n');
    conn.buffer = lines.pop() || ''; // 最后一行可能不完整

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response: JsonRpcResponse = JSON.parse(trimmed);

        if (response.id !== undefined) {
          const cb = conn.pendingCallbacks.get(response.id);
          if (cb) {
            clearTimeout(cb.timer);
            conn.pendingCallbacks.delete(response.id);
            cb.resolve(response);
          }
        }
      } catch {
        // 非 JSON 行，忽略（可能是 MCP Server 的 log 输出）
      }
    }
  }
}
