/**
 * 认证路由
 * 
 * POST /api/auth/login    - 登录
 * POST /api/auth/refresh  - 刷新 Token
 * POST /api/auth/logout   - 登出
 * GET  /api/auth/me        - 获取当前用户信息
 */

import { Router } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import type { AppPrismaClient } from '../types/prisma';
import { securityMonitor } from '../services/SecurityMonitor';
import { validatePassword } from '../utils/password';
import { createAvatarUpload, mimeToExt } from '../utils/avatar';
import { createLogger } from '../utils/logger';

const logger = createLogger('auth');

export function createAuthRouter(authService: AuthService, workspaceManager: WorkspaceManager, prisma?: AppPrismaClient, dataRoot?: string): Router {
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
        } catch (dbErr: unknown) {
          logger.warn('User sync warning', { error: dbErr instanceof Error ? dbErr.message : String(dbErr) });
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
    } catch (err: unknown) {
      // 记录登录失败事件到安全监控（暴力破解检测）
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const { username } = req.body;
      if (username) {
        securityMonitor.recordLoginFailure(ip, username);
      }
      res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' });
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
      // DB fallback：验证用户是否仍然有效（防止已禁用用户用旧 refresh token 获取新 access token）
      const typedResult = result as { user?: { id?: string } };
      if (prisma && typedResult.user?.id) {
        const dbUser = await prisma.user.findUnique({ where: { userId: typedResult.user.id } });
        if (!dbUser || dbUser.status !== 'active') {
          res.status(401).json({ error: 'User disabled' });
          return;
        }
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Token refresh failed' });
    }
  });

  /**
   * 登出
   */
  router.post('/logout', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const token = req.headers.authorization?.substring(7);
      if (token) {
        await authService.logout(token);
      }
      res.json({ message: 'Logged out' });
    } catch (err: unknown) {
      next(err);
    }
  });

  /**
   * 修改密码（当前用户）
   */
  router.put('/password', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
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
      const bcrypt = (bcryptModule as { default?: typeof bcryptModule }).default || bcryptModule;
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
    } catch (err: unknown) {
      next(err);
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

  // ─── 用户头像 ───

  /**
   * 上传用户头像
   */
  router.post('/avatar', authMiddleware, (req, res, next) => {
    createAvatarUpload().single('avatar')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
      (async () => {
        try {
          const authReq = req as AuthenticatedRequest;
          const user = authReq.user!;
          const file = (req as { file?: Express.Multer.File }).file;
          if (!file) {
            res.status(400).json({ error: '请选择头像文件' });
            return;
          }

          const ext = mimeToExt(file.mimetype);
          const avatarDir = path.join(dataRoot || './data', 'avatars', 'users', user.id);
          await fs.promises.mkdir(avatarDir, { recursive: true });

          // 删除旧头像（可能是不同扩展名）
          try {
            const files = await fs.promises.readdir(avatarDir);
            for (const f of files) {
              if (f.startsWith('avatar.')) {
                await fs.promises.unlink(path.join(avatarDir, f));
              }
            }
          } catch { /* ignore */ }

          const avatarPath = path.join(avatarDir, `avatar.${ext}`);
          await fs.promises.writeFile(avatarPath, file.buffer);

          // 更新 DB
          if (prisma) {
            await prisma.user.update({
              where: { userId: user.id },
              data: { avatarPath: `avatars/users/${user.id}/avatar.${ext}` },
            });
          }

          res.json({ ok: true, avatarUrl: `/api/auth/avatar/${user.id}` });
        } catch (err: unknown) {
          next(err);
        }
      })();
    });
  });

  /**
   * 获取用户头像（无需 JWT，用于 img src 直接引用）
   */
  router.get('/avatar/:userId', async (req, res, next) => {
    try {
      const { userId } = req.params;

      // 路径穿越防护：仅允许安全字符
      if (!/^[\w-]+$/.test(userId)) {
        res.status(400).json({ error: 'Invalid user ID' });
        return;
      }

      if (prisma) {
        const dbUser = await prisma.user.findUnique({
          where: { userId },
          select: { avatarPath: true },
        });
        if (dbUser?.avatarPath) {
          const fullPath = path.join(dataRoot || './data', dbUser.avatarPath);
          try {
            await fs.promises.access(fullPath);
            // 设置缓存头（1小时）
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.sendFile(path.resolve(fullPath));
            return;
          } catch { /* file not found */ }
        }
      }

      res.status(404).json({ error: '头像不存在' });
    } catch (err: unknown) {
      next(err);
    }
  });

  return router;
}
