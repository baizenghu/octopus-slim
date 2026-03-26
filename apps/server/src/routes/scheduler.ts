/**
 * 定时任务路由 — Native Bridge 版本
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
import { EngineAdapter } from '../services/EngineAdapter';
import type { EngineAdapter as BridgeType } from '../services/EngineAdapter';
import { TenantEngineAdapter } from '../services/TenantEngineAdapter';
import { syncAgentToEngine } from '../services/AgentConfigSync';
import { createLogger } from '../utils/logger';
import type { AppPrismaClient } from '../types/prisma';
import type {
  EngineCronJob,
  EngineCronListResponse,
  EngineChatHistoryResponse,
  EngineMessage,
  EngineContentBlock,
  HeartbeatTaskConfig,
} from '../types/engine';

const logger = createLogger('scheduler');

function normalizeHeartbeatContent(content: string): string {
  return content.trim();
}

export function renderHeartbeatFileContent(content: string): string {
  const normalized = normalizeHeartbeatContent(content);
  return [
    '# Heartbeat Inspection',
    '',
    'This file is only for scheduled heartbeat inspection runs.',
    'Do not treat it as the agent\'s permanent persona, memory, or default instruction set.',
    'If the current run is a normal user conversation or a non-heartbeat task, ignore the inspection instructions below.',
    'Only apply these instructions during the current heartbeat run.',
    'If nothing requires attention, reply exactly HEARTBEAT_OK.',
    '',
    '## Inspection Tasks',
    normalized,
  ].join('\n');
}

export function buildHeartbeatRunPrompt(content: string): string {
  const normalized = normalizeHeartbeatContent(content);
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

// ---- Agent HEARTBEAT.md 写入（通过 RPC） ----

/** 将 HEARTBEAT.md 通过 RPC 写入原生 agent 目录（.octopus-state/agents/{agentId}/agent/HEARTBEAT.md） */
async function writeHeartbeatToAgent(bridge: BridgeType, nativeAgentId: string, content: string): Promise<void> {
  await bridge.agentFilesSet(nativeAgentId, 'HEARTBEAT.md', content);
}

/** 清空 agent 目录中的 HEARTBEAT.md（写入仅含注释的内容让 preflight 跳过） */
async function clearHeartbeatFromAgent(bridge: BridgeType, nativeAgentId: string): Promise<void> {
  const emptyContent = '# HEARTBEAT.md\n# Keep this file empty (or with only comments) to skip heartbeat API calls.\n';
  await bridge.agentFilesSet(nativeAgentId, 'HEARTBEAT.md', emptyContent);
}

// ---- 路由工厂 ----

/**
 * 验证定时任务归属：确保任务属于当前用户
 * 通过 cronList 查询任务，检查 agentId 是否包含当前用户 ID
 */
