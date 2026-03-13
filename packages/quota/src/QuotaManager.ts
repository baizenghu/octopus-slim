/**
 * 配额管理器
 *
 * 使用 Redis 原子计数实现实时配额管控。
 * Redis 不可用时降级放行（log warning，不阻塞业务）。
 *
 * 修复记录：
 * - #16: consumeQuota 使用 Lua 脚本原子 INCRBY + EXPIRE（替代两步操作）
 * - #18: 添加降级计数器，连续降级超阈值告警
 */

import Redis from 'ioredis';
import type { QuotaType, QuotaCheckResult, UsageStats } from './types';

/** 各配额类型的默认上限（-1 表示无限制） */
const DEFAULT_LIMITS: Record<QuotaType, number> = {
  token_daily: -1,
  token_monthly: -1,
  request_hourly: -1,
};

/** 各配额类型对应 Redis key 的 TTL（秒） */
function ttlForType(type: QuotaType): number {
  switch (type) {
    case 'token_daily':
      return 86400;       // 24h
    case 'token_monthly':
      return 86400 * 31;  // 31d（粗略上限，实际到月末重置）
    case 'request_hourly':
      return 3600;        // 1h
  }
}

/** Redis key 生成 */
function redisKey(userId: string, type: QuotaType): string {
  return `quota:${type}:${userId}`;
}

/** DB 配额限额的 Redis key */
function limitKey(userId: string, type: QuotaType): string {
  return `quota:limit:${type}:${userId}`;
}

/**
 * Lua 脚本：原子 INCRBY + 条件 EXPIRE（#16 修复）
 * 仅在 key 首次创建时（INCRBY 后值等于增量时）设置 TTL
 * 避免 INCRBY 和 EXPIRE 两步操作之间的竞态
 */
const ATOMIC_INCR_SCRIPT = `
  local newVal = redis.call('INCRBY', KEYS[1], ARGV[1])
  if newVal == tonumber(ARGV[1]) then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
  end
  return newVal
`;

/** 降级告警阈值 */
const DEGRADATION_THRESHOLD = 10;

export class QuotaManager {
  private redis: Redis | null = null;
  private prisma: any;

  /** 降级计数器：连续 Redis 异常次数（#18 修复） */
  private degradationCount = 0;

