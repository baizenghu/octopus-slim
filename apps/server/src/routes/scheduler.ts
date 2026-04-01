/**
 * 定时任务路由 — 引擎原生 cron 版本
 *
 * GET    /api/scheduler/tasks           — 列出我的定时任务（native cron）
 * POST   /api/scheduler/tasks           — 创建定时任务（native cron）
 * PUT    /api/scheduler/tasks/:id       — 修改定时任务（native cron）
 * DELETE /api/scheduler/tasks/:id       — 删除定时任务（native cron）
 * POST   /api/scheduler/tasks/:id/run   — 立即执行一次（native cron.run）
 * GET    /api/scheduler/reminders/due   — 查询到期提醒（原生 cron，前端轮询）
 * POST   /api/scheduler/reminders/:id/dismiss — 标记提醒已读
 */

import { randomUUID } from 'crypto';
import { Router } from 'express';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, isAdmin, type AuthenticatedRequest } from '../middleware/auth';
import { getRuntimeConfig } from '../config';
import type { EngineAdapter as BridgeType } from '../services/EngineAdapter';
import { TenantEngineAdapter } from '../services/TenantEngineAdapter';
import { createLogger } from '../utils/logger';
import type { AppPrismaClient } from '../types/prisma';
import type {
  EngineCronJob,
  EngineCronListResponse,
  HeartbeatTaskConfig,
} from '../types/engine';

const logger = createLogger('scheduler');

/** 构建心跳巡检的 agent prompt */
export function buildHeartbeatRunPrompt(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    return [
      'You are running a one-off heartbeat inspection.',
      'These instructions apply only to this run and must not change your long-term role or memory.',
      'If nothing requires attention, reply exactly HEARTBEAT_OK.',
    ].join(' ');
  }

  return [
    'You are running a one-off heartbeat inspection for this agent.',
    'The following instructions apply only to this run.',
    'They must not change your long-term role, memory, or default behavior for normal chats.',
    'If nothing requires attention, reply exactly HEARTBEAT_OK.',
    '',
    normalized,
  ].join('\n');
}

/** 解析 every 字符串为毫秒（如 "30m" → 1800000） */
export function parseEveryToMs(every: string): number {
  const match = every.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 30 * 60 * 1000; // 默认 30m
  const num = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return num * 1000;
    case 'm': return num * 60 * 1000;
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    default: return 30 * 60 * 1000;
  }
}

// ---- 提醒查询（可复用，供 SSE 推送调用） ----

/**
 * 查询指定用户的到期提醒
 */
export async function checkDueReminders(
  bridge: BridgeType | undefined,
  userId: string,
): Promise<Array<{ id: string; title: string; firedAt: string }>> {
  if (!bridge?.isConnected) return [];
  // TODO(A-010): 当引擎 cron.list 支持 prefix 参数时，传入 prefix: `ent-reminder:${userId}:` 做服务端过滤，减少全量传输
  const result = await bridge.call<EngineCronListResponse>('cron.list', { includeDisabled: true });
  const allJobs: EngineCronJob[] = result?.jobs ?? [];
  const prefix = `ent-reminder:${userId}:`;
  const now = Date.now();
  return allJobs
    .filter((j) => {
      if (!(j.name || '').startsWith(prefix)) return false;
      const at = j.schedule?.at;
      return at && new Date(at).getTime() <= now;
    })
    .map((j) => ({
      id: j.id || j.name || '',
      title: j.payload?.text || j.payload?.message || '提醒',
      firedAt: j.schedule?.at || new Date().toISOString(),
    }));
}

// ---- 路由工厂 ----

/**
 * 验证定时任务归属：确保任务属于当前用户
 */
async function verifyTaskOwnership(
  bridge: BridgeType,
  taskId: string,
  userId: string,
  userIsAdmin = false,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const result = await bridge.call<EngineCronListResponse>('cron.list', { includeDisabled: true });
    const allJobs: EngineCronJob[] = result?.jobs ?? [];
    const job = allJobs.find((j) => j.id === taskId);
    if (!job) {
      return { ok: false, status: 404, error: 'Task not found' };
    }
    const agentId = job.agentId || job.agent || '';
    if (!agentId.startsWith(TenantEngineAdapter.forUser(bridge, userId).agentId('')) && !userIsAdmin) {
      return { ok: false, status: 403, error: 'Access denied' };
    }
    return { ok: true, status: 200 };
  } catch (err: unknown) {
    return { ok: false, status: 500, error: (err as Error).message };
  }
}

