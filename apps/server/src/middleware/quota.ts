/**
 * Express 配额中间件
 *
 * 后消费模式（#15 修复）：
 * - 请求前只检查配额（不消费），被拒返回 429
 * - 响应成功后（statusCode < 500）才扣费
 * - 避免"请求失败也被扣费"的问题
 *
 * 覆盖路由（#17 修复）：
 * - /api/chat, /api/mcp, /api/skills, /api/files
 */

import type { Response, NextFunction } from 'express';
import type { QuotaManager } from '@octopus/quota';
import type { AuthenticatedRequest } from './auth';

/**
 * 创建配额检查中间件
 *
 * @param quotaManager 配额管理器实例
 */
export function createQuotaMiddleware(quotaManager: QuotaManager) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const userId = req.user?.id;
    if (!userId) {
      // 未认证请求由 auth 中间件处理，这里直接放行
      next();
      return;
    }

    try {
      // 仅检查配额，不消费（使用 request_hourly 类型）
      const result = await quotaManager.checkQuota(userId, 'request_hourly');
      if (!result.allowed) {
        res.status(429).json({
          error: '配额已用尽',
          remaining: result.remaining,
          resetAt: result.resetAt,
        });
        return;
      }

      // 后消费模式：响应完成后才扣费（#15 修复）
      res.on('finish', () => {
        if (res.statusCode < 500) {
          quotaManager.consumeQuota(userId, 'request_hourly', 1).catch(() => {
            // consumeQuota 内部已有降级告警，这里静默
          });
        }
      });

      next();
    } catch (err: any) {
      // 配额检查异常不阻塞请求（降级放行）
      console.warn('[quota middleware] check error, allowing request:', err.message);
      next();
    }
  };
}
