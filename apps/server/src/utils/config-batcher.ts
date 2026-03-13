import { deepMerge } from './deep-merge';

interface PendingPatch {
  patch: Record<string, unknown>;
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * ConfigBatcher — 合并短时间内的 configApply 请求
 *
 * 收集 batchWindowMs 内的所有 patch，deep merge 后单次调用 configApply。
 * 解决原生 3次/60秒 限流问题。
 */
export class ConfigBatcher {
  private pending: PendingPatch[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private applyFn: (patch: Record<string, unknown>) => Promise<void>;
  private batchWindowMs: number;

  constructor(
    applyFn: (patch: Record<string, unknown>) => Promise<void>,
    batchWindowMs = 200,
  ) {
    this.applyFn = applyFn;
    this.batchWindowMs = batchWindowMs;
  }

  /**
   * 提交一个 config patch，返回 Promise 在实际 apply 完成后 resolve
   */
  apply(patch: Record<string, unknown>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pending.push({ patch, resolve, reject });

      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.batchWindowMs);
      }
    });
  }

  /**
   * 立即刷新所有待处理的 patch
   */
  private async flush(): Promise<void> {
    this.timer = null;
    const batch = this.pending.splice(0);
    if (batch.length === 0) return;

    // Deep merge 所有 patch
    let merged: Record<string, unknown> = {};
    for (const { patch } of batch) {
      merged = deepMerge(merged, patch);
    }

    try {
      await this.applyFn(merged);
      for (const { resolve } of batch) resolve();
    } catch (err) {
      for (const { reject } of batch) reject(err as Error);
    }
  }

  /**
   * 销毁，清理定时器
   */
  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    for (const { reject } of this.pending) {
      reject(new Error('ConfigBatcher destroyed'));
    }
    this.pending = [];
  }
}
