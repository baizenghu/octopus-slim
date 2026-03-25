/**
 * TokenManager 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenManager } from '../src/TokenManager';
import type { User } from '../src/types';
import { Role } from '../src/types';

const TEST_SECRET = 'test-secret-key-at-least-32-characters-long!!';

function createTestUser(overrides?: Partial<User>): User {
  return {
    id: 'user-test-001',
    username: 'testuser',
    email: 'test@sgcc.com.cn',
    department: '测试部门',
    roles: [Role.USER],
    quotas: {
      storage: 5,
      apiCallsPerDay: 200,
      apiCallsPerMinute: 5,
      maxConcurrentSessions: 2,
      maxTokensPerRequest: 4000,
      bashExecutionTimeoutMs: 30000,
      maxFileSize: 10,
    },
    status: 'active',
    createdAt: new Date(),
    ...overrides,
  };
}

describe('TokenManager', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager({
      secret: TEST_SECRET,
      accessTokenExpiresIn: '2h',
      refreshTokenExpiresIn: '7d',
    });
  });

  describe('generateAccessToken', () => {
    it('should generate a valid JWT token', () => {
      const user = createTestUser();
      const token = tokenManager.generateAccessToken(user);
      
      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3); // JWT = header.payload.signature
    });

    it('should include user info in token payload', async () => {
      const user = createTestUser({ id: 'user-abc', username: 'abc' });
      const token = tokenManager.generateAccessToken(user);
      const payload = await tokenManager.verifyToken(token);

      expect(payload.userId).toBe('user-abc');
      expect(payload.username).toBe('abc');
      expect(payload.roles).toEqual([Role.USER]);
      expect(payload.department).toBe('测试部门');
    });
  });

  describe('generateRefreshToken', () => {
    it('should generate a refresh token', () => {
      const user = createTestUser();
      const token = tokenManager.generateRefreshToken(user);
      
      expect(token).toBeDefined();
      expect(token.split('.')).toHaveLength(3);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token', async () => {
      const user = createTestUser();
      const token = tokenManager.generateAccessToken(user);
      const payload = await tokenManager.verifyToken(token);

      expect(payload.userId).toBe('user-test-001');
    });

    it('should reject an invalid token', async () => {
      await expect(tokenManager.verifyToken('invalid-token'))
        .rejects.toThrow('Invalid token');
    });

    it('should reject an expired token', async () => {
      const shortLived = new TokenManager({
        secret: TEST_SECRET,
        accessTokenExpiresIn: '1s',
        refreshTokenExpiresIn: '1s',
      });

      const user = createTestUser();
      const token = shortLived.generateAccessToken(user);

      // 等待过期
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      await expect(shortLived.verifyToken(token))
        .rejects.toThrow('Token has expired');
    });

    it('should reject a token signed with different secret', async () => {
      const otherManager = new TokenManager({
        secret: 'different-secret-key-at-least-32-chars!!',
        accessTokenExpiresIn: '2h',
        refreshTokenExpiresIn: '7d',
      });

      const user = createTestUser();
      const token = otherManager.generateAccessToken(user);

      await expect(tokenManager.verifyToken(token))
        .rejects.toThrow('Invalid token');
    });
  });

  describe('verifyRefreshToken', () => {
    it('should verify a valid refresh token', async () => {
      const user = createTestUser({ id: 'user-xyz' });
      const token = tokenManager.generateRefreshToken(user);
      const result = await tokenManager.verifyRefreshToken(token);

      expect(result.userId).toBe('user-xyz');
    });

    it('should reject an access token as refresh token', async () => {
      const user = createTestUser();
      const accessToken = tokenManager.generateAccessToken(user);

      await expect(tokenManager.verifyRefreshToken(accessToken))
        .rejects.toThrow('Refresh token key version not support');
    });
  });

  describe('blacklist (with Redis)', () => {
    it('should blacklist a token', async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
      };

      const manager = new TokenManager({
        secret: TEST_SECRET,
        accessTokenExpiresIn: '2h',
        refreshTokenExpiresIn: '7d',
      }, mockRedis);

      const user = createTestUser();
      const token = manager.generateAccessToken(user);

      // 加入黑名单
      await manager.blacklistToken(token);
      expect(mockRedis.set).toHaveBeenCalled();
      const setCall = mockRedis.set.mock.calls[0];
      expect(setCall[0]).toMatch(/^token:blacklist:/);
      expect(setCall[1]).toBe('1');
      expect(setCall[2]).toBe('EX');
    });

    it('should reject a blacklisted token', async () => {
      const mockRedis = {
        get: vi.fn().mockResolvedValue('1'),
        set: vi.fn().mockResolvedValue('OK'),
      };

      const manager = new TokenManager({
        secret: TEST_SECRET,
        accessTokenExpiresIn: '2h',
        refreshTokenExpiresIn: '7d',
      }, mockRedis);

      const user = createTestUser();
      const token = manager.generateAccessToken(user);

      await expect(manager.verifyToken(token))
        .rejects.toThrow('Token has been revoked');
    });
  });

  describe('token type enforcement', () => {
    it('should reject a refresh token used as access token', async () => {
      const user = createTestUser();
      const refreshToken = tokenManager.generateRefreshToken(user);

      // refresh token 不能通过 verifyToken（access 验证）
      await expect(tokenManager.verifyToken(refreshToken))
        .rejects.toThrow('Token key version not supported');
    });

    it('should include type=access in access token payload', async () => {
      const user = createTestUser();
      const token = tokenManager.generateAccessToken(user);
      const payload = await tokenManager.verifyToken(token);

      expect((payload as any).type).toBe('access');
    });
  });

  describe('blacklist (memory fallback, no Redis)', () => {
    it('should blacklist token in memory when Redis is not available', async () => {
      // 无 Redis 的 TokenManager
      const manager = new TokenManager({
        secret: TEST_SECRET,
        accessTokenExpiresIn: '2h',
        refreshTokenExpiresIn: '7d',
      });

      const user = createTestUser();
      const token = manager.generateAccessToken(user);

      // 黑名单前可以正常验证
      await expect(manager.verifyToken(token)).resolves.toBeDefined();

      // 加入黑名单
      await manager.blacklistToken(token);

      // 黑名单后应该被拒绝
      await expect(manager.verifyToken(token))
        .rejects.toThrow('Token has been revoked');
    });
  });

  describe('parseExpiresIn', () => {
    it('should parse time strings', () => {
      expect(tokenManager.parseExpiresIn('30s')).toBe(30);
      expect(tokenManager.parseExpiresIn('5m')).toBe(300);
      expect(tokenManager.parseExpiresIn('2h')).toBe(7200);
      expect(tokenManager.parseExpiresIn('7d')).toBe(604800);
    });

    it('should default to 3600 for invalid strings', () => {
      expect(tokenManager.parseExpiresIn('invalid')).toBe(3600);
    });
  });
});
