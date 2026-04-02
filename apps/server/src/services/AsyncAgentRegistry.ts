/**
 * AsyncAgentRegistry — 异步后台 Agent 任务注册表（服务端单例）
 *
 * 内存存储主路径，重启通过 restoreFromDB 将 running/pending 任务标记为 failed。
 * 通过 subscribe/emit 支持 SSE 推送。
 */

import { getRuntimeConfig } from '../config';
import type { AppPrismaClient } from '../types/prisma';

// logger 轻量封装：避免循环依赖
const _log = {
  warn: (msg: string, meta?: Record<string, unknown>) =>
    // eslint-disable-next-line no-console
    console.warn(`[AsyncAgentRegistry] ${msg}`, meta ?? ''),
  info: (msg: string, meta?: Record<string, unknown>) =>
    // eslint-disable-next-line no-console
    console.info(`[AsyncAgentRegistry] ${msg}`, meta ?? ''),
};

export type AsyncAgentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'cancelled';

export interface AsyncAgentTask {
  taskId: string;
  userId: string;
  agentName: string;
  message: string;
  status: AsyncAgentStatus;
  /** 进度摘要 ring buffer，最多 20 条 */
  progress: string[];
  result?: string;
  error?: string;
  /** 引擎 runId（callAgent 返回后填充） */
  runId?: string;
  sessionKey?: string;
  /** Token 消耗统计（任务完成时写入） */
  inputTokens?: number;
  outputTokens?: number;
  modelName?: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

const PROGRESS_MAX = 20;

function generateTaskId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export class AsyncAgentRegistry {
  private tasks = new Map<string, AsyncAgentTask>();
  private listeners = new Map<string, Array<(task: AsyncAgentTask) => void>>();
  private prisma?: AppPrismaClient;

  // ── DB 依赖注入 ──────────────────────────────────────────────────────────

  setPrisma(prisma: AppPrismaClient): void {
    this.prisma = prisma;
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private async persistTask(task: AsyncAgentTask): Promise<void> {
    if (!this.prisma) return;
    await this.prisma.agentTask.upsert({
      where: { taskId: task.taskId },
      create: {
        taskId: task.taskId,
        userId: task.userId,
        agentName: task.agentName,
        message: task.message,
        status: task.status,
        progress: task.progress,
        result: task.result ?? null,
        error: task.error ?? null,
        runId: task.runId ?? null,
        sessionKey: task.sessionKey ?? null,
        inputTokens: task.inputTokens ?? null,
        outputTokens: task.outputTokens ?? null,
        modelName: task.modelName ?? null,
        createdAt: task.createdAt,
        startedAt: task.startedAt ?? null,
        completedAt: task.completedAt ?? null,
      },
      update: {
        status: task.status,
        progress: task.progress,
        result: task.result ?? null,
        error: task.error ?? null,
        runId: task.runId ?? null,
        sessionKey: task.sessionKey ?? null,
        inputTokens: task.inputTokens ?? null,
        outputTokens: task.outputTokens ?? null,
        modelName: task.modelName ?? null,
        startedAt: task.startedAt ?? null,
        completedAt: task.completedAt ?? null,
      },
    });
  }

  /**
   * 服务启动时调用：
   * 1. 注入 Prisma 实例（供后续写入）
   * 2. 将 DB 中残留的 running/pending 任务标记为 failed（服务重启意味任务中断）
   */
  async restoreFromDB(prisma: AppPrismaClient): Promise<void> {
    this.setPrisma(prisma);
    // 1. 将残留的 running/pending 任务标记为 failed
    const staleTasks = await prisma.agentTask.findMany({
      where: { status: { in: ['running', 'pending'] } },
    });
    for (const t of staleTasks) {
      await prisma.agentTask.update({
        where: { taskId: t.taskId },
        data: { status: 'failed', error: '服务重启，任务中断' },
      });
    }
    if (staleTasks.length > 0) {
      _log.warn(`restoreFromDB: marked ${staleTasks.length} stale task(s) as failed`);
    }
    // 2. 回填最近 24h 的任务到内存（让 GET /api/agent-tasks 重启后仍可查到历史）
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentTasks = await prisma.agentTask.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    for (const t of recentTasks) {
      if (!this.tasks.has(t.taskId)) {
        this.tasks.set(t.taskId, {
          ...t,
          status: t.status as AsyncAgentTask['status'],
          progress: (t.progress as string[]) ?? [],
          result: t.result ?? undefined,
          error: t.error ?? undefined,
          runId: t.runId ?? undefined,
          sessionKey: t.sessionKey ?? undefined,
          inputTokens: (t as any).inputTokens ?? undefined,
          outputTokens: (t as any).outputTokens ?? undefined,
          modelName: (t as any).modelName ?? undefined,
          startedAt: t.startedAt ?? undefined,
          completedAt: t.completedAt ?? undefined,
        });
      }
    }
    if (recentTasks.length > 0) {
      _log.info(`restoreFromDB: loaded ${recentTasks.length} recent task(s) into memory`);
    }
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  create(
    params: Omit<AsyncAgentTask, 'taskId' | 'status' | 'progress' | 'createdAt'>,
  ): AsyncAgentTask {
    // Per-user 配额检查
    const perUserLimit = getRuntimeConfig().agents.maxAsyncTasksPerUser;
    const running = this.listByUser(params.userId).filter(
      (t) => t.status === 'running' || t.status === 'pending',
    );
    if (running.length >= perUserLimit) {
      const err = new Error(
        `并发后台任务已达上限（${perUserLimit}），请等待当前任务完成`,
      );
      (err as any).code = 'USER_TASK_LIMIT_EXCEEDED';
      throw err;
    }

    const taskId = generateTaskId();
    const task: AsyncAgentTask = {
      ...params,
      taskId,
      status: 'pending',
      progress: [],
      createdAt: new Date(),
    };
    this.tasks.set(taskId, task);

    // fire-and-forget DB 写入
    this.persistTask(task).catch((e: unknown) =>
      _log.warn('DB write failed on create', { error: String(e) }),
    );

    return task;
  }

  get(taskId: string): AsyncAgentTask | undefined {
    return this.tasks.get(taskId);
  }

  listByUser(userId: string): AsyncAgentTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.userId === userId);
  }

  updateProgress(taskId: string, progressLine: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'pending') {
      task.status = 'running';
      task.startedAt = task.startedAt ?? new Date();
    }
    task.progress.push(progressLine);
    if (task.progress.length > PROGRESS_MAX) {
      task.progress.shift();
    }
    // 推送进度更新到 SSE 订阅者
    this.emit(taskId);
  }

