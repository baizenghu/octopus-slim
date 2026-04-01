/**
 * 异步 Agent 任务路由
 *
 * GET    /api/agent-tasks                     — 列出当前用户的后台任务
 * GET    /api/agent-tasks/:taskId             — 获取指定任务状态
 * GET    /api/agent-tasks/:taskId/events      — SSE 流，任务完成/失败/取消时推送
 * DELETE /api/agent-tasks/:taskId             — 取消任务
 */

import { Router } from 'express';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { asyncAgentRegistry, type AsyncAgentTask } from '../services/AsyncAgentRegistry';
import { createLogger } from '../utils/logger';
import type { EngineAdapter } from '../services/EngineAdapter';
import type { AppPrismaClient } from '../types/prisma';

const logger = createLogger('agent-tasks');

export function createAgentTasksRouter(
  authService: AuthService,
  prisma: AppPrismaClient,
  bridge?: EngineAdapter,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma, bridge);

  /**
   * GET /api/agent-tasks
   * 列出当前用户的所有异步任务（按创建时间降序）。
   */
  router.get('/', authMiddleware, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const tasks = asyncAgentRegistry
      .listByUser(user.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    res.json({ tasks });
  });

  /**
   * GET /api/agent-tasks/:taskId
   * 获取指定任务的状态和进度。
   */
  router.get('/:taskId', authMiddleware, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { taskId } = req.params;
    const task = asyncAgentRegistry.get(taskId);
    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    if (task.userId !== user.id) {
      res.status(403).json({ error: '无权访问此任务' });
      return;
    }
    res.json({ task });
  });

  /**
   * GET /api/agent-tasks/:taskId/events
   * SSE 流：订阅任务完成/失败/取消事件。
   * 连接建立后立即推送当前状态；任务结束时推送最终状态并关闭流。
   */
  router.get('/:taskId/events', authMiddleware, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { taskId } = req.params;

    const task = asyncAgentRegistry.get(taskId);
    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    if (task.userId !== user.id) {
      res.status(403).json({ error: '无权访问此任务' });
      return;
    }

    // SSE 响应头
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    let closed = false;

    function sendEvent(eventTask: AsyncAgentTask) {
      if (closed) return;
      try {
        res.write(`data: ${JSON.stringify({
          taskId: eventTask.taskId,
          status: eventTask.status,
          progress: eventTask.progress,
          result: eventTask.result,
          error: eventTask.error,
          completedAt: eventTask.completedAt?.toISOString(),
        })}\n\n`);
      } catch (err: unknown) {
        logger.warn('agent-tasks SSE write error', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 立即推送当前状态
    sendEvent(task);

    // 如果任务已经是终止状态，直接关闭
    const terminalStatuses: ReadonlyArray<string> = ['completed', 'failed', 'cancelled', 'timeout'];
    if (terminalStatuses.includes(task.status)) {
      res.end();
      return;
    }

    // 心跳保活（每 30s）
    const heartbeat = setInterval(() => {
      if (!closed) {
        try { res.write(': heartbeat\n\n'); } catch { /* closed */ }
      }
    }, 30_000);

    // 订阅完成事件
    const unsubscribe = asyncAgentRegistry.subscribe(taskId, (updatedTask) => {
      sendEvent(updatedTask);
      // 任务结束 → 关闭 SSE 流
      if (terminalStatuses.includes(updatedTask.status)) {
        closed = true;
        clearInterval(heartbeat);
        try { res.end(); } catch { /* already closed */ }
      }
    });

    // 客户端断连时清理
    res.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  /**
   * DELETE /api/agent-tasks/:taskId
   * 取消任务（只能取消属于当前用户的任务）。
   */
  router.delete('/:taskId', authMiddleware, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { taskId } = req.params;

    const task = asyncAgentRegistry.get(taskId);
    if (!task) {
      res.status(404).json({ error: '任务不存在' });
      return;
    }
    if (task.userId !== user.id) {
      res.status(403).json({ error: '无权操作此任务' });
      return;
    }

    asyncAgentRegistry.cancel(taskId);
    logger.info('agent task cancelled', { taskId, userId: user.id });
    res.json({ ok: true, taskId, status: 'cancelled' });
  });

  return router;
}
