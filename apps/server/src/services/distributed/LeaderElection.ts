/**
 * LeaderElection.ts — Redis Leader 选举
 *
 * 用于飞书 WebSocket 等只允许单连接的场景。
 * 基于 SET NX PX + 定期续期实现，leader 崩溃后 TTL 到期自动释放。
 */

import type Redis from 'ioredis';
import { createLogger } from '../../utils/logger';

const logger = createLogger('leader-election');

export class RedisLeaderElection {
  private nodeId: string;
  private renewInterval?: ReturnType<typeof setInterval>;
  private isLeader = false;

  constructor(
    private redis: Redis,
    private key: string,
    private ttlMs: number = 30_000,
    private renewMs: number = 10_000,
  ) {
    this.nodeId = `node-${process.pid}-${Date.now()}`;
  }

  /**
   * 尝试成为 leader
   * @returns true = 当选成功
   */
  async tryBecomeLeader(): Promise<boolean> {
    try {
      const result = await this.redis.set(this.key, this.nodeId, 'PX', this.ttlMs, 'NX');
      this.isLeader = result === 'OK';
      if (this.isLeader) {
        logger.info('Elected as leader', { key: this.key, nodeId: this.nodeId });
        this.startRenewal();
      }
      return this.isLeader;
    } catch (err) {
      logger.warn('Failed to attempt leader election', { key: this.key, error: (err as Error).message });
      return false;
    }
  }

  /**
   * 检查当前节点是否仍是 leader
   */
  async checkLeader(): Promise<boolean> {
    try {
      const current = await this.redis.get(this.key);
      this.isLeader = current === this.nodeId;
      return this.isLeader;
    } catch (err) {
      logger.warn('Failed to check leader status', { key: this.key, error: (err as Error).message });
      return false;
    }
  }

  /** 是否是当前 leader（本地缓存，不查 Redis） */
  get amILeader(): boolean {
    return this.isLeader;
  }

  /** 获取当前节点 ID */
  getNodeId(): string {
    return this.nodeId;
  }

  /**
   * 启动续期定时器
   */
  private startRenewal(): void {
    this.stopRenewal();
    this.renewInterval = setInterval(async () => {
      const script = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('pexpire', KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      try {
        const result = await this.redis.eval(script, 1, this.key, this.nodeId, this.ttlMs.toString());
        if (result !== 1) {
          logger.warn('Lost leadership', { key: this.key, nodeId: this.nodeId });
          this.isLeader = false;
          this.stopRenewal();
        }
      } catch (err) {
        logger.warn('Renewal failed', { key: this.key, error: (err as Error).message });
        this.isLeader = false;
        this.stopRenewal();
      }
    }, this.renewMs);
  }

  /**
   * 停止续期定时器
   */
  private stopRenewal(): void {
    if (this.renewInterval) {
      clearInterval(this.renewInterval);
      this.renewInterval = undefined;
    }
  }

  /**
   * 主动放弃 leader 身份
   */
  async resign(): Promise<void> {
    this.stopRenewal();
    if (this.isLeader) {
      const script = `
        if redis.call('get', KEYS[1]) == ARGV[1] then
          return redis.call('del', KEYS[1])
        else
          return 0
        end
      `;
      try {
        await this.redis.eval(script, 1, this.key, this.nodeId);
        logger.info('Resigned as leader', { key: this.key, nodeId: this.nodeId });
      } catch (err) {
        logger.warn('Failed to resign', { key: this.key, error: (err as Error).message });
      }
      this.isLeader = false;
    }
  }
}
