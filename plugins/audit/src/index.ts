import { PrismaClient } from '@prisma/client';
import { extractUserId } from './utils';
import { AuditFileWriter } from './file-writer';

/** 向 DB URL 追加 connection_limit 参数（如不存在），控制连接池大小 */
function appendConnectionLimit(url: string, limit: number): string {
  if (url.includes('connection_limit')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}connection_limit=${limit}`;
}

/**
 * Enterprise Audit Plugin
 *
 * 注册原生 hook 捕获 agent 内部行为，双写到 DB + JSONL 文件。
 * 注意：入口函数必须是同步的（octopus 忽略 promise 返回值）
 */

// 审计 action 常量（与 enterprise-audit 包的 AuditAction 对齐）
const Actions = {
  TOOL_CALL: 'tool:call',
  TOOL_CALL_RESULT: 'tool:call:result',
  LLM_RESPONSE: 'llm:response',
  SESSION_CREATE: 'session:create',
  SESSION_END: 'session:end',
  AGENT_END: 'agent:end',
} as const;

interface PluginConfig {
  databaseUrl?: string;
  logDir?: string;
  retentionDays?: number;
}

export default function enterpriseAuditPlugin(api: any) {
  const config: PluginConfig = api.pluginConfig || {};

  // 从环境变量获取 databaseUrl，config 优先
  const databaseUrl = config.databaseUrl || process.env['DATABASE_URL'];

  // 初始化文件写入器（同步，立即可用）
  const logDir = config.logDir
    || (process.env['DATA_ROOT']
      ? `${process.env['DATA_ROOT']}/audit-logs`
      : './data/audit-logs');
  const fileWriter = new AuditFileWriter(logDir);

  // 启动时清理超过 retentionDays 的过期 JSONL 审计文件
  const retentionDays = config.retentionDays || 90;
  const cleanedFiles = fileWriter.cleanupExpired(retentionDays);
  if (cleanedFiles > 0) {
    api.logger.info(`cleaned ${cleanedFiles} expired audit files (retention: ${retentionDays}d)`);
  }

  // Prisma 延迟初始化（异步，连接完成前 DB 写入跳过，文件写入正常）
  let prisma: PrismaClient | null = null;
  let retryTimer: ReturnType<typeof setInterval> | null = null;
  if (databaseUrl) {
    // 限制连接池大小：plugin 与 enterprise-mcp 共享 native gateway 进程，
    // 减少每个 PrismaClient 的连接数以避免 MySQL max_connections 耗尽
    const dbUrlWithPoolLimit = appendConnectionLimit(databaseUrl, 3);
    const p = new PrismaClient({
      datasources: { db: { url: dbUrlWithPoolLimit } },
      log: [],
    });
    p.$connect()
      .then(() => {
        prisma = p;
        api.logger.info('database connected');
      })
      .catch((err: any) => {
        api.logger.error(`database connection failed: ${err.message}`);
        api.logger.warn('falling back to file-only audit, retrying every 60s');
        retryTimer = setInterval(() => {
          p.$connect()
            .then(() => {
              prisma = p;
              api.logger.info('database reconnected');
              if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
            })
            .catch((e: any) => api.logger.warn(`DB reconnect failed: ${e.message}`));
        }, 60_000);
        retryTimer.unref();
      });
  } else {
    api.logger.warn('databaseUrl not configured, DB audit disabled');
  }

  /**
   * 审计写入（双写：DB + 文件）
   * 任一失败不阻塞
   */
  async function audit(entry: {
    userId: string | null;
    action: string;
    resource?: string;
    details?: Record<string, unknown>;
    success?: boolean;
    errorMessage?: string;
    durationMs?: number;
  }): Promise<void> {
    // 文件写入（同步，立即执行）
    fileWriter.write(entry);

    // DB 写入（prisma 初始化后才执行）
    if (prisma) {
      try {
        await prisma.auditLog.create({
          data: {
            userId: entry.userId,
            action: entry.action,
            resource: entry.resource || null,
            details: entry.details ? (entry.details as any) : undefined,
            ipAddress: null,
            userAgent: null,
            success: entry.success ?? true,
            errorMessage: entry.errorMessage || null,
            durationMs: entry.durationMs || null,
          },
        });
      } catch (err: any) {
        // FK violation — retry with null userId
        if (err?.code === 'P2003') {
          try {
            await prisma.auditLog.create({
              data: {
                userId: null,
                action: entry.action,
                resource: entry.resource || null,
                details: entry.details ? (entry.details as any) : undefined,
                ipAddress: null,
                userAgent: null,
                success: entry.success ?? true,
                errorMessage: entry.errorMessage || null,
                durationMs: entry.durationMs || null,
              },
            });
          } catch {
            api.logger.warn(`audit DB write failed (FK fallback): ${entry.action}`);
          }
        } else {
          api.logger.warn(`audit DB write failed: ${err.message}`);
        }
      }
    }
  }

  // ─── Hook: before_tool_call ──────────────────────────
  api.on('before_tool_call', async (
    event: { toolName: string; params: Record<string, unknown> },
    ctx: { agentId?: string; sessionKey?: string }
  ) => {
    const userId = extractUserId(ctx.agentId);
    await audit({
      userId,
      action: Actions.TOOL_CALL,
      resource: `tool:${event.toolName}`,
      details: {
        toolName: event.toolName,
        // 参数可能包含敏感信息，只记录 key 不记录 value
        paramKeys: Object.keys(event.params || {}),
      },
      success: true,
    });
  });

  // ─── Hook: after_tool_call ───────────────────────────
  api.on('after_tool_call', async (
    event: {
      toolName: string;
      params: Record<string, unknown>;
      result?: unknown;
      error?: string;
      durationMs?: number;
    },
    ctx: { agentId?: string; sessionKey?: string }
  ) => {
    const userId = extractUserId(ctx.agentId);
    await audit({
      userId,
      action: Actions.TOOL_CALL_RESULT,
      resource: `tool:${event.toolName}`,
      details: {
        toolName: event.toolName,
        hasResult: event.result != null,
        error: event.error || undefined,
      },
      success: !event.error,
      errorMessage: event.error || undefined,
      durationMs: event.durationMs,
    });
  });

  // ─── Hook: llm_output ───────────────────────────────
  api.on('llm_output', async (
    event: {
      runId: string;
      sessionId: string;
      provider: string;
      model: string;
      assistantTexts: string[];
      usage?: {
        input?: number;
        output?: number;
        cacheRead?: number;
        cacheWrite?: number;
        total?: number;
      };
    },
    ctx: { agentId?: string; sessionKey?: string }
  ) => {
    const userId = extractUserId(ctx.agentId);
    await audit({
      userId,
      action: Actions.LLM_RESPONSE,
      resource: `model:${event.model}`,
      details: {
        provider: event.provider,
        model: event.model,
        usage: event.usage || {},
        responseLength: event.assistantTexts.reduce((sum, t) => sum + t.length, 0),
      },
      success: true,
    });
  });

  // ─── Hook: session_start ─────────────────────────────
  api.on('session_start', async (
    event: { sessionId: string; resumedFrom?: string },
    ctx: { agentId?: string; sessionId: string }
  ) => {
    const userId = extractUserId(ctx.agentId);
    await audit({
      userId,
      action: Actions.SESSION_CREATE,
      resource: `session:${event.sessionId}`,
      details: {
        sessionId: event.sessionId,
        resumed: !!event.resumedFrom,
        resumedFrom: event.resumedFrom || undefined,
      },
      success: true,
    });
  });

  // ─── Hook: session_end ───────────────────────────────
  api.on('session_end', async (
    event: { sessionId: string; messageCount: number; durationMs?: number },
    ctx: { agentId?: string; sessionId: string }
  ) => {
    const userId = extractUserId(ctx.agentId);
    await audit({
      userId,
      action: Actions.SESSION_END,
      resource: `session:${event.sessionId}`,
      details: {
        sessionId: event.sessionId,
        messageCount: event.messageCount,
      },
      success: true,
      durationMs: event.durationMs,
    });
  });

  // ─── Hook: agent_end ─────────────────────────────────
  api.on('agent_end', async (
    event: {
      messages: unknown[];
      success: boolean;
      error?: string;
      durationMs?: number;
    },
    ctx: { agentId?: string; sessionKey?: string }
  ) => {
    const userId = extractUserId(ctx.agentId);
    await audit({
      userId,
      action: Actions.AGENT_END,
      resource: ctx.agentId ? `agent:${ctx.agentId}` : undefined,
      details: {
        messageCount: event.messages?.length || 0,
      },
      success: event.success,
      errorMessage: event.error || undefined,
      durationMs: event.durationMs,
    });
  });

  // ─── 清理：gateway 停止时断开 DB ────────────────────
  api.on('gateway_stop', async () => {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
    fileWriter.close();
    if (prisma) {
      await prisma.$disconnect();
      api.logger.info('database disconnected');
    }
  });

  api.logger.info(`audit plugin registered (db=${!!databaseUrl}, file=${logDir})`);
}
