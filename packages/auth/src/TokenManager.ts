/**
 * JWT Token管理器
 *
 * 负责 JWT Token 的生成、验证和黑名单管理
 * 使用 Redis 存储 Token 黑名单（用于登出失效）
 * 无 Redis 时使用内存 LRU Cache 作为 fallback
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { User, TokenPayload } from './types';

/**
 * Token管理器配置
 */
export interface TokenManagerConfig {
  /** JWT密钥（用于 Access Token） */
  secret: string;
  /** Refresh Token 独立密钥（未设置时降级使用 secret） */
  refreshSecret?: string;
  /** 访问令牌过期时间（如 '2h', '30m'） */
  accessTokenExpiresIn: string;
  /** 刷新令牌过期时间（如 '7d'） */
  refreshTokenExpiresIn: string;
}

/**
 * Redis 客户端接口（松耦合，不直接依赖 ioredis）
 */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<any>;
  del?(key: string): Promise<any>;
  incr?(key: string): Promise<number>;
  expire?(key: string, seconds: number): Promise<any>;
}

/**
 * 简易 LRU Cache with TTL（无外部依赖）
 * 用于 Redis 不可用时的 Token 黑名单 fallback
 */
class BlacklistLRUCache {
  private cache = new Map<string, number>(); // hash -> expireAt (ms)
  private readonly maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  /** 写入黑名单，ttlMs 为过期时间（毫秒） */
  set(hash: string, ttlMs: number): void {
    // 先删再 set，保证 Map 插入顺序 = 最近使用顺序
    this.cache.delete(hash);
    this.cache.set(hash, Date.now() + ttlMs);

    // 超过上限时淘汰最旧的条目
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }

  /** 检查 hash 是否在黑名单中（自动清理过期条目） */
  has(hash: string): boolean {
    const expireAt = this.cache.get(hash);
    if (expireAt === undefined) return false;
    if (Date.now() >= expireAt) {
      // 已过期，清理
      this.cache.delete(hash);
      return false;
    }
    return true;
  }
}

/**
 * Token管理器
 */
export class TokenManager {
  private config: TokenManagerConfig;
  private redis: RedisLike | null;
  /** 内存黑名单缓存：Redis 不可用时的 fallback，也用作 Redis 的本地热缓存 */
  private blacklistCache = new BlacklistLRUCache(10000);

  constructor(config: TokenManagerConfig, redis?: RedisLike) {
    this.config = config;
    this.redis = redis || null;
  }

  /** Refresh Token 使用的密钥（未配置 refreshSecret 时降级使用 secret） */
  private get refreshSecretKey(): string {
    return this.config.refreshSecret || this.config.secret;
  }

  /**
   * 生成访问令牌
   */
  generateAccessToken(user: User): string {
    const payload: Omit<TokenPayload, 'iat' | 'exp'> & { type: string } = {
      userId: user.id,
      username: user.username,
      roles: user.roles,
      department: user.department,
      type: 'access', // 区分 access/refresh token
    };

    return jwt.sign(payload, this.config.secret, {
      expiresIn: this.config.accessTokenExpiresIn as any,
      keyid: 'access-v1',
    });
  }

  /**
   * 生成刷新令牌
   */
  generateRefreshToken(user: User): string {
    const payload = {
      userId: user.id,
      type: 'refresh', // 区分 access/refresh token
    };

    return jwt.sign(payload, this.refreshSecretKey, {
      expiresIn: this.config.refreshTokenExpiresIn as any,
      keyid: 'refresh-v1',
    });
  }