  complete(
    taskId: string,
    result: string,
    usage?: { inputTokens?: number; outputTokens?: number; modelName?: string },
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date();
    if (!task.startedAt) task.startedAt = new Date();
    if (usage) {
      if (typeof usage.inputTokens === 'number') task.inputTokens = usage.inputTokens;
      if (typeof usage.outputTokens === 'number') task.outputTokens = usage.outputTokens;
      if (usage.modelName) task.modelName = usage.modelName;
    }
    this.emit(taskId);
    this.persistTask(task).catch((e: unknown) =>
      _log.warn('DB sync failed on complete', { error: String(e) }),
    );
  }

  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.error = error;
    task.completedAt = new Date();
    if (!task.startedAt) task.startedAt = new Date();
    this.emit(taskId);
    this.persistTask(task).catch((e: unknown) =>
      _log.warn('DB sync failed on fail', { error: String(e) }),
    );
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'completed' || task.status === 'failed') return;
    task.status = 'cancelled';
    task.completedAt = new Date();
    this.emit(taskId);
    this.persistTask(task).catch((e: unknown) =>
      _log.warn('DB sync failed on cancel', { error: String(e) }),
    );
  }

  // ── Subscription ─────────────────────────────────────────────────────────

  /**
   * 订阅任务状态变更事件（完成/失败/取消时触发）。
   * 返回取消订阅函数。
   */
  subscribe(taskId: string, listener: (task: AsyncAgentTask) => void): () => void {
    let list = this.listeners.get(taskId);
    if (!list) {
      list = [];
      this.listeners.set(taskId, list);
    }
    list.push(listener);
    return () => {
      const l = this.listeners.get(taskId);
      if (!l) return;
      const idx = l.indexOf(listener);
      if (idx !== -1) l.splice(idx, 1);
      if (l.length === 0) this.listeners.delete(taskId);
    };
  }

  private emit(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const list = this.listeners.get(taskId);
    if (!list || list.length === 0) return;
    for (const fn of list.slice()) {
      try {
        fn(task);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[AsyncAgentRegistry] listener error for task ${taskId}: ${msg}`);
      }
    }
  }
}

/** 全局单例 */
export const asyncAgentRegistry = new AsyncAgentRegistry();