export function createSchedulerRouter(
  authService: AuthService,
  prisma: AppPrismaClient,
  bridge?: BridgeType,
  imService?: { sendToUser(userId: string, text: string): Promise<number> },
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma, bridge);

  /**
   * 列出当前用户的定时任务
   */
  router.get('/tasks', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    try {
      // DB 中的任务（心跳等，保留元数据如 name/content）
      const dbTasks = await prisma.scheduledTask.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });

      if (bridge?.isConnected) {
        const tenant = TenantEngineAdapter.forUser(bridge, user.id);
        const cronResult = await tenant.listMyCrons(true);
        const cronJobs: EngineCronJob[] = cronResult?.jobs ?? [];
        // DB 任务优先，cron 任务补充（去重）
        const dbIds = new Set(dbTasks.map(t => t.id));
        // 同时匹配 cronJobId（DB 心跳任务可能记录了对应的 cron job ID）
        const dbCronIds = new Set(
          dbTasks
            .map(t => (t.taskConfig as HeartbeatTaskConfig)?.cronJobId)
            .filter(Boolean),
        );
        const mergedCron = cronJobs.filter((j) => !dbIds.has(j.id!) && !dbCronIds.has(j.id!));
        res.json({ tasks: [...dbTasks, ...mergedCron] });
      } else {
        res.json({ tasks: dbTasks });
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * 创建定时任务
   */
  router.post('/tasks', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const { name, cron: cronExpr, taskType, taskConfig } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    try {
      // ---- 心跳巡检任务：通过引擎原生 cron every + agentTurn ----
      if (taskType === 'heartbeat') {
        if (!bridge?.isConnected) {
          res.status(503).json({ error: 'Native gateway not connected' });
          return;
        }
        const { agentId: dbAgentId, every, content } = taskConfig || {};
        if (!dbAgentId || !every || !content) {
          res.status(400).json({ error: 'taskConfig 需要 agentId, every, content' });
          return;
        }

        // 检查该 agent 是否已有心跳任务
        const existing = await prisma.scheduledTask.findFirst({
          where: {
            userId: user.id,
            taskType: 'heartbeat',
            taskConfig: { path: '$.agentId', equals: dbAgentId },
          },
        });
        if (existing) {
          res.status(400).json({ error: '该 Agent 已有心跳巡检任务' });
          return;
        }

        // 查 agent 表获取 agentName
        const agent = await prisma.agent.findFirst({
          where: { id: dbAgentId, ownerId: user.id },
        });
        if (!agent) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }
        const nativeAgentId = req.tenantBridge!.agentId(agent.name);

        // 通过引擎原生 cron 创建周期任务
        const prompt = buildHeartbeatRunPrompt(content);
        const cronJob = await bridge.call<{ id?: string }>('cron.add', { job: {
          name: `heartbeat:${name.trim()}`,
          agentId: nativeAgentId,
          schedule: { kind: 'every' as const, everyMs: parseEveryToMs(every) },
          sessionTarget: 'isolated',
          payload: { kind: 'agentTurn', message: prompt },
        } });

        // 写入 DB（记录元数据 + cronJobId 关联）
        const taskId = randomUUID().replace(/-/g, '').slice(0, 16);
        const task = await prisma.scheduledTask.create({
          data: {
            id: taskId,
            name: name.trim(),
            userId: user.id,
            cron: every,
            taskType: 'heartbeat',
            taskConfig: { agentId: dbAgentId, every, content, cronJobId: cronJob?.id },
            enabled: true,
          },
        });

        res.json({ task });
        return;
      }

      // ---- 普通定时任务 ----
      if (bridge?.isConnected) {
        const nativeAgentId = req.tenantBridge!.agentId('default');
        const message = taskConfig?.message || `执行定时任务: ${name}`;
        const schedule = cronExpr
          ? { kind: 'cron' as const, expr: cronExpr }
          : { kind: 'at' as const, at: taskConfig?.at || new Date(Date.now() + getRuntimeConfig().scheduler.defaultHeartbeatDelayMs).toISOString() };

        const job = await bridge.call('cron.add', { job: {
          name: name.trim(),
          agentId: nativeAgentId,
          schedule,
          sessionTarget: 'isolated',
          payload: { kind: 'agentTurn', message },
        } });
        res.json({ task: job });
      } else {
        // fallback: DB only
        const task = await prisma.scheduledTask.create({
          data: {
            id: randomUUID().replace(/-/g, '').slice(0, 16),
            name: name.trim(),
            userId: user.id,
            cron: cronExpr?.trim() || '',
            taskType: taskType || 'skill',
            taskConfig: taskConfig || {},
            enabled: true,
          },
        });
        res.json({ task });
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * 修改定时任务
   */
  router.put('/tasks/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const dbTask = await prisma.scheduledTask.findFirst({ where: { id, userId: user.id } });

      // ---- 心跳巡检任务更新 ----
      if (dbTask?.taskType === 'heartbeat') {
        if (!bridge?.isConnected) {
          res.status(503).json({ error: 'Native gateway not connected' });
          return;
        }

        const oldConfig = dbTask.taskConfig as HeartbeatTaskConfig;
        const oldDbAgentId = oldConfig?.agentId;
        const oldCronJobId = oldConfig?.cronJobId;
        const { name, cron: newEvery, taskConfig: newTaskConfig, enabled } = req.body;
        const nextDbAgentId = newTaskConfig?.agentId || oldDbAgentId;

        const [oldAgent, nextAgent] = await Promise.all([
          prisma.agent.findFirst({ where: { id: oldDbAgentId, ownerId: user.id } }),
          prisma.agent.findFirst({ where: { id: nextDbAgentId, ownerId: user.id } }),
        ]);

        if (!oldAgent || !nextAgent) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }

        if (nextDbAgentId !== oldDbAgentId) {
          const existing = await prisma.scheduledTask.findFirst({
            where: {
              userId: user.id,
              taskType: 'heartbeat',
              taskConfig: { path: '$.agentId', equals: nextDbAgentId },
              id: { not: id },
            },
          });
          if (existing) {
            res.status(400).json({ error: '该 Agent 已有心跳巡检任务' });
            return;
          }
        }

        const newContent = newTaskConfig?.content;
        const effectiveEvery = newEvery || newTaskConfig?.every || oldConfig.every;
        const effectiveContent = newContent || oldConfig.content;
        const nativeAgentId = req.tenantBridge!.agentId(nextAgent.name);
        const isDisabled = enabled === false;

        // 删除旧 cron job，重新创建（引擎不支持 patch）
        let newCronJobId = oldCronJobId;
        if (oldCronJobId) {
          await bridge.call('cron.remove', { id: oldCronJobId }).catch(err =>
            logger.warn(`[scheduler] 删除旧 cron 心跳任务失败 ${oldCronJobId}`, { error: err?.message || String(err) }),
          );
        }

        if (!isDisabled) {
          const prompt = buildHeartbeatRunPrompt(effectiveContent);
          const cronJob = await bridge.call<{ id?: string }>('cron.add', { job: {
            name: `heartbeat:${(name || dbTask.name).trim()}`,
            agentId: nativeAgentId,
            schedule: { kind: 'every' as const, everyMs: parseEveryToMs(effectiveEvery) },
            sessionTarget: 'isolated',
            payload: { kind: 'agentTurn', message: prompt },
          } });
          newCronJobId = cronJob?.id;
        } else {
          newCronJobId = undefined;
        }

        // 更新 DB
        const data: Record<string, any> = {};
        if (name !== undefined) data.name = name.trim();
        if (newEvery !== undefined) data.cron = newEvery;
        if (enabled !== undefined) data.enabled = Boolean(enabled);
        data.taskConfig = {
          agentId: nextDbAgentId,
          every: effectiveEvery,
          content: effectiveContent,
          cronJobId: newCronJobId,
        };

        const task = await prisma.scheduledTask.update({ where: { id }, data });
        res.json({ task });
        return;
      }

      // ---- 普通定时任务更新 ----
      if (bridge?.isConnected) {
        const ownership = await verifyTaskOwnership(bridge, id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        // 先创建新 job，成功后删除旧 job（避免 add 失败导致任务丢失）
        const { name, cron: cronExpr, taskConfig } = req.body;
        const nativeAgentId = req.tenantBridge!.agentId('default');
        const job = await bridge.call('cron.add', { job: {
          name: name?.trim() || id,
          agentId: nativeAgentId,
          schedule: cronExpr ? { kind: 'cron' as const, expr: cronExpr } : { kind: 'at' as const, at: new Date(Date.now() + getRuntimeConfig().scheduler.defaultHeartbeatDelayMs).toISOString() },
          sessionTarget: 'isolated',
          payload: { kind: 'agentTurn', message: taskConfig?.message || `执行定时任务: ${name}` },
        } });
        // 新 job 创建成功后才删除旧 job
        await bridge.call('cron.remove', { id }).catch(err => logger.warn(`[scheduler] 删除旧 cron 任务失败 ${id}`, { error: err?.message || String(err) }));
        res.json({ task: job });
      } else {
        if (!dbTask) { res.status(404).json({ error: 'Task not found' }); return; }
        const { name, cron, taskType, taskConfig, enabled } = req.body;
        const data: Record<string, any> = {};
        if (name !== undefined) data.name = name.trim();
        if (cron !== undefined) data.cron = cron.trim();
        if (taskType !== undefined) data.taskType = taskType;
        if (taskConfig !== undefined) data.taskConfig = taskConfig;
        if (enabled !== undefined) data.enabled = Boolean(enabled);
        const task = await prisma.scheduledTask.update({ where: { id }, data });
        res.json({ task });
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * 删除定时任务
   */
  router.delete('/tasks/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const dbTask = await prisma.scheduledTask.findFirst({ where: { id, userId: user.id } });

      // ---- 心跳巡检任务删除 ----
      if (dbTask?.taskType === 'heartbeat') {
        if (!bridge?.isConnected) {
          res.status(503).json({ error: 'Native gateway not connected' });
          return;
        }

        const taskCfg = dbTask.taskConfig as HeartbeatTaskConfig;
        const cronJobId = taskCfg?.cronJobId;

        // 删除引擎 cron job
        if (cronJobId) {
          await bridge.call('cron.remove', { id: cronJobId }).catch((e: unknown) => {
            logger.warn(`[scheduler] cronRemove failed for ${cronJobId}: ${e instanceof Error ? e.message : String(e)}`);
          });
        }

        // 删除 DB 记录
        await prisma.scheduledTask.delete({ where: { id } });
        res.json({ ok: true });
        return;
      }

      // ---- 普通定时任务删除 ----
      if (bridge?.isConnected) {
        const ownership = await verifyTaskOwnership(bridge, id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        await bridge.call('cron.remove', { id });
        res.json({ ok: true });
      } else {
        if (!dbTask) { res.status(404).json({ error: 'Task not found' }); return; }
        await prisma.scheduledTask.delete({ where: { id } });
        res.json({ ok: true });
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * 立即执行一次
   */
  router.post('/tasks/:id/run', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;

      const dbTask = await prisma.scheduledTask.findFirst({ where: { id: req.params.id, userId: user.id } });

      // 心跳任务：通过 cron.run 触发
      if (dbTask?.taskType === 'heartbeat') {
        if (!bridge?.isConnected) {
          res.status(503).json({ error: 'Native gateway not connected' });
          return;
        }
        const taskCfg = dbTask.taskConfig as HeartbeatTaskConfig;
        const cronJobId = taskCfg?.cronJobId;

        if (!cronJobId) {
          res.status(400).json({ error: '该心跳任务未关联引擎 cron job，请删除后重新创建' });
          return;
        }

        await bridge.call('cron.run', { id: cronJobId, mode: 'force' });

        await prisma.scheduledTask.update({
          where: { id: dbTask.id },
          data: { lastRunAt: new Date() },
        }).catch(err => logger.warn('[scheduler] 更新心跳任务最后运行时间失败', { error: (err as Error)?.message || String(err) }));

        res.json({ ok: true, message: '心跳已通过引擎 cron 触发' });
        return;
      }

      if (bridge?.isConnected) {
        const ownership = await verifyTaskOwnership(bridge, req.params.id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        await bridge.call('cron.run', { id: req.params.id, mode: 'force' });
        res.json({ ok: true, message: '任务已触发' });
      } else {
        res.status(503).json({ error: 'Native gateway not connected' });
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * 查询到期提醒（从原生 cron 查询）
   */
  router.get('/reminders/due', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    try {
      const dueReminders = await checkDueReminders(bridge, user.id);
      res.json({ reminders: dueReminders });
    } catch (err: unknown) {
      logger.error('[scheduler] Reminders query error:', { error: err instanceof Error ? err.message : String(err) });
      res.json({ reminders: [] });
    }
  });

  /**
   * 标记提醒已读（从原生 cron 删除）
   */
  router.post('/reminders/:id/dismiss', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      if (bridge?.isConnected) {
        const user = req.user!;
        const ownership = await verifyTaskOwnership(bridge, req.params.id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        await bridge.call('cron.remove', { id: req.params.id });
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      logger.warn('[scheduler] Dismiss error (ignored):', { error: err instanceof Error ? err.message : String(err) });
      res.json({ ok: true });
    }
  });

  return router;
}
