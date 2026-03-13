/**
 * 配额管理路由
 *
 * GET  /api/quotas/:userId  — 查看用户配额使用情况
 * PUT  /api/quotas/:userId  — 设置用户配额限额（需 admin 角色）
 */

import { Router } from 'express';
import type { AuthService } from '@octopus/auth';
import type { QuotaManager, QuotaType } from '@octopus/quota';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';

const VALID_QUOTA_TYPES: QuotaType[] = ['token_daily', 'token_monthly', 'request_hourly'];

export function createQuotasRouter(
  authService: AuthService,
  prisma: any,
  quotaManager: QuotaManager,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);

  /** 管理员权限检查 */
  const adminOnly = (req: AuthenticatedRequest, res: any, next: any) => {
    const roles = req.user?.roles as string[] | undefined;
    if (!roles?.some((r: string) => r.toLowerCase() === 'admin')) {
      res.status(403).json({ error: '需要管理员权限' });
      return;
    }
    next();
  };

  /**
   * 获取用户配额使用情况
   * 普通用户只能查看自己的，admin 可查看任意用户
   */
  router.get('/:userId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { userId } = req.params;
      const currentUser = req.user!;
      const isAdmin = (currentUser.roles as string[])?.some((r: string) => r.toLowerCase() === 'admin');

      // 非 admin 只能查看自己的配额
      if (!isAdmin && currentUser.id !== userId) {
        res.status(403).json({ error: '无权查看其他用户配额' });
        return;
      }

      const usage = await quotaManager.getUsage(userId);
      res.json({ userId, ...usage });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 设置用户配额限额（admin only）
   * Body: { type: QuotaType, limit: number }
   */
  router.put('/:userId', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { userId } = req.params;
      const { type, limit } = req.body;

      if (!type || !VALID_QUOTA_TYPES.includes(type as QuotaType)) {
        res.status(400).json({ error: `type 必须为 ${VALID_QUOTA_TYPES.join(' | ')}` });
        return;
      }
      if (typeof limit !== 'number' || (limit < -1)) {
        res.status(400).json({ error: 'limit 必须为 >= -1 的数字（-1 表示无限制）' });
        return;
      }

      await quotaManager.setLimit(userId, type as QuotaType, limit);
      res.json({ message: '配额限额已更新', userId, type, limit });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