  /**
   * 验证并解析 Access Token
   *
   * @throws Error 如果 Token 无效、过期、在黑名单中，或 type 不是 access
   */
  async verifyToken(token: string): Promise<TokenPayload> {
    // 1. 检查黑名单
    if (await this.isBlacklisted(token)) {
      throw new Error('Token has been revoked');
    }

    // 2. 检查 kid（密钥版本）：存在但不匹配时拒绝，不存在时放行（过渡期兼容旧 token）
    const header = jwt.decode(token, { complete: true });
    if (header?.header?.kid && header.header.kid !== 'access-v1') {
      throw new Error('Token key version not supported');
    }

    // 3. 验证签名和过期
    try {
      const decoded = jwt.verify(token, this.config.secret) as TokenPayload & { type?: string };

      // 4. 强制检查 token type：拒绝 refresh token 当作 access token 使用
      if (decoded.type === 'refresh') {
        throw new Error('Token type mismatch: expected access token');
      }

      return decoded;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new Error('Token has expired');
      }
      if (err instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid token');
      }
      throw err;
    }
  }

  /**
   * 验证刷新令牌
   */
  async verifyRefreshToken(token: string): Promise<{ userId: string }> {
    if (await this.isBlacklisted(token)) {
      throw new Error('Refresh token has been revoked');
    }

    // 检查 kid：存在但不匹配时拒绝，不存在时放行（过渡期兼容旧 token）
    const header = jwt.decode(token, { complete: true });
    if (header?.header?.kid && header.header.kid !== 'refresh-v1') {
      throw new Error('Refresh token key version not supported');
    }

    try {
      const decoded = jwt.verify(token, this.refreshSecretKey) as any;
      if (decoded.type !== 'refresh') {
        throw new Error('Not a refresh token');
      }
      return { userId: decoded.userId };
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        throw new Error('Refresh token has expired');
      }
      if (err instanceof jwt.JsonWebTokenError) {
        throw new Error('Invalid refresh token');
      }
      throw err;
    }
  }

  /**
   * 将 Token 加入黑名单
   * 使用 Token 的 hash 作为 key，剩余有效时间作为 TTL
   * 始终写入内存缓存（确保无 Redis 时登出仍然生效）
   */
  async blacklistToken(token: string): Promise<void> {
    try {
      const decoded = jwt.decode(token) as any;
      if (!decoded || !decoded.exp) return;

      const hash = this.hashToken(token);
      const ttlSec = decoded.exp - Math.floor(Date.now() / 1000);

      if (ttlSec <= 0) return; // Token 已过期，无需加入黑名单

      // 始终写入内存缓存（Redis fallback + 本地热缓存）
      this.blacklistCache.set(hash, ttlSec * 1000);

      // Redis 可用时也写入（持久化 + 多进程共享）
      if (this.redis) {
        try {
          await this.redis.set(`token:blacklist:${hash}`, '1', 'EX', ttlSec);
        } catch {
          // Redis 写入失败时内存缓存仍然有效
        }
      }
    } catch {
      // Token 解析失败，忽略
    }
  }

  /**
   * 检查 Token 是否在黑名单中
   * 优先查内存缓存，命中则直接返回；否则查 Redis 并回填内存
   */
  async isBlacklisted(token: string): Promise<boolean> {
    const hash = this.hashToken(token);

    // 先查内存缓存（快速路径）
    if (this.blacklistCache.has(hash)) return true;

    // 再查 Redis（慢路径，支持多进程同步）
    if (this.redis) {
      try {
        const result = await this.redis.get(`token:blacklist:${hash}`);
        if (result !== null) {
          // 回填内存缓存（使用 2h 默认 TTL，因为无法从 Redis 获取剩余 TTL）
          this.blacklistCache.set(hash, 2 * 60 * 60 * 1000);
          return true;
        }
      } catch {
        // Redis 查询失败时降级为仅内存检查（已在上面完成）
      }
    }

    return false;
  }

  /**
   * 解析过期时间字符串为秒数
   */
  parseExpiresIn(expiresIn: string): number {
    const match = expiresIn.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // 默认1小时

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 3600;
      case 'd': return value * 86400;
      default: return 3600;
    }
  }

  /**
   * 计算 Token 的 SHA256 hash（用于黑名单 key）
   */
  private hashToken(token: string): string {
    // 使用完整 SHA-256（64 字符 hex），避免截断导致碰撞风险
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
