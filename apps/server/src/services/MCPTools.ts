/**
 * MCP 工具服务 — 将 MCP Server 的工具动态注入 AI Function Calling
 *
 * 工具命名规则: mcp__{serverId}__{toolName}
 * 例如: mcp__mcp-1234__execute_sql
 */

import { MCPRegistry, MCPExecutor } from '@octopus/mcp';
import type { MCPServerConfig } from '@octopus/mcp';
import type { AppPrismaClient } from '../types/prisma';
import { createLogger } from '../utils/logger';

const logger = createLogger('MCPTools');

/** 分隔符（双下划线，避免与工具名内单下划线冲突） */
const SEP = '__';

/** MCP 工具前缀 */
const MCP_PREFIX = `mcp${SEP}`;

export interface MCPToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

/**
 * 判断工具名是否为 MCP 工具
 */
export function isMCPTool(toolName: string): boolean {
  return toolName.startsWith(MCP_PREFIX);
}

/**
 * 解析 MCP 工具名 → { serverId, toolName }
 */
export function parseMCPToolName(fullName: string): { serverId: string; toolName: string } | null {
  if (!fullName.startsWith(MCP_PREFIX)) return null;
  const rest = fullName.slice(MCP_PREFIX.length);
  const sepIdx = rest.indexOf(SEP);
  if (sepIdx === -1) return null;
  return {
    serverId: rest.slice(0, sepIdx),
    toolName: rest.slice(sepIdx + SEP.length),
  };
}

/**
 * 构建 MCP 工具全名
 */
function buildMCPToolName(serverId: string, toolName: string): string {
  return `${MCP_PREFIX}${serverId}${SEP}${toolName}`;
}

/**
 * 获取用户可用的 MCP 工具列表（OpenAI function calling 格式）
 *
 * 流程: 查询可用 MCP Server → 逐个连接并获取工具 → 转为 OpenAI 格式
 *
 * 每个用户获得独立的 MCP 连接（连接 ID: serverId::userId），
 * 用户个人 .env 中的环境变量会注入到 MCP Server 进程中。
 */
export async function getMCPToolsForUser(
  userId: string,
  prisma: AppPrismaClient,
  mcpRegistry: MCPRegistry,
  mcpExecutor: MCPExecutor,
  userEnv?: Record<string, string>,
): Promise<MCPToolDefinition[]> {
  const tools: MCPToolDefinition[] = [];

  try {
    // 查询用户可用的 MCP Server（企业级已启用 + 用户自己的个人 MCP 已启用）
    const servers = await prisma.mCPServer.findMany({
      where: {
        enabled: true,
        OR: [
          { scope: 'enterprise' },
          { scope: 'personal', ownerId: userId },
        ],
      },
    });

    for (const row of servers) {
      try {
        // 用户专属连接 ID，确保不同用户的 MCP 进程隔离
        const userConnectionId = `${row.id}::${userId}`;

        // 合并环境变量: MCP 配置 env → 用户个人 .env（用户优先）
        const mergedEnv: Record<string, string> = {
          ...(row.env as Record<string, string> | undefined),
          ...userEnv,
        };

        const config: MCPServerConfig = {
          id: userConnectionId,
          name: row.name,
          description: row.description || undefined,
          scope: row.scope as MCPServerConfig['scope'],
          ownerId: row.ownerId,
          transport: row.transport as MCPServerConfig['transport'],
          command: row.command || undefined,
          args: row.args as string[] | undefined,
          url: row.url || undefined,
          env: Object.keys(mergedEnv).length > 0 ? mergedEnv : undefined,
          enabled: row.enabled,
          createdAt: row.createdAt,
        };

        // 确保已连接（使用用户专属连接 ID）
        if (!mcpExecutor.isConnected(userConnectionId)) {
          // 同步到 Registry
          if (!mcpRegistry.get(userConnectionId)) {
            mcpRegistry.register(config);
          }
          await mcpExecutor.connect(config);
        }

        // 获取工具列表
        const serverTools = await mcpExecutor.listTools(userConnectionId);

        for (const tool of serverTools) {
          tools.push({
            type: 'function',
            function: {
              name: buildMCPToolName(userConnectionId, tool.name),
              description: `[${row.name}] ${tool.description}`,
              parameters: tool.inputSchema || { type: 'object', properties: {} },
            },
          });
        }
      } catch (err: any) {
        logger.warn(`Failed to load tools from ${row.name} (${row.id}):`, { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      }
    }
  } catch (err: any) {
    logger.error('Failed to query MCP servers:', { error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
  }

  return tools;
}

/**
 * 执行 MCP 工具调用
 */
export async function executeMCPToolCall(
  fullToolName: string,
  args: Record<string, any>,
  mcpExecutor: MCPExecutor,
): Promise<string> {
  const parsed = parseMCPToolName(fullToolName);
  if (!parsed) {
    return JSON.stringify({ error: `无法解析 MCP 工具名: ${fullToolName}` });
  }

  try {
    const result = await mcpExecutor.callTool({
      serverId: parsed.serverId,
      toolName: parsed.toolName,
      arguments: args,
    });

    if (result.success) {
      return typeof result.content === 'string'
        ? result.content
        : JSON.stringify(result.content);
    } else {
      return JSON.stringify({ error: result.error || 'MCP 工具调用失败' });
    }
  } catch (err: any) {
    return JSON.stringify({ error: `MCP 工具执行错误: ${err.message}` });
  }
}

/**
 * 构建包含 MCP 工具说明的系统提示补充
 */
export function buildMCPSystemPromptSection(mcpToolDefs: MCPToolDefinition[]): string {
  if (mcpToolDefs.length === 0) return '';

  const toolDescriptions = mcpToolDefs.map(t =>
    `- **${t.function.name}**: ${t.function.description}`
  ).join('\n');

  return `

## MCP 外部工具

你还可以通过 MCP 协议调用以下外部工具服务：

${toolDescriptions}

调用这些工具时，请像使用其他 function calling 工具一样，根据用户需求选择合适的工具。
对于数据库查询类工具，请先了解表结构再执行查询。`;
}
