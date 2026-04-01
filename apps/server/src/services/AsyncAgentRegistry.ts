/**
 * AsyncAgentRegistry — 异步后台 Agent 任务注册表（服务端单例）
 *
 * 内存存储：重启后丢失，无需 DB 迁移。
 * 通过 subscribe/emit 支持 SSE 推送。
 */

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

  create(
    params: Omit<AsyncAgentTask, 'taskId' | 'status' | 'progress' | 'createdAt'>,
  ): AsyncAgentTask {
    const taskId = generateTaskId();
    const task: AsyncAgentTask = {
      ...params,
      taskId,
      status: 'pending',
      progress: [],
      createdAt: new Date(),
    };
    this.tasks.set(taskId, task);
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
  }

  complete(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'completed';
    task.result = result;
    task.completedAt = new Date();
    if (!task.startedAt) task.startedAt = new Date();
    this.emit(taskId);
  }

  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'failed';
    task.error = error;
    task.completedAt = new Date();
    if (!task.startedAt) task.startedAt = new Date();
    this.emit(taskId);
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === 'completed' || task.status === 'failed') return;
    task.status = 'cancelled';
    task.completedAt = new Date();
    this.emit(taskId);
  }

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
