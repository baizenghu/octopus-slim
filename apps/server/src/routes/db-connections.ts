/**
 * 数据库连接管理 API
 *
 * GET    /api/user/db-connections       - 列表（密码脱敏）
 * POST   /api/user/db-connections       - 创建
 * PUT    /api/user/db-connections/:id   - 更新
 * DELETE /api/user/db-connections/:id   - 删除
 */

import { Router, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import type { AppPrismaClient } from '../types/prisma';
import { encryptPassword } from '../utils/crypto';
import { validateMcpUrl } from '../utils/url-validator';

export function createDbConnectionsRouter(authService: AuthService, prisma: AppPrismaClient): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);

  // GET /api/user/db-connections — 列表（返回时隐藏密码）
  router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const connections = await prisma.databaseConnection.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      // 密码脱敏
      const safe = connections.map((c) => ({ ...c, dbPassword: '••••••' }));
      res.json({ data: safe });
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  // POST /api/user/db-connections — 创建
  router.post('/', authMiddleware, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { name, dbType, host, port, dbUser, dbPassword, dbName } = req.body;
      if (!name || !dbType || !host || !port || !dbUser || !dbPassword || !dbName) {
        res.status(400).json({ error: '所有字段必填' });
        return;
      }
      // port 范围校验
      const portNum = Number(port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        res.status(400).json({ error: 'port 必须为 1-65535 的整数' });
        return;
      }

      // 校验 host 不是内网地址
      const hostCheck = validateMcpUrl(`http://${host}:${port}`);
      if (!hostCheck.valid) {
        res.status(400).json({ error: `数据库主机地址不安全: ${hostCheck.error}` });
        return;
      }

      // 检查同名
      const existing = await prisma.databaseConnection.findUnique({
        where: { userId_name: { userId, name } },
      });
      if (existing) {
        res.status(400).json({ error: `连接名称 "${name}" 已存在` });
        return;
      }
      const conn = await prisma.databaseConnection.create({
        data: { id: randomUUID(), userId, name, dbType, host, port: Number(port), dbUser, dbPassword: encryptPassword(dbPassword), dbName },
      });

      res.json({ data: { ...conn, dbPassword: '••••••' } });
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  // PUT /api/user/db-connections/:id — 更新
  router.put('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const existing = await prisma.databaseConnection.findFirst({ where: { id, userId } });
      if (!existing) {
        res.status(404).json({ error: '连接不存在' });
        return;
      }
      const { name, dbType, host, port, dbUser, dbPassword, dbName, enabled } = req.body;
      // Prisma 动态更新参数：字段来自用户输入，无法静态推导
      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (dbType !== undefined) updateData.dbType = dbType;
      if (host !== undefined) {
        // SSRF 校验：禁止更新为内网地址
        const hostCheck = validateMcpUrl(`http://${host}:${port || existing.port}`);
        if (!hostCheck.valid) {
          res.status(400).json({ error: `数据库主机地址不安全: ${hostCheck.error}` });
          return;
        }
        updateData.host = host;
      }
      if (port !== undefined) {
        const portNum = Number(port);
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          res.status(400).json({ error: 'port 必须为 1-65535 的整数' });
          return;
        }
        updateData.port = portNum;
      }
      if (dbUser !== undefined) updateData.dbUser = dbUser;
      if (dbPassword !== undefined && dbPassword !== '••••••') updateData.dbPassword = encryptPassword(dbPassword);
      if (dbName !== undefined) updateData.dbName = dbName;
      if (enabled !== undefined) updateData.enabled = enabled;
      const conn = await prisma.databaseConnection.update({ where: { id }, data: updateData });

      res.json({ data: { ...conn, dbPassword: '••••••' } });
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  // DELETE /api/user/db-connections/:id — 删除
  router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const existing = await prisma.databaseConnection.findFirst({ where: { id, userId } });
      if (!existing) {
        res.status(404).json({ error: '连接不存在' });
        return;
      }

      // 引用完整性检查：检查是否有 agent 关联了此数据库连接
      const userAgents = await prisma.agent.findMany({
        where: { ownerId: userId },
        select: { name: true, allowedConnections: true },
      });
      const referencingAgents = userAgents.filter((a) => {
        const conns = a.allowedConnections as string[] | null;
        return Array.isArray(conns) && (conns.includes(id) || conns.includes(existing.name));
      });
      if (referencingAgents.length > 0) {
        const names = referencingAgents.map((a) => a.name).join(', ');
        res.status(409).json({ error: `无法删除：以下 Agent 仍在使用此数据库连接：${names}。请先取消关联后再删除。` });
        return;
      }

      await prisma.databaseConnection.delete({ where: { id } });

      res.json({ ok: true });
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return router;
}
