/**
 * 认证路由
 *
 * POST /api/auth/register - 用户自助注册
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
            // 不透露账户不存在，防止用户枚举（等保要求）
            const ip = req.ip || req.socket.remoteAddress || 'unknown';
            securityMonitor.recordLoginFailure(ip, username);
            logger.warn('[auth] login rejected: user not in DB', { username });
            res.status(401).json({ error: '用户名或密码错误' });
            return;
          }
        } catch (dbErr: unknown) {
          // DB 故障（网络抖动、MySQL 宕机），无法安全继续，返回 503
          logger.error('[auth] DB sync failed during login, refusing to continue', {
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
            username,
          });
          res.status(503).json({ error: '服务暂时不可用，请稍后重试' });
          return;
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
      logger.warn('[auth] login failed', { username, reason: err instanceof Error ? err.message : String(err), ip });
      res.status(401).json({ error: '用户名或密码错误' });
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
          logger.warn('[auth] refresh rejected: user disabled or not found', { userId: typedResult.user.id });
          res.status(401).json({ error: '用户名或密码错误' });
          return;
        }
      }
      res.json(result);
    } catch (err: unknown) {
      res.status(401).json({ error: 'Token 无效或已过期，请重新登录' });
    }
  });

  /**
   * 用户自助注册（无需 Admin 预创建）
   */
  router.post('/register', async (req, res, next) => {
    if (!prisma) {
      res.status(503).json({ error: '数据库未就绪' });
      return;
    }
    try {
      const { username, password, displayName } = req.body;

      if (!username || !password) {
        res.status(400).json({ error: '用户名和密码不能为空' });
        return;
      }
      if (/_/.test(username)) {
        res.status(400).json({ error: '用户名不能包含下划线，请使用连字符（-）' });
        return;
      }
      if (!/^[a-zA-Z0-9\-]{2,32}$/.test(username)) {
        res.status(400).json({ error: '用户名只能包含字母、数字、连字符，长度 2-32 位' });
        return;
      }

      const pwError = validatePassword(password);
      if (pwError) {
        res.status(400).json({ error: pwError });
        return;
      }

      const existing = await prisma.user.findFirst({ where: { username } });
      if (existing) {
        res.status(409).json({ error: '该用户名已被注册' });
        return;
      }

      const bcryptModule = await import('bcryptjs');
      const bcrypt = (bcryptModule as { default?: typeof bcryptModule }).default || bcryptModule;
      const hashedPassword = await bcrypt.hash(password, 12);

      const user = await prisma.user.create({
        data: {
          userId: `user-${username}`,
          username,
          email: `${username}@no-email.local`,
          displayName: displayName?.trim() || username,
          department: '',
          roles: ['USER'],
          quotas: {},
          status: 'active',
          passwordHash: hashedPassword,
        },
      });

      // 同步到 MockLDAP
      try {
        authService.registerMockUser(
          { username, email: user.email, displayName: user.displayName, department: '' },
          hashedPassword,
        );
      } catch (e: unknown) {
        logger.warn('[auth] MockLDAP registration failed during self-register', {
          username,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      logger.info('[auth] self-registration success', { username });
      const { passwordHash: _ph, ...safeUser } = user;
      res.status(201).json({ message: '注册成功，请登录', user: safeUser });
    } catch (err: unknown) {
      const prismaError = err as { code?: string };
      if (prismaError.code === 'P2002') {
        res.status(409).json({ error: '该用户名已被注册' });
        return;
      }
      next(err instanceof Error ? err : new Error(String(err)));
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
        securityMonitor.recordLoginFailure(req.ip || 'unknown', user.username!);
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

      // 将当前 Token 加入黑名单（等保合规：密码变更后会话失效）
      const currentToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (currentToken) {
        try {
          await authService.logout(currentToken);
        } catch (e: unknown) {
          // 黑名单失败不阻断响应，但记录告警
          logger.warn('[auth] Failed to blacklist token after password change', {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }

      res.json({ message: '密码已修改，请重新登录' });
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
   * 获取用户头像
   */
  router.get('/avatar/:userId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
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
