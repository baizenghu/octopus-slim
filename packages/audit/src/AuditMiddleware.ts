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
