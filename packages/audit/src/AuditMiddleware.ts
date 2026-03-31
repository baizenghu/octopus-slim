/**
 * 审计中间件
 *
 * Express 中间件工厂，自动为 HTTP 请求记录审计日志。
 * 提取 userId、ipAddress、userAgent，计算 durationMs。
 */

import type { Response, NextFunction } from 'express';
import type { AuditLogger } from './AuditLogger';
import { AuditAction } from './types';
import type { AuditLogEntry } from './types';

/** 扩展 Request 类型（与 gateway 的 AuthenticatedRequest 兼容） */
interface AuditableRequest {
  user?: { id: string; username: string };
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  originalUrl: string;
  path: string;
  body?: any;
}

/**
 * 路由到审计操作的映射规则
 */
const ROUTE_ACTION_MAP: Array<{
  method: string;
  pattern: RegExp;
  action: AuditAction;
  getResource?: (req: AuditableRequest) => string;
}> = [
  {
    method: 'POST',
    pattern: /^\/api\/auth\/login/,
    action: AuditAction.AUTH_LOGIN,
    getResource: (req) => `user:${req.body?.username || 'unknown'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/logout/,
    action: AuditAction.AUTH_LOGOUT,
  },
  {
    method: 'POST',
    pattern: /^\/api\/auth\/refresh/,
    action: AuditAction.AUTH_TOKEN_REFRESH,
  },
  {
    method: 'POST',
    pattern: /^\/api\/chat\/?$/,
    action: AuditAction.SESSION_MESSAGE,
    getResource: (req) => `session:${req.body?.sessionId || 'default'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/chat\/stream/,
    action: AuditAction.SESSION_MESSAGE,
    getResource: (req) => `session:${req.body?.sessionId || 'default'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/chat\/history\//,
    action: AuditAction.SESSION_DELETE,
    getResource: (req) => `session:${req.path.split('/').pop() || 'unknown'}`,
  },

  // ─── Auth 补全 ───
  {
    method: 'PUT',
    pattern: /^\/api\/auth\/password/,
    action: AuditAction.AUTH_PASSWORD_CHANGE,
  },

  // ─── Admin 用户管理 ───
  {
    method: 'POST',
    pattern: /^\/api\/admin\/users\/[^/]+\/unlock/,
    action: AuditAction.ADMIN_USER_UNLOCK,
    getResource: (req) => `user:${req.path.split('/')[4] || 'unknown'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/admin\/users\/?$/,
    action: AuditAction.ADMIN_USER_CREATE,
    getResource: (req) => `user:${req.body?.username || 'unknown'}`,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/admin\/users\//,
    action: AuditAction.ADMIN_USER_UPDATE,
    getResource: (req) => `user:${req.path.split('/').pop() || 'unknown'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/admin\/users\//,
    action: AuditAction.ADMIN_USER_DELETE,
    getResource: (req) => `user:${req.path.split('/').pop() || 'unknown'}`,
  },

  // ─── Agent 管理 ───
  {
    method: 'POST',
    pattern: /^\/api\/agents\/[^/]+\/default/,
    action: AuditAction.AGENT_SET_DEFAULT,
    getResource: (req) => `agent:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/agents\/[^/]+\/config/,
    action: AuditAction.AGENT_CONFIG_UPDATE,
    getResource: (req) => `agent:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/agents\/?$/,
    action: AuditAction.AGENT_CREATE,
    getResource: (req) => `agent:${req.body?.name || 'unknown'}`,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/agents\/[^/]+\/?$/,
    action: AuditAction.AGENT_UPDATE,
    getResource: (req) => `agent:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/agents\//,
    action: AuditAction.AGENT_DELETE,
    getResource: (req) => `agent:${req.path.split('/')[3] || 'unknown'}`,
  },

  // ─── MCP/ToolSource 个人（具体 pattern 排前面） ───
  {
    method: 'POST',
    pattern: /^\/api\/tool-sources\/personal\/upload/,
    action: AuditAction.MCP_PERSONAL_UPLOAD,
  },
  {
    method: 'POST',
    pattern: /^\/api\/tool-sources\/personal\/?$/,
    action: AuditAction.MCP_PERSONAL_CREATE,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/tool-sources\/personal\//,
    action: AuditAction.MCP_PERSONAL_UPDATE,
    getResource: (req) => `mcp:personal:${req.path.split('/').pop() || 'unknown'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/tool-sources\/personal\//,
    action: AuditAction.MCP_PERSONAL_DELETE,
    getResource: (req) => `mcp:personal:${req.path.split('/').pop() || 'unknown'}`,
  },

  // ─── MCP/ToolSource 企业级 ───
  {
    method: 'POST',
    pattern: /^\/api\/tool-sources\/[^/]+\/test/,
    action: AuditAction.MCP_SERVER_TEST,
    getResource: (req) => `mcp:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/tool-sources\/?$/,
    action: AuditAction.MCP_SERVER_CREATE,
    getResource: (req) => `mcp:${req.body?.name || 'unknown'}`,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/tool-sources\/[^/]+\/?$/,
    action: AuditAction.MCP_SERVER_UPDATE,
    getResource: (req) => `mcp:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/tool-sources\/[^/]+\/?$/,
    action: AuditAction.MCP_SERVER_DELETE,
    getResource: (req) => `mcp:${req.path.split('/')[3] || 'unknown'}`,
  },

  // ─── Skill 个人（具体 pattern 排前面） ───
  {
    method: 'POST',
    pattern: /^\/api\/skills\/personal\/upload/,
    action: AuditAction.SKILL_PERSONAL_UPLOAD,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/skills\/personal\//,
    action: AuditAction.SKILL_PERSONAL_DELETE,
    getResource: (req) => `skill:personal:${req.path.split('/').pop() || 'unknown'}`,
  },

  // ─── Skill 企业级 ───
  {
    method: 'POST',
    pattern: /^\/api\/skills\/[^/]+\/approve/,
    action: AuditAction.SKILL_APPROVE,
    getResource: (req) => `skill:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/skills\/[^/]+\/reject/,
    action: AuditAction.SKILL_REJECT,
    getResource: (req) => `skill:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/skills\/[^/]+\/enable/,
    action: AuditAction.SKILL_ENABLE,
    getResource: (req) => `skill:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/skills\/upload/,
    action: AuditAction.SKILL_UPLOAD,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/skills\/[^/]+\/?$/,
    action: AuditAction.SKILL_UPDATE,
    getResource: (req) => `skill:${req.path.split('/')[3] || 'unknown'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/skills\/[^/]+\/?$/,
    action: AuditAction.SKILL_DELETE,
    getResource: (req) => `skill:${req.path.split('/')[3] || 'unknown'}`,
  },

  // ─── 文件操作 ───
  {
    method: 'POST',
    pattern: /^\/api\/files\/upload/,
    action: AuditAction.FILE_UPLOAD,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/files\//,
    action: AuditAction.FILE_DELETE,
    getResource: (req) => `file:${req.path.replace('/api/files/', '')}`,
  },

  // ─── 定时任务 ───
  {
    method: 'POST',
    pattern: /^\/api\/scheduler\/tasks\/[^/]+\/run/,
    action: AuditAction.SCHEDULER_TASK_EXECUTE,
    getResource: (req) => `scheduler:${req.path.split('/')[4] || 'unknown'}`,
  },
  {
    method: 'POST',
    pattern: /^\/api\/scheduler\/tasks\/?$/,
    action: AuditAction.SCHEDULER_TASK_CREATE,
    getResource: (req) => `scheduler:${req.body?.name || 'unknown'}`,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/scheduler\/tasks\//,
    action: AuditAction.SCHEDULER_TASK_UPDATE,
    getResource: (req) => `scheduler:${req.path.split('/').pop() || 'unknown'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/scheduler\/tasks\//,
    action: AuditAction.SCHEDULER_TASK_DELETE,
    getResource: (req) => `scheduler:${req.path.split('/').pop() || 'unknown'}`,
  },

  // ─── 配额 ───
  {
    method: 'PUT',
    pattern: /^\/api\/quotas\//,
    action: AuditAction.QUOTA_UPDATE,
    getResource: (req) => `quota:${req.path.split('/').pop() || 'unknown'}`,
  },

  // ─── 数据库连接 ───
  {
    method: 'POST',
    pattern: /^\/api\/user\/db-connections\/?$/,
    action: AuditAction.DB_CONNECTION_CREATE,
    getResource: (req) => `db:${req.body?.name || 'unknown'}`,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/user\/db-connections\//,
    action: AuditAction.DB_CONNECTION_UPDATE,
    getResource: (req) => `db:${req.path.split('/').pop() || 'unknown'}`,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/user\/db-connections\//,
    action: AuditAction.DB_CONNECTION_DELETE,
    getResource: (req) => `db:${req.path.split('/').pop() || 'unknown'}`,
  },

  // ─── 审计自身操作 ───
  {
    method: 'GET',
    pattern: /^\/api\/audit\/export/,
    action: AuditAction.AUDIT_EXPORT,
  },
  {
    method: 'POST',
    pattern: /^\/api\/audit\/archive/,
    action: AuditAction.AUDIT_ARCHIVE,
  },
  {
    method: 'GET',
    pattern: /^\/api\/audit\/logs/,
    action: AuditAction.AUDIT_QUERY,
  },
];

/**
 * 根据请求匹配审计操作
 */
function resolveAction(req: AuditableRequest): {
  action: AuditAction;
  resource: string;
} | null {
  for (const rule of ROUTE_ACTION_MAP) {
    if (req.method === rule.method && rule.pattern.test(req.originalUrl)) {
      const resource = rule.getResource ? rule.getResource(req) : req.originalUrl;
      return { action: rule.action, resource };
    }
  }
  return null;
}

/**
 * 创建审计中间件
 *
 * 用法：app.use(createAuditMiddleware(auditLogger));
 */
export function createAuditMiddleware(auditLogger: AuditLogger) {
  return (req: AuditableRequest, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const resolved = resolveAction(req);

    // 如果不匹配任何审计规则，直接放行
    if (!resolved) {
      next();
      return;
    }

    // 在响应完成后记录审计日志
    res.on('finish', () => {
      const durationMs = Date.now() - startTime;
      const success = res.statusCode < 400;

      const entry: AuditLogEntry = {
        userId: req.user?.id || null,
        username: req.user?.username || 'anonymous',
        action: resolved.action,
        resource: resolved.resource,
        details: {
          method: req.method,
          url: req.originalUrl,
          statusCode: res.statusCode,
        },
        ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
          || req.ip
          || 'unknown',
        userAgent: req.headers['user-agent'] as string || undefined,
        success,
        errorMessage: success ? undefined : `HTTP ${res.statusCode}`,
        durationMs,
      };

      // 登录失败特殊处理
      if (resolved.action === AuditAction.AUTH_LOGIN && !success) {
        entry.action = AuditAction.AUTH_LOGIN_FAILED;
      }

      // 异步写入，不阻塞响应
      auditLogger.log(entry).catch((err) => {
        console.error('[AuditMiddleware] Failed to write audit log:', err);
      });
    });

    next();
  };
}
