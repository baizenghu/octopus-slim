/**
 * MCP 模块类型定义
 *
 * MCP (Model Context Protocol) 支持两种传输模式：
 * - stdio: 通过子进程 stdin/stdout 通信的 JSON-RPC
 * - http: 通过 HTTP 请求的 JSON-RPC（预留）
 *
 * 企业级 MCP Server: admin 配置，全员可用（内部数据库/OA/ERP 等）
 * 个人 MCP Server: 用户自行配置，仅本人可用
 */

// ========== 作用域 ==========

/** MCP Server 作用域 */
export type MCPScope = 'enterprise' | 'personal';

/** MCP 传输协议 */
export type MCPTransport = 'stdio' | 'http';

// ========== MCP Server 配置 ==========

/** MCP Server 配置 */
export interface MCPServerConfig {
  /** 唯一标识 */
  id: string;
  /** 显示名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 作用域 */
  scope: MCPScope;
  /** 所有者 ID（personal 时为用户 ID，enterprise 时为 null） */
  ownerId: string | null;
  /** 传输协议 */
  transport: MCPTransport;
  /** stdio 模式：启动命令 */
  command?: string;
  /** stdio 模式：命令参数 */
  args?: string[];
  /** http 模式：API 地址 */
  url?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: Date;
}

// ========== MCP Tool ==========

/** MCP Tool 定义（从 MCP Server 动态获取） */
export interface MCPTool {
  /** 工具名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 参数 JSON Schema */
  inputSchema: Record<string, any>;
}

/** MCP Tool 调用请求 */
export interface MCPToolCallRequest {
  /** MCP Server ID */
  serverId: string;
  /** Tool 名称 */
  toolName: string;
  /** 调用参数 */
  arguments: Record<string, any>;
}

/** MCP Tool 调用结果 */
export interface MCPToolCallResult {
  /** 是否成功 */
  success: boolean;
  /** 结果内容（JSON 或文本） */
  content: any;
  /** 错误信息 */
  error?: string;
  /** 耗时(ms) */
  duration: number;
}

// ========== JSON-RPC ==========

/** JSON-RPC 请求 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

/** JSON-RPC 响应 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

// ========== 配置 ==========

/** MCP 模块配置 */
export interface MCPConfig {
  /** 连接超时(ms) */
  connectionTimeout: number;
  /** 工具调用超时(ms) */
  callTimeout: number;
  /** 最大并发连接数 */
  maxConnections: number;
}

/** 默认配置 */
export const DEFAULT_MCP_CONFIG: MCPConfig = {
  connectionTimeout: 10_000,
  callTimeout: 30_000,
  maxConnections: 50,
};
