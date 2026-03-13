/**
 * Octopus Enterprise - MCP 协议支持模块
 *
 * 提供 MCP Server 的注册、发现、调用和安全沙箱功能。
 * 支持企业级（全员共享）和个人级（用户隔离）两种作用域。
 *
 * @example
 * ```typescript
 * import { MCPRegistry, MCPExecutor, MCPSandbox } from '@octopus/mcp';
 *
 * const registry = new MCPRegistry();
 * const executor = new MCPExecutor();
 * const sandbox = new MCPSandbox();
 *
 * // 注册 MCP Server
 * registry.register({
 *   id: 'db-connector',
 *   name: '数据库连接器',
 *   scope: 'enterprise',
 *   ownerId: null,
 *   transport: 'stdio',
 *   command: 'node',
 *   args: ['./mcp-servers/database-connector/index.js'],
 *   enabled: true,
 *   createdAt: new Date(),
 * });
 *
 * // 连接并调用
 * const config = registry.get('db-connector')!;
 * await executor.connect(config);
 * const tools = await executor.listTools('db-connector');
 * const result = await executor.callTool({
 *   serverId: 'db-connector',
 *   toolName: 'query',
 *   arguments: { sql: 'SELECT * FROM users LIMIT 10' },
 * });
 * ```
 */

// 类型导出
export type {
  MCPScope,
  MCPTransport,
  MCPServerConfig,
  MCPTool,
  MCPToolCallRequest,
  MCPToolCallResult,
  JsonRpcRequest,
  JsonRpcResponse,
  MCPConfig,
} from './types';

// 常量导出
export { DEFAULT_MCP_CONFIG } from './types';

// 核心组件导出
export { MCPRegistry } from './MCPRegistry';
export { MCPExecutor } from './MCPExecutor';
export { MCPSandbox } from './MCPSandbox';
export type { SandboxPolicy } from './MCPSandbox';
