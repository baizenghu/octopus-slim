/**
 * 管理 API 路由（ADMIN 权限）
 *
 * GET    /api/admin/users        - 用户列表（分页 + 搜索）
 * POST   /api/admin/users        - 创建用户
 * PUT    /api/admin/users/:id    - 更新用户
 * DELETE /api/admin/users/:id    - 删除用户
 * GET    /api/admin/dashboard    - 仪表盘统计
 */

import { Router, NextFunction } from 'express';
import { execFileSync } from 'child_process';
import bcrypt from 'bcryptjs';
import type { AuthService } from '@octopus/auth';
import type { AuditLogger } from '@octopus/audit';
import type { WorkspaceManager } from '@octopus/workspace';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { EngineAdapter } from '../services/EngineAdapter';
import { validatePassword } from '../utils/password';

import type { AppPrismaClient } from '../types/prisma';

export function createAdminRouter(
  authService: AuthService,
  _auditLogger: AuditLogger,
  prisma: AppPrismaClient,
  workspaceManager?: WorkspaceManager,
  bridge?: EngineAdapter,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);

  // 获取 authService 引用用于 MockLDAP 注册

  /** ADMIN 权限检查 */
  const adminOnly = (req: AuthenticatedRequest, res: any, next: any) => {
    const user = req.user;
    if (!user || !(user.roles as string[])?.some(r => r.toLowerCase() === 'admin')) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  };

  // ─── 用户列表 ───────────────────────────────────

  router.get('/users', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string, 10) || 20));
      const search = (req.query.search as string) || '';
      const status = req.query.status as string;

      const where: any = {};
      if (search) {
        where.OR = [
          { username: { contains: search } },
          { email: { contains: search } },
          { displayName: { contains: search } },
          { department: { contains: search } },
        ];
      }
      if (status) {
        where.status = status;
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
          select: {
            userId: true,
            username: true,
            email: true,
            displayName: true,
            department: true,
            roles: true,
            status: true,
            lastLoginAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.user.count({ where }),
      ]);

      res.json({ data: users, total, page, pageSize });
    } catch (err: any) {
      next(err);
    }
  });

  // ─── 创建用户 ───────────────────────────────────

  router.post('/users', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const { username, email, displayName, department, roles, status, password } = req.body;
      if (!username || !email) {
        res.status(400).json({ error: 'username and email are required' });
        return;
      }

      // 用户名格式校验：禁止包含下划线（userId 格式为 user-{username}，下划线用于命名空间分隔）
      if (/_/.test(username)) {
        res.status(400).json({ error: 'username must not contain underscores (use hyphens instead)' });
        return;
      }

      // 检查用户名/邮箱重复
      const existing = await prisma.user.findFirst({
        where: { OR: [{ username }, { email }] },
      });
      if (existing) {
        res.status(409).json({ error: 'User with this username or email already exists' });
        return;
      }

      if (!password) {
        res.status(400).json({ error: '密码不能为空' });
        return;
      }
      const pwError = validatePassword(password);
      if (pwError) {
        res.status(400).json({ error: pwError });
        return;
      }
      // 密码哈希存储（bcrypt, cost=12）
      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await prisma.user.create({
        data: {
          userId: `user-${username}`,
          username,
          email,
          displayName: displayName || username,
          department: department || '',
          roles: roles || ['USER'],
          quotas: {},
          status: status || 'active',
          passwordHash: hashedPassword,
        },
      });

      // 排除 passwordHash，防止泄露到客户端
      const { passwordHash: _ph, ...safeUser } = user;
      res.status(201).json(safeUser);

      // 注册到 MockLDAP（传入 bcrypt 哈希，与启动同步和 PUT 更新保持一致）
      const registered = authService.registerMockUser(
        { username, email, displayName: displayName || username, department: department || '' },
        hashedPassword,
      );
      console.log(`[admin] User '${username}' created. MockLDAP registered: ${registered}`);
    } catch (err: any) {
      next(err);
    }
  });

  // ─── 更新用户 ───────────────────────────────────

  router.put('/users/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { email, displayName, department, roles, status, password } = req.body;

      // 如果有密码变更，先校验强度再 bcrypt 哈希化
      let passwordUpdate: { passwordHash: string } | undefined;
      if (password) {
        const pwError = validatePassword(password);
        if (pwError) {
          res.status(400).json({ error: pwError });
          return;
        }
        passwordUpdate = { passwordHash: await bcrypt.hash(password, 12) };
      }

      const user = await prisma.user.update({
        where: { userId: id },
        data: {
          ...(email !== undefined && { email }),
          ...(displayName !== undefined && { displayName }),
          ...(department !== undefined && { department }),
          ...(roles !== undefined && { roles }),
          ...(status !== undefined && { status }),
          ...passwordUpdate,
        },
      });

      // 如果密码变更，同步更新 MockLDAP
      if (password && passwordUpdate) {
        authService.registerMockUser(
          {
            username: user.username,
            email: user.email || '',
            displayName: user.displayName || user.username,
            department: user.department || '',
          },
          passwordUpdate.passwordHash,
        );
      }

      // 排除 passwordHash，防止泄露到客户端
      const { passwordHash: _ph, ...safeUser } = user;
      res.json(safeUser);
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      next(err);
    }
  });

  // ─── 解锁用户（清除登录失败计数） ──────────────

  router.post('/users/:id/unlock', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const { id } = req.params;
      const user = await prisma.user.findUnique({ where: { userId: id }, select: { username: true } });
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      await authService.unlockUser(user.username);
      res.json({ success: true, message: `用户 ${user.username} 已解锁` });
    } catch (err: any) {
      next(err);
    }
  });

  // ─── 删除用户 ───────────────────────────────────

  router.delete('/users/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const { id } = req.params;

      // 禁止删除自己（User 接口字段是 id，不是 userId）
      if (id === req.user?.id) {
        res.status(400).json({ error: '不能删除当前登录的管理员账户' });
        return;
      }

      // 先查用户名（用于 MockLDAP 移除）
      const userToDelete = await prisma.user.findUnique({ where: { userId: id }, select: { username: true } });
      if (!userToDelete) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      // ── 清理原生 cron 任务 ──
      if (bridge?.isConnected) {
        try {
          const cronResult = (await bridge.cronList(true)) as any;
          const cronItems = cronResult?.jobs || [];
          const prefix = `ent_${id}_`;
          for (const item of cronItems) {
            if (item.agentId?.startsWith(prefix) && item.id) {
              await bridge.cronRemove(item.id).catch(() => { });
            }
          }
        } catch (e: any) {
          console.error(`[admin] Cron cleanup failed for ${id}:`, e.message);
        }
      }

      // ── 清理该用户的所有 agent（原生 gateway + memory scope） ──
      const userAgents = await prisma.agent.findMany({
        where: { ownerId: id },
        select: { id: true, name: true },
      }).catch(() => []);

      // 收集所有需要清理 state 目录的 nativeAgentId
      const nativeAgentIds: string[] = [];

      for (const agent of userAgents) {
        const nativeAgentId = EngineAdapter.userAgentId(id, agent.name);
        nativeAgentIds.push(nativeAgentId);
        if (bridge?.isConnected) {
          bridge.agentsDelete(nativeAgentId).catch(() => { });
        }
        // memory scope 无需清理：默认行为不依赖 agentAccess 配置
      }
      // 默认 agent 不在 agents 表中，也需要清理原生 gateway
      const defaultNativeId = EngineAdapter.userAgentId(id, 'default');
      nativeAgentIds.push(defaultNativeId);
      if (bridge?.isConnected) {
        bridge.agentsDelete(defaultNativeId).catch(() => { });
      }
      // memory scope 无需清理

      // ── userId 格式白名单校验（防止命令注入） ──
      if (!/^user-[a-zA-Z0-9.\-]+$/.test(id)) {
        res.status(400).json({ error: '用户 ID 格式不合法' });
        return;
      }

      // ── 清理用户的 Docker sandbox 容器 ──
      try {
        const containerPrefix = `octopus-sbx-agent-ent_${id}_`;
        const containers = execFileSync('docker', [
          'ps', '-a',
          '--filter', `name=${containerPrefix}`,
          '--format', '{{.Names}}'
        ], { encoding: 'utf8', timeout: 10000 }).trim();
        if (containers) {
          const names = containers.split('\n').filter(Boolean);
          for (const name of names) {
            execFileSync('docker', ['rm', '-f', name], { timeout: 10000 });
            console.log(`[admin] Removed sandbox container: ${name}`);
          }
          console.log(`[admin] Cleaned ${names.length} sandbox container(s) for ${id}`);
        }
      } catch (e: any) {
        console.warn(`[admin] Failed to cleanup sandbox containers for ${id}:`, e.message);
      }

      // ── 清理数据库关联记录 ──
      await prisma.agent.deleteMany({ where: { ownerId: id } }).catch(() => { });
      await prisma.scheduledTask.deleteMany({ where: { userId: id } }).catch(() => { });
      await prisma.databaseConnection.deleteMany({ where: { userId: id } }).catch(() => { });
      await prisma.mCPServer.deleteMany({ where: { ownerId: id } }).catch(() => { });
      await prisma.skill.deleteMany({ where: { ownerId: id } }).catch(() => { });
      await prisma.generatedFile.deleteMany({ where: { userId: id } }).catch(() => { });
      await prisma.iMUserBinding.deleteMany({ where: { userId: id } }).catch(() => { });
      await prisma.mailLog.deleteMany({ where: { userId: id } }).catch(() => { });

      // ── 删除用户记录 ──
      await prisma.user.delete({ where: { userId: id } });

      // ── 从 MockLDAP 移除 ──
      authService.removeMockUser(userToDelete.username);

      // ── 清理用户工作空间（文件系统） ──
      if (workspaceManager) {
        try {
          await workspaceManager.deleteWorkspace(id);
          console.log(`[admin] Workspace deleted for ${id}`);
        } catch (e: any) {
          console.error(`[admin] Workspace cleanup failed for ${id}:`, e.message);
        }
      } else {
        console.warn(`[admin] workspaceManager not available, skipping workspace cleanup for ${id}`);
      }

      // ── 延迟清理 .octopus-state/agents/ 目录（等原生 gateway 异步处理完成） ──
      if (nativeAgentIds.length > 0) {
        setTimeout(async () => {
          const path = await import('path');
          const fs = await import('fs/promises');
          const projectRoot = path.resolve(process.cwd(), '..', '..');
          const stateBase = path.resolve(
            process.env.OCTOPUS_STATE_DIR || path.join(projectRoot, '.octopus-state'),
            'agents',
          );
          for (const nid of nativeAgentIds) {
            const stateDir = path.join(stateBase, nid);
            try {
              await fs.rm(stateDir, { recursive: true, force: true });
              console.log(`[admin] Cleaned state dir: ${stateDir}`);
            } catch { }
          }
        }, 2000);
      }

      // ── 从 octopus.json 的 agents.list 中移除该用户的 agent ──
      if (bridge?.isConnected) {
        try {
          const { config: configRaw } = await bridge.configGetParsed();
          const agentsList: any[] = (configRaw as any)?.agents?.list || [];
          const prefix = `ent_${id}_`;
          const filtered = agentsList.filter((a: any) => !a.id?.startsWith(prefix));
          if (filtered.length < agentsList.length) {
            (configRaw as any).agents.list = filtered;
            // 同步清理其他 agent 的 allowAgents 引用
            for (const a of filtered) {
              const allow = a.subagents?.allowAgents;
              if (Array.isArray(allow)) {
                a.subagents.allowAgents = allow.filter((aid: string) => !aid.startsWith(prefix));
              }
            }
            await bridge.configApplyFull(configRaw);
            console.log(`[admin] Removed ${agentsList.length - filtered.length} agent(s) from octopus.json for ${id}`);
          }
        } catch (e: any) {
          console.error(`[admin] Failed to clean octopus.json for ${id}:`, e.message);
        }
      }

      console.log(`[admin] User '${userToDelete.username}' deleted (${userAgents.length} agents cleaned)`);
      res.json({ message: 'User deleted' });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      next(err);
    }
  });

  // ─── 仪表盘统计 ─────────────────────────────────

  router.get('/dashboard', authMiddleware, adminOnly, async (_req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const [
        totalUsers, activeUsers, todayAuditCount, weekAuditCount,
        totalMcpServers, enabledMcpServers,
        totalSkills, enabledSkills,
        totalAgents,
        totalScheduledTasks, enabledScheduledTasks,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { status: 'active' } }),
        prisma.auditLog.count({ where: { createdAt: { gte: todayStart } } }),
        prisma.auditLog.count({ where: { createdAt: { gte: weekAgo } } }),
        prisma.mCPServer.count().catch(() => 0),
        prisma.mCPServer.count({ where: { enabled: true } }).catch(() => 0),
        prisma.skill.count().catch(() => 0),
        prisma.skill.count({ where: { enabled: true } }).catch(() => 0),
        prisma.agent.count().catch(() => 0),
        prisma.scheduledTask.count().catch(() => 0),
        prisma.scheduledTask.count({ where: { enabled: true } }).catch(() => 0),
      ]);

      // 最近7天每日审计趋势（单次 GROUP BY 替代 7 次串行 COUNT）
      const sevenDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      sevenDaysAgo.setHours(0, 0, 0, 0);
      const rawTrend = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
        SELECT DATE(createdAt) as date, COUNT(*) as count
        FROM AuditLog
        WHERE createdAt >= ${sevenDaysAgo}
        GROUP BY DATE(createdAt)
        ORDER BY date ASC
      `;
      // 补齐缺失的日期（无审计记录的天数 count=0）
      const trendMap = new Map(rawTrend.map(r => [r.date, Number(r.count)]));
      const dailyTrend: { date: string; count: number }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const dateStr = d.toISOString().slice(0, 10);
        dailyTrend.push({ date: dateStr, count: trendMap.get(dateStr) || 0 });
      }

      // 操作类型分布
      const recentLogs = await prisma.auditLog.findMany({
        where: { createdAt: { gte: weekAgo } },
        select: { action: true },
      });
      const actionDistribution: Record<string, number> = {};
      for (const log of recentLogs) {
        actionDistribution[log.action] = (actionDistribution[log.action] || 0) + 1;
      }

      res.json({
        totalUsers,
        activeUsers,
        todayAuditCount,
        weekAuditCount,
        dailyTrend,
        actionDistribution,
        totalMcpServers,
        enabledMcpServers,
        totalSkills,
        enabledSkills,
        totalAgents,
        totalScheduledTasks,
        enabledScheduledTasks,
      });
    } catch (err: any) {
      next(err);
    }
  });

  return router;
}
