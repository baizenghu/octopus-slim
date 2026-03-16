/**
 * 认证路由
 * 
 * POST /api/auth/login    - 登录
 * POST /api/auth/refresh  - 刷新 Token
 * POST /api/auth/logout   - 登出
 * GET  /api/auth/me        - 获取当前用户信息
 */

import { Router } from 'express';
import type { AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { securityMonitor } from '../services/SecurityMonitor';
import { validatePassword } from '../utils/password';

export function createAuthRouter(authService: AuthService, workspaceManager: WorkspaceManager, prisma?: any): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);

  /**
   * 登录
   */
  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: 'username and password are required' });
        return;
      }

      const result = await authService.login(username, password);

      // 确保用户存在于数据库中（审计日志外键依赖）
      if (prisma) {
        try {
          // 先按 username 查找（避免 userId 不匹配导致 unique constraint 冲突）
          const existing = await prisma.user.findUnique({ where: { username: result.user.username } });
          if (existing) {
            await prisma.user.update({
              where: { userId: existing.userId },
              data: {
                lastLoginAt: new Date(),
                displayName: result.user.username,
                department: result.user.department || '',
              },
            });
            // 使用数据库中的 userId，确保与审计日志 FK 一致
            // 若 LDAP 返回的 id 与 DB 中不一致（如首次通过 Admin 创建），重新签发 JWT
            if (result.user.id !== existing.userId) {
              result.user.id = existing.userId;
              const tm = authService.getTokenManager();
              result.accessToken = tm.generateAccessToken(result.user);
              result.refreshToken = tm.generateRefreshToken(result.user);
            }
          } else {
            // 用户不在数据库中，拒绝登录（必须由 Admin 先在系统中创建账号）
            res.status(401).json({ error: 'User account not found. Please contact administrator.' });
            return;
          }
        } catch (dbErr: any) {
          console.warn('[auth] User sync warning:', dbErr.message);
        }
      }

      // 确保工作空间已初始化
      await workspaceManager.initWorkspace(result.user.id, result.user.username, {
        department: result.user.department,
        roles: result.user.roles as string[],
      });

      res.json({
        user: {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email,
          department: result.user.department,
          roles: result.user.roles,
        },
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
      });
    } catch (err: any) {
      // 记录登录失败事件到安全监控（暴力破解检测）
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { username } = req.body;
      if (username) {
        securityMonitor.recordLoginFailure(ip, username);
      }
      res.status(401).json({ error: err.message || 'Login failed' });
    }
  });

  /**
   * 刷新 Token
   */
  router.post('/refresh', async (req, res) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        res.status(400).json({ error: 'refreshToken is required' });
        return;
      }

      const result = await authService.refreshToken(refreshToken);
      res.json(result);
    } catch (err: any) {
      res.status(401).json({ error: err.message || 'Token refresh failed' });
    }
  });

  /**
   * 登出
   */
  router.post('/logout', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const token = req.headers.authorization?.substring(7);
      if (token) {
        await authService.logout(token);
      }
      res.json({ message: 'Logged out' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Logout failed' });
    }
  });

  /**
   * 修改密码（当前用户）
   */
  router.put('/password', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const { oldPassword, newPassword } = req.body;

      if (!oldPassword || !newPassword) {
        res.status(400).json({ error: '请提供当前密码和新密码' });
        return;
      }

      const pwError = validatePassword(newPassword);
      if (pwError) {
        res.status(400).json({ error: pwError });
        return;
      }

      // 验证旧密码
      try {
        await authService.login(user.username!, oldPassword);
      } catch {
        res.status(401).json({ error: '当前密码不正确' });
        return;
      }

      // bcrypt 哈希新密码
      const bcryptModule = await import('bcryptjs');
      const bcrypt = (bcryptModule as any).default || bcryptModule;
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      // 更新数据库
      if (prisma) {
        await prisma.user.update({
          where: { userId: user.id },
          data: { passwordHash: hashedPassword },
        });
      }

      // 同步到 MockLDAP
      authService.registerMockUser(
        {
          username: user.username!,
          email: user.email || '',
          displayName: user.username!,
          department: user.department || '',
        },
        hashedPassword,
      );

      res.json({ message: '密码修改成功' });
    } catch (err: any) {
      res.status(500).json({ error: err.message || '密码修改失败' });
    }
  });

  /**
   * 获取当前用户信息
   */
  router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      department: user.department,
      roles: user.roles,
      status: user.status,
    });
  });

  return router;
}