  constructor(opts: { redisUrl?: string; prisma?: any }) {
    this.prisma = opts.prisma ?? null;
    try {
      this.redis = new Redis(opts.redisUrl || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
        lazyConnect: true,
      });
      this.redis.connect().catch((err) => {
        console.warn('[QuotaManager] Redis 连接失败，配额降级放行:', err.message);
        this.redis = null;
      });
    } catch (err: any) {
      console.warn('[QuotaManager] Redis 初始化失败，配额降级放行:', err.message);
      this.redis = null;
    }
  }

  /** 重置降级计数（Redis 操作成功时调用） */
  private resetDegradation(): void {
    if (this.degradationCount > 0) {
      this.degradationCount = 0;
    }
  }

  /** 记录降级并检查是否超阈值（#18 修复） */
  private recordDegradation(context: string, err: Error): void {
    this.degradationCount++;
    if (this.degradationCount >= DEGRADATION_THRESHOLD) {
      console.error(
        `[QuotaManager] 连续降级放行 ${this.degradationCount} 次（阈值 ${DEGRADATION_THRESHOLD}），` +
        `Redis 可能持续不可用。最近错误(${context}): ${err.message}`,
      );
    } else {
      console.warn(`[QuotaManager] ${context} Redis 异常，降级放行 (${this.degradationCount}/${DEGRADATION_THRESHOLD}):`, err.message);
    }
  }

  /**
   * 获取用户某类配额的限额
   * 优先从 Redis 缓存读取，fallback DB，再 fallback 默认值
   */
  private async getLimit(userId: string, type: QuotaType): Promise<number> {
    try {
      if (this.redis) {
        const cached = await this.redis.get(limitKey(userId, type));
        if (cached !== null) return parseInt(cached, 10);
      }
    } catch { /* ignore */ }

    // 从 DB 用户表的 quotas JSON 字段读取
    if (this.prisma) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { userId },
          select: { quotas: true },
        });
        const quotas = user?.quotas as Record<string, number> | null;
        if (quotas && quotas[type] !== undefined) {
          // 缓存到 Redis
          if (this.redis) {
            await this.redis.set(limitKey(userId, type), String(quotas[type]), 'EX', 300).catch(() => {});
          }
          return quotas[type];
        }
      } catch { /* ignore */ }
    }

    return DEFAULT_LIMITS[type];
  }

  /**
   * 计算当前 key 的 TTL 剩余时间对应的 resetAt
   */
  private async getResetAt(userId: string, type: QuotaType): Promise<Date> {
    try {
      if (this.redis) {
        const ttl = await this.redis.ttl(redisKey(userId, type));
        if (ttl > 0) return new Date(Date.now() + ttl * 1000);
      }
    } catch { /* ignore */ }
    return new Date(Date.now() + ttlForType(type) * 1000);
  }

  /**
   * 检查配额是否允许
   */
  async checkQuota(userId: string, type: QuotaType): Promise<QuotaCheckResult> {
    const limit = await this.getLimit(userId, type);
    // -1 表示无限制
    if (limit === -1) {
      return { allowed: true, remaining: Infinity, resetAt: new Date(0) };
    }

    // Redis 不可用时降级放行
    if (!this.redis) {
      return { allowed: true, remaining: limit, resetAt: new Date(Date.now() + ttlForType(type) * 1000) };
    }

    try {
      const key = redisKey(userId, type);
      const current = await this.redis.get(key);
      const used = current ? parseInt(current, 10) : 0;
      const remaining = Math.max(0, limit - used);
      const resetAt = await this.getResetAt(userId, type);
      this.resetDegradation();
      return { allowed: used < limit, remaining, resetAt };
    } catch (err: any) {
      this.recordDegradation('checkQuota', err);
      return { allowed: true, remaining: limit, resetAt: new Date(Date.now() + ttlForType(type) * 1000) };
    }
  }

  /**
   * 消费配额（Lua 脚本原子 INCRBY + EXPIRE，#16 修复）
   */
  async consumeQuota(userId: string, type: QuotaType, amount: number = 1): Promise<void> {
    if (!this.redis) return;

    try {
      const key = redisKey(userId, type);
      const ttl = ttlForType(type);
      // Lua 脚本原子操作：INCRBY + 仅首次 EXPIRE（#16 修复）
      await this.redis.eval(ATOMIC_INCR_SCRIPT, 1, key, amount, ttl);
      this.resetDegradation();
    } catch (err: any) {
      this.recordDegradation('consumeQuota', err);
    }
  }

  /**
   * 获取用户全部配额使用情况
   */
  async getUsage(userId: string): Promise<UsageStats> {
    const types: QuotaType[] = ['token_daily', 'token_monthly', 'request_hourly'];
    const limits: Record<QuotaType, number> = { ...DEFAULT_LIMITS };

    let tokenDaily = 0;
    let tokenMonthly = 0;
    let requestHourly = 0;

    for (const type of types) {
      limits[type] = await this.getLimit(userId, type);
    }

    if (this.redis) {
      try {
        const pipeline = this.redis.pipeline();
        for (const type of types) {
          pipeline.get(redisKey(userId, type));
        }
        const results = await pipeline.exec();
        if (results) {
          tokenDaily = results[0]?.[1] ? parseInt(results[0][1] as string, 10) : 0;
          tokenMonthly = results[1]?.[1] ? parseInt(results[1][1] as string, 10) : 0;
          requestHourly = results[2]?.[1] ? parseInt(results[2][1] as string, 10) : 0;
        }
        this.resetDegradation();
      } catch (err: any) {
        this.recordDegradation('getUsage', err);
      }
    }

    return { tokenDaily, tokenMonthly, requestHourly, limits };
  }

  /**
   * 设置用户某类配额的限额（持久化到 DB + 缓存到 Redis）
   */
  async setLimit(userId: string, type: QuotaType, limit: number): Promise<void> {
    // 写 Redis 缓存
    if (this.redis) {
      try {
        await this.redis.set(limitKey(userId, type), String(limit), 'EX', 300);
      } catch { /* ignore */ }
    }

    // 写 DB（合并到 user.quotas JSON 字段）
    if (this.prisma) {
      try {
        const user = await this.prisma.user.findUnique({
          where: { userId },
          select: { quotas: true },
        });
        const quotas = (user?.quotas as Record<string, unknown>) || {};
        quotas[type] = limit;
        await this.prisma.user.update({
          where: { userId },
          data: { quotas },
        });
      } catch (err: any) {
        console.warn('[QuotaManager] setLimit DB 写入失败:', err.message);
      }
    }
  }

  /** 获取 Redis 连接状态 */
  getRedisStatus(): 'connected' | 'degraded' | 'disconnected' {
    if (!this.redis) return 'disconnected';
    const status = this.redis.status;
    if (status === 'ready') return 'connected';
    if (status === 'connecting' || status === 'reconnecting') return 'degraded';
    return 'disconnected';
  }

  /** 关闭 Redis 连接 */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => {});
    }
  }
}
