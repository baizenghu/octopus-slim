/**
 * CronLockProvider — distributed lock interface for cron execution.
 *
 * In multi-node deployments the cron runner fires on every node.
 * A CronLockProvider lets the enterprise layer inject a distributed lock
 * (e.g. Redis SETNX) so that only one node actually executes a given job.
 */

export interface CronLockProvider {
  /**
   * Try to acquire the execution lock for a cron job.
   * @param jobId  Unique job identifier.
   * @param ttlMs  Maximum time the lock should be held (milliseconds).
   * @returns `true` if the lock was acquired (this node should execute),
   *          `false` if another node already holds it.
   */
  tryAcquire(jobId: string, ttlMs: number): Promise<boolean>;

  /**
   * Release the execution lock after the job finishes (or fails).
   * Implementations should be idempotent — releasing a lock that was
   * never acquired or already expired must not throw.
   */
  release(jobId: string): Promise<void>;
}

/**
 * Default single-node implementation — always grants the lock.
 */
export class LocalCronLockProvider implements CronLockProvider {
  async tryAcquire(_jobId: string, _ttlMs: number): Promise<boolean> {
    return true;
  }

  async release(_jobId: string): Promise<void> {}
}
