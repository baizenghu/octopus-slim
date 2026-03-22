/**
 * 微信绑定 API 路由
 *
 * POST   /api/user/weixin/login        — 发起扫码，返回 QR 码 URL
 * GET    /api/user/weixin/login/status  — 轮询扫码结果
 * GET    /api/user/weixin/status        — 查看微信绑定状态
 * DELETE /api/user/weixin/unbind        — 解除微信绑定
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { startWeixinLogin, checkWeixinLoginStatus } from '../services/im/weixin/login';
import { loadWeixinAccount } from '../services/im/weixin/account';
import type { WeixinManager } from '../services/im/weixin/manager';
import type { AppPrismaClient } from '../types/prisma';

export function createWeixinRoutes(params: {
  authService: AuthService;
  prisma: AppPrismaClient;
  weixinManager: WeixinManager;
}): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(params.authService, params.prisma);
  const { weixinManager } = params;

  // 发起扫码登录
  router.post('/login', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const sessionKey = `weixin-login-${userId}-${randomUUID().slice(0, 8)}`;
      const result = await startWeixinLogin(sessionKey);
      res.json({
        qrcodeUrl: result.qrcodeUrl,
        sessionKey: result.sessionKey,
      });
    } catch (e: any) {
      next(e);
    }
  });

  // 轮询扫码结果
  router.get('/login/status', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;
      const sessionKey = req.query.sessionKey as string;
      if (!sessionKey) {
        res.status(400).json({ error: '缺少 sessionKey 参数' });
        return;
      }

      const result = await checkWeixinLoginStatus(sessionKey);

      if (result.status === 'confirmed' && result.account) {
        // 扫码成功 → 保存 + 启动 adapter
        await weixinManager.bindUser(userId, result.account);
        res.json({ status: 'connected' });
      } else {
        res.json({ status: result.status });
      }
    } catch (e: any) {
      next(e);
    }
  });

  // 查看微信绑定状态
  router.get('/status', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const userId = req.user!.id;
    const account = loadWeixinAccount(userId);
    res.json({
      bound: !!account,
      connected: weixinManager.isUserConnected(userId),
      weixinUserId: account?.weixinUserId || null,
    });
  });

  // 解除微信绑定
  router.delete('/unbind', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = req.user!.id;
      await weixinManager.unbindUser(userId);
      res.json({ success: true });
    } catch (e: any) {
      next(e);
    }
  });

  return router;
}
