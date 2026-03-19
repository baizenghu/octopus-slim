/**
 * Express 认证中间件
 * 
 * 从 Authorization header 提取 JWT Token 并验证
 */

import type { Request, Response, NextFunction } from 'express';
import type { AuthService, User, Role } from '@octopus/auth';
import { getRuntimeConfig } from '../config';

/** 扩展 Express Request 类型，附加 user 信息 */
export interface AuthenticatedRequest extends Request {
  user?: User;
}

/** 检查用户是否具有管理员角色 */
export function isAdmin(user?: { roles?: unknown }): boolean {
  const roles = user?.roles;
  if (!Array.isArray(roles)) return false;
  return roles.some((r: unknown) => typeof r === 'string' && r.toLowerCase() === 'admin');
}

/** 管理员权限中间件，需配合 authMiddleware 使用 */
export function adminOnly(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: '需要管理员权限' });
    return;
  }
  next();
}

/**
 * 创建认证中间件
 *
 * @param authService JWT 验证服务
 * @param prisma      可选 Prisma 客户端。若传入，将在 token 验证后自动从 DB 校正 userId。
 *                    解决「JWT 含旧 userId（如 user-baizh）而 DB 已变更为时间戳 ID」的问题。
 *                    用 username → userId 缓存避免对每次请求做重复查询。
 */
export function createAuthMiddleware(authService: AuthService, prisma?: { user: { findUnique: (args: any) => Promise<{ userId: string; roles: any } | null> } }) {
  // username → { userId, roles } 的 TTL 缓存（5 分钟过期，上限 1000 条）
  interface CacheEntry {
    userId: string;
    roles: Role[];
    expires: number;
  }
  const userIdCache = new Map<string, CacheEntry>();
  const CACHE_TTL = getRuntimeConfig().security.authCacheTTLMs;
  const CACHE_MAX_SIZE = getRuntimeConfig().security.authCacheMaxSize;

  function cacheGet(key: string): CacheEntry | undefined {
    const entry = userIdCache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      userIdCache.delete(key);
      return undefined;
    }
    return entry;
  }

  function cacheSet(key: string, userId: string, roles: Role[]): void {
    // LRU: 超过上限时删除最旧条目
    if (userIdCache.size >= CACHE_MAX_SIZE) {
      const firstKey = userIdCache.keys().next().value;
      if (firstKey) userIdCache.delete(firstKey);
    }
    userIdCache.set(key, { userId, roles, expires: Date.now() + CACHE_TTL });
  }

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
      }

      const token = authHeader.substring(7);
      const user = await authService.verifyToken(token);

      // 从 DB 校正 userId + roles，并强制验证用户仍存在（防止已删除用户凭旧 JWT 访问）
      if (prisma) {
        let cached = cacheGet(user.username);
        if (!cached) {
          const dbUser = await prisma.user.findUnique({ where: { username: user.username } });
          if (!dbUser) {
            // 用户已从数据库删除，拒绝访问
            res.status(401).json({ error: 'User account not found or has been deleted' });
            return;
          }
          const dbRoles = (typeof dbUser.roles === 'string' ? JSON.parse(dbUser.roles) : (Array.isArray(dbUser.roles) ? dbUser.roles : [])) as Role[];
          cacheSet(user.username, dbUser.userId, dbRoles);
          cached = cacheGet(user.username)!;
        }
        if (cached.userId !== user.id) {
          user.id = cached.userId;
        }
        // 用 DB 中的最新 roles 覆盖 JWT 中可能过期的角色
        user.roles = cached.roles;
      }

      req.user = user;
      next();
    } catch (err: any) {
      res.status(401).json({ error: err.message || 'Authentication failed' });
    }
  };
}