async function verifyTaskOwnership(
  bridge: BridgeType,
  taskId: string,
  userId: string,
  userIsAdmin = false,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    // NOTE: cron.list RPC 不支持 agentId 过滤，全量拉取后客户端校验归属
    const result = (await bridge.cronList(true)) as EngineCronListResponse;
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
      // DB 中的任务（心跳等）
      const dbTasks = await prisma.scheduledTask.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      });

      if (bridge?.isConnected) {
        // 合并原生 cron 任务
        // NOTE: Native Gateway cron.list RPC 不支持 agentId 过滤，只能客户端过滤
        // 安全依赖：userPrefix 前缀匹配确保只返回当前用户的任务
        const tenant = TenantEngineAdapter.forUser(bridge, user.id);
        const cronResult = await tenant.listMyCrons(true);
        const cronJobs: EngineCronJob[] = cronResult?.jobs ?? [];
        // DB 任务优先，cron 任务补充（去重：DB 中已有的 heartbeat 不重复加）
        const dbIds = new Set(dbTasks.map(t => t.id));
        const mergedCron = cronJobs.filter((j) => !dbIds.has(j.id!));
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
      // ---- 心跳巡检任务：不走 cron，走 HEARTBEAT.md + configApply ----
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

        // 写入 DB
        const taskId = randomUUID().replace(/-/g, '').slice(0, 16);
        const task = await prisma.scheduledTask.create({
          data: {
            id: taskId,
            name: name.trim(),
            userId: user.id,
            cron: every,
            taskType: 'heartbeat',
            taskConfig: { agentId: dbAgentId, every, content },
            enabled: true,
          },
        });

        // 通过 RPC 写 HEARTBEAT.md 到原生 agent 目录
        try {
          await writeHeartbeatToAgent(bridge, nativeAgentId, renderHeartbeatFileContent(content));
          logger.info(`[scheduler] HEARTBEAT.md written for ${nativeAgentId}`);
        } catch (e: unknown) {
          logger.error(`[scheduler] writeHeartbeatToAgent failed for ${nativeAgentId}:`, { error: e instanceof Error ? e.message : String(e) });
        }

        // 通过 AgentConfigSync 更新 heartbeat 配置（复用 read-diff-write 逻辑，避免 configApplyFull）
        await syncAgentToEngine(bridge, user.id, {
          agentName: agent.name,
          heartbeat: { every, prompt: 'HEARTBEAT.md' },
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

        const job = await bridge.cronAdd({
          name: name.trim(),
          agentId: nativeAgentId,
          schedule,
          sessionTarget: 'isolated',
          payload: { kind: 'agentTurn', message },
        });
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
   * 修改定时任务（native 不支持 patch，重新创建）
   */
  router.put('/tasks/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      // 先查 DB 看是否心跳任务
      const dbTask = await prisma.scheduledTask.findFirst({ where: { id, userId: user.id } });

      // ---- 心跳巡检任务更新 ----
      if (dbTask?.taskType === 'heartbeat') {
        if (!bridge?.isConnected) {
          res.status(503).json({ error: 'Native gateway not connected' });
          return;
        }

        const oldConfig = dbTask.taskConfig as HeartbeatTaskConfig;
        const oldDbAgentId = oldConfig?.agentId;
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
        const oldNativeAgentId = req.tenantBridge!.agentId(oldAgent.name);
        const nextNativeAgentId = req.tenantBridge!.agentId(nextAgent.name);

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

        // 构造 DB 更新
        const data: Record<string, any> = {};
        if (name !== undefined) data.name = name.trim();

        const newContent = newTaskConfig?.content;
        const effectiveEvery = newEvery || newTaskConfig?.every || oldConfig.every;
        const effectiveContent = newContent || oldConfig.content;
        const agentChanged = nextDbAgentId !== oldDbAgentId;

        // 更新 taskConfig（保留 agentId）
        data.taskConfig = { agentId: nextDbAgentId, every: effectiveEvery, content: effectiveContent };
        if (newEvery !== undefined) data.cron = newEvery;
        if (enabled !== undefined) data.enabled = Boolean(enabled);

        const task = await prisma.scheduledTask.update({ where: { id }, data });

        // content 变了 → 通过 RPC 重新写 HEARTBEAT.md 到原生 agent 目录
        try {
          if (agentChanged) {
            // agent 变了：清空旧 agent 的 HEARTBEAT.md，写入新 agent 的
            await clearHeartbeatFromAgent(bridge, oldNativeAgentId);
            await writeHeartbeatToAgent(bridge, nextNativeAgentId, renderHeartbeatFileContent(effectiveContent));
          } else if (newContent && newContent !== oldConfig.content) {
            await writeHeartbeatToAgent(bridge, nextNativeAgentId, renderHeartbeatFileContent(newContent));
          }
        } catch (e: unknown) {
          logger.error(`[scheduler] HEARTBEAT.md write failed during update:`, { error: e instanceof Error ? e.message : String(e) });
        }

        // every / enabled / 绑定 agent 变了 → configApply
        const needConfigUpdate =
          agentChanged ||
          (newEvery && newEvery !== oldConfig.every) ||
          (enabled !== undefined && Boolean(enabled) !== dbTask.enabled);

        if (needConfigUpdate) {
          const isDisabled = enabled === false;
          // 通过 AgentConfigSync 更新 heartbeat 配置
          // 禁用 = 删除心跳（null），启用/更新 = 设置心跳
          if (agentChanged) {
            // agent 切换：先删旧 agent 心跳，再设新 agent 心跳
            await syncAgentToEngine(bridge, user.id, {
              agentName: oldAgent.name,
              heartbeat: null,
            });
          }
          await syncAgentToEngine(bridge, user.id, {
            agentName: nextAgent.name,
            heartbeat: isDisabled ? null : { every: effectiveEvery, prompt: 'HEARTBEAT.md' },
          });
        }

        res.json({ task });
        return;
      }

      // ---- 普通定时任务更新 ----
      if (bridge?.isConnected) {
        // 归属校验：确保任务属于当前用户
        const ownership = await verifyTaskOwnership(bridge, id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        // native cron 不支持直接 patch，先删后建
        await bridge.cronRemove(id).catch(err => logger.warn(`[scheduler] 删除旧 cron 任务失败 ${id}`, { error: err?.message || String(err) }));
        const { name, cron: cronExpr, taskConfig } = req.body;
        const nativeAgentId = req.tenantBridge!.agentId('default');
        const job = await bridge.cronAdd({
          name: name?.trim() || id,
          agentId: nativeAgentId,
          schedule: cronExpr ? { kind: 'cron' as const, expr: cronExpr } : { kind: 'at' as const, at: new Date(Date.now() + getRuntimeConfig().scheduler.defaultHeartbeatDelayMs).toISOString() },
          sessionTarget: 'isolated',
          payload: { kind: 'agentTurn', message: taskConfig?.message || `执行定时任务: ${name}` },
        });
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

      // 先查 DB 看是否心跳任务
      const dbTask = await prisma.scheduledTask.findFirst({ where: { id, userId: user.id } });

      // ---- 心跳巡检任务删除 ----
      if (dbTask?.taskType === 'heartbeat') {
        if (!bridge?.isConnected) {
          res.status(503).json({ error: 'Native gateway not connected' });
          return;
        }

        const taskCfg = dbTask.taskConfig as HeartbeatTaskConfig;
        const dbAgentId = taskCfg?.agentId;

        // 查 agent 获取 nativeAgentId
        const agent = await prisma.agent.findFirst({ where: { id: dbAgentId, ownerId: user.id } });
        if (agent) {
          const nativeAgentId = req.tenantBridge!.agentId(agent.name);

          // 通过 RPC 清空原生 agent 目录中的 HEARTBEAT.md
          try {
            await clearHeartbeatFromAgent(bridge, nativeAgentId);
          } catch (e: unknown) {
            logger.error(`[scheduler] clearHeartbeatFromAgent failed for ${nativeAgentId}:`, { error: e instanceof Error ? e.message : String(e) });
          }

          // 通过 AgentConfigSync 删除 heartbeat 配置（避免 configApplyFull）
          await syncAgentToEngine(bridge, user.id, {
            agentName: agent.name,
            heartbeat: null,
          });
        }

        // 删除 DB 记录
        await prisma.scheduledTask.delete({ where: { id } });
        res.json({ ok: true });
        return;
      }

      // ---- 普通定时任务删除 ----
      if (bridge?.isConnected) {
        // 归属校验：确保任务属于当前用户
        const ownership = await verifyTaskOwnership(bridge, id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        await bridge.cronRemove(id);
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

      // 心跳任务：通过 agent RPC 直接触发一次心跳
      if (dbTask?.taskType === 'heartbeat') {
        if (!bridge?.isConnected) {
          res.status(503).json({ error: 'Native gateway not connected' });
          return;
        }
        const taskCfg = dbTask.taskConfig as HeartbeatTaskConfig;
        const agent = await prisma.agent.findFirst({ where: { id: taskCfg?.agentId, ownerId: user.id } });
        if (!agent) {
          res.status(404).json({ error: 'Agent not found' });
          return;
        }
        const nativeAgentId = req.tenantBridge!.agentId(agent.name);
        const heartbeatSessionId = `heartbeat-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const sessionKey = req.tenantBridge!.sessionKey(agent.name, heartbeatSessionId);
        const content = taskCfg?.content || '';
        const prompt = buildHeartbeatRunPrompt(content);
        let heartbeatReply = '';
        await bridge.callAgent({
          message: prompt,
          agentId: nativeAgentId,
          sessionKey,
        }, (event) => {
          // 收集 agent 回复文本（累积全量）
          if (event.type === 'text_delta' && event.content) {
            heartbeatReply = event.content;
          }
        });

        // callAgent resolve 后，从 session history 获取完整回复（更可靠）
        if (!heartbeatReply) {
          try {
            const history = await bridge.chatHistory(sessionKey) as EngineChatHistoryResponse;
            const msgs: EngineMessage[] = history?.messages ?? history?.history ?? [];
            const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
            if (lastAssistant) {
              heartbeatReply = Array.isArray(lastAssistant.content)
                ? lastAssistant.content.map((c: EngineContentBlock) => c.text || c.content || '').join('')
                : String(lastAssistant.content || '');
            }
          } catch { /* history 读取失败不阻塞 */ }
        }

        const isOk = heartbeatReply.includes('HEARTBEAT_OK');
        const resultSummary = isOk ? 'HEARTBEAT_OK' : heartbeatReply.slice(0, getRuntimeConfig().chat.heartbeatSummaryMaxChars);

        // 心跳结果推送到 IM（飞书走引擎原生 cron delivery，微信走企业网关 sendToUser）
        if (imService) {
          const alertText = isOk
            ? `✅ 心跳巡检正常\nAgent: ${agent.name}\n时间: ${new Date().toLocaleString('zh-CN')}`
            : `🚨 心跳巡检告警\nAgent: ${agent.name}\n时间: ${new Date().toLocaleString('zh-CN')}\n\n${resultSummary}`;
          imService.sendToUser(user.id, alertText).then(sent => {
            if (sent > 0) logger.info(`[scheduler] Heartbeat result sent to ${user.id} via IM (${sent} channel(s))`);
          }).catch((e: unknown) => logger.warn(`[scheduler] IM send failed: ${e instanceof Error ? e.message : String(e)}`));
        }

        // 清理隔离 session
        bridge.sessionsDelete(sessionKey).catch((e: unknown) => {
          logger.warn(`[scheduler] Failed to cleanup heartbeat session ${sessionKey}: ${e instanceof Error ? e.message : String(e)}`);
        });
        await prisma.scheduledTask.update({
          where: { id: dbTask.id },
          data: {
            lastRunAt: new Date(),
            taskConfig: { ...taskCfg, lastResult: resultSummary, lastResultAt: new Date().toISOString() },
          },
        }).catch(err => logger.warn('[scheduler] 更新心跳任务最后运行时间失败', { error: (err as Error)?.message || String(err) }));

        // 审计日志：记录心跳执行结果
        try {
          await prisma.auditLog.create({
            data: {
              userId: user.id,
              action: isOk ? 'scheduler:heartbeat:ok' : 'scheduler:heartbeat:alert',
              resource: `scheduler:${dbTask.id}`,
              details: { agentName: agent.name, result: resultSummary.slice(0, 500) },
              success: true,
              durationMs: 0,
            },
          });
        } catch { /* 审计写入失败不阻塞 */ }

        res.json({ ok: true, message: '心跳已手动触发', alert: !isOk, result: resultSummary });
        return;
      }

      if (bridge?.isConnected) {
        // 归属校验：确保任务属于当前用户
        const ownership = await verifyTaskOwnership(bridge, req.params.id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        await bridge.cronRun(req.params.id, 'force');
        res.json({ ok: true, message: '任务已触发' });
      } else {
        res.status(503).json({ error: 'Native gateway not connected' });
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * 查询到期提醒（从原生 cron 查询，重启不丢失）
   */
  router.get('/reminders/due', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    try {
      if (!bridge?.isConnected) {
        res.json({ reminders: [] });
        return;
      }
      // NOTE: cron.list RPC 不支持 agentId 过滤，全量拉取后客户端过滤
      const result = (await bridge.cronList(true)) as EngineCronListResponse;
      const allJobs: EngineCronJob[] = result?.jobs ?? [];
      const prefix = `ent-reminder:${user.id}:`;
      const now = Date.now();
      const dueReminders = allJobs
        .filter((j) => {
          if (!(j.name || '').startsWith(prefix)) return false;
          // 检查 schedule.at 是否已到期
          const at = j.schedule?.at;
          return at && new Date(at).getTime() <= now;
        })
        .map((j) => ({
          id: j.id || j.name,
          title: j.payload?.text || j.payload?.message || '提醒',
          firedAt: j.schedule?.at || new Date().toISOString(),
        }));
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
        // 归属校验：确保提醒属于当前用户
        const user = req.user!;
        const ownership = await verifyTaskOwnership(bridge, req.params.id, user.id, isAdmin(user));
        if (!ownership.ok) {
          res.status(ownership.status).json({ error: ownership.error });
          return;
        }
        await bridge.cronRemove(req.params.id);
      }
      res.json({ ok: true });
    } catch (err: unknown) {
      // 可能已被自动删除，静默处理
      logger.warn('[scheduler] Dismiss error (ignored):', { error: err instanceof Error ? err.message : String(err) });
      res.json({ ok: true });
    }
  });

  return router;
}
