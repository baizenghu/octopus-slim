/**
 * MCPRegistry — MCP Server 运行时注册表
 *
 * 纯内存 Map，管理 MCP Server 的运行时状态。
 * DB 持久化由路由层（mcp.ts）全权负责，MCPRegistry 不操作数据库。
 *
 * 职责分离：
 * - MCPRegistry: 运行时缓存（注册/注销/查询）
 * - 路由层 mcp.ts: DB CRUD + 调用 MCPRegistry 同步运行时状态
 */

import type { MCPServerConfig } from './types';

export class MCPRegistry {
  /** 运行时缓存：serverId → config */
  private servers: Map<string, MCPServerConfig> = new Map();

  /**
   * 构造函数（可选传 prisma，保持向后兼容，但不使用）
   */
  constructor(_prisma?: unknown) {
    // 纯运行时缓存，不操作数据库
  }

  /**
   * 注册 MCP Server 到运行时缓存（不操作 DB）
   */
  register(config: MCPServerConfig): void {
    this.validateConfig(config);
    this.servers.set(config.id, config);
    console.log(`[MCPRegistry] 注册 MCP Server: ${config.name} (${config.scope})`);
  }

  /**
   * 从运行时缓存移除 MCP Server（不操作 DB）
   */
  unregister(serverId: string): boolean {
    const existed = this.servers.has(serverId);
    this.servers.delete(serverId);
    if (existed) {
      console.log(`[MCPRegistry] 注销 MCP Server: ${serverId}`);
    }
    return existed;
  }

  /**
   * 获取 MCP Server 配置
   */
  get(serverId: string): MCPServerConfig | undefined {
    return this.servers.get(serverId);
  }

  /**
   * 列出用户可用的所有 MCP Server（企业级 + 个人）
   */
  listAvailable(userId: string): MCPServerConfig[] {
    const result: MCPServerConfig[] = [];
    for (const config of this.servers.values()) {
      if (!config.enabled) continue;
      if (config.scope === 'enterprise') {
        result.push(config);
      } else if (config.scope === 'personal' && config.ownerId === userId) {
        result.push(config);
      }
    }
    return result;
  }

  /**
   * 列出所有企业级 MCP Server
   */
  listEnterprise(): MCPServerConfig[] {
    const result: MCPServerConfig[] = [];
    for (const config of this.servers.values()) {
      if (config.scope === 'enterprise') {
        result.push(config);
      }
    }
    return result;
  }

  /**
   * 列出用户的个人 MCP Server
   */
  listPersonal(userId: string): MCPServerConfig[] {
    const result: MCPServerConfig[] = [];
    for (const config of this.servers.values()) {
      if (config.scope === 'personal' && config.ownerId === userId) {
        result.push(config);
      }
    }
    return result;
  }

  /**
   * 获取注册数量
   */
  size(): number {
    return this.servers.size;
  }

  /**
   * 获取所有已注册的 MCP Server
   */
  getAll(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  /**
   * 验证配置合法性
   */
  private validateConfig(config: MCPServerConfig): void {
    if (!config.id || !config.name) {
      throw new Error('MCP Server 配置缺少 id 或 name');
    }
    if (config.transport === 'stdio' && !config.command) {
      throw new Error('stdio 模式的 MCP Server 必须指定 command');
    }
    if (config.transport === 'http' && !config.url) {
      throw new Error('http 模式的 MCP Server 必须指定 url');
    }
  }
}
