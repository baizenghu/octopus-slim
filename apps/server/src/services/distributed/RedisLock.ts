/**
 * RedisLock.ts — Redis 分布式锁
 *
 * 基于 SET NX PX 实现，Lua 脚本保证 release/extend 原子性。
 * 用于 cron 任务防重复执行等场景。
 */

import type Redis from 'ioredis';
import { createLogger } from '../../utils/logger';
import { NODE_ID } from './node-id';

const logger = createLogger('redis-lock');

export class RedisDistributedLock {
  private readonly nodeId = NODE_ID;

  constructor(private redis: Redis) {}

  /**
   * 尝试获取锁（非阻塞）
   * @returns true = 获取成功
   */
  async tryAcquire(key: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.redis.set(key, this.nodeId, 'PX', ttlMs, 'NX');
      return result === 'OK';
    } catch (err) {
      logger.warn('Failed to acquire lock', { key, error: (err as Error).message });
      return false;
    }
  }

  /**
   * 释放锁（Lua 原子操作：只有 owner 才能释放）
   */
  async release(key: string): Promise<boolean> {
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('del', KEYS[1])
      else
        return 0
      end
    `;
    try {
      const result = await this.redis.eval(script, 1, key, this.nodeId);
      return result === 1;
    } catch (err) {
      logger.warn('Failed to release lock', { key, error: (err as Error).message });
      return false;
    }
  }

  /**
   * 续期锁（Lua 原子操作：只有 owner 才能续期）
   */
  async extend(key: string, ttlMs: number): Promise<boolean> {
    const script = `
      if redis.call('get', KEYS[1]) == ARGV[1] then
        return redis.call('pexpire', KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    try {
      const result = await this.redis.eval(script, 1, key, this.nodeId, ttlMs.toString());
      return result === 1;
    } catch (err) {
      logger.warn('Failed to extend lock', { key, error: (err as Error).message });
      return false;
    }
  }

  /** 获取当前节点 ID（用于调试） */
  getNodeId(): string {
    return this.nodeId;
  }
}
