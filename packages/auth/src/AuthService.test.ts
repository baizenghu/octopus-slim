/**
 * AuthService 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService, MockLDAPProvider, InMemoryUserStore } from '../src/AuthService';
import { Role } from '../src/types';
import type { AuthServiceConfig } from '../src/AuthService';

const TEST_CONFIG: AuthServiceConfig = {
  ldap: {
    url: 'ldap://localhost:389',
    bindDN: 'cn=admin',
    bindPassword: 'admin',
    searchBase: 'dc=test',
    searchFilter: '(uid={{username}})',
  },
  jwt: {
    secret: 'test-secret-key-at-least-32-characters-long!!',
    accessTokenExpiresIn: '2h',
    refreshTokenExpiresIn: '7d',
  },
  mockLdap: true,
};

/** MockLDAP 无预置用户，测试前需通过 registerMockUser 创建 */
const MOCK_USERS = [
  { username: 'admin', email: 'admin@sgcc.com.cn', displayName: '系统管理员', department: '信息中心' },
  { username: 'zhangsan', email: 'zhangsan@sgcc.com.cn', displayName: '张三', department: '调度中心' },
  { username: 'lisi', email: 'lisi@sgcc.com.cn', displayName: '李四', department: '运维部门' },
];
const MOCK_PASSWORD = 'password123';

describe('AuthService (MockLDAP)', () => {
  let authService: AuthService;
  let userStore: InMemoryUserStore;

  beforeEach(() => {
    userStore = new InMemoryUserStore();
    authService = new AuthService(TEST_CONFIG, undefined, userStore);
    // 注册测试用户（MockLDAP 无预置用户）
    for (const u of MOCK_USERS) {
      authService.registerMockUser(u, MOCK_PASSWORD);
    }
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const result = await authService.login('zhangsan', MOCK_PASSWORD);

      expect(result.user.username).toBe('zhangsan');
      expect(result.user.department).toBe('调度中心');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('should assign ADMIN role to admin user', async () => {
      const result = await authService.login('admin', MOCK_PASSWORD);

      expect(result.user.roles).toContain(Role.ADMIN);
    });

    it('should assign POWER_USER role to 调度中心 department', async () => {
      const result = await authService.login('zhangsan', MOCK_PASSWORD);

      expect(result.user.roles).toContain(Role.POWER_USER);
    });

    it('should assign USER role to regular users', async () => {
      const result = await authService.login('lisi', MOCK_PASSWORD);

      expect(result.user.roles).toContain(Role.USER);
    });

    it('should reject invalid username', async () => {
      await expect(authService.login('nonexistent', MOCK_PASSWORD))
        .rejects.toThrow('not found');
    });

    it('should reject invalid password', async () => {
      await expect(authService.login('zhangsan', 'wrongpassword'))
        .rejects.toThrow('invalid password');
    });

    it('should reuse existing user on second login', async () => {
      const first = await authService.login('lisi', MOCK_PASSWORD);
      const second = await authService.login('lisi', MOCK_PASSWORD);

      expect(first.user.id).toBe(second.user.id);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token and return user', async () => {
      const loginResult = await authService.login('zhangsan', MOCK_PASSWORD);
      const user = await authService.verifyToken(loginResult.accessToken);

      expect(user.username).toBe('zhangsan');
      expect(user.status).toBe('active');
    });

    it('should reject an invalid token', async () => {
      await expect(authService.verifyToken('garbage'))
        .rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should issue a new access token', async () => {
      const loginResult = await authService.login('lisi', MOCK_PASSWORD);
      const refreshed = await authService.refreshToken(loginResult.refreshToken);

      expect(refreshed.accessToken).toBeDefined();
      expect(refreshed.accessToken.split('.')).toHaveLength(3);
      expect(refreshed.expiresIn).toBeGreaterThan(0);

      // 验证新 token 有效
      const user = await authService.verifyToken(refreshed.accessToken);
      expect(user.username).toBe('lisi');
    });
  });

  describe('logout', () => {
    it('should complete without error (no Redis)', async () => {
      const loginResult = await authService.login('lisi', MOCK_PASSWORD);
      await expect(authService.logout(loginResult.accessToken)).resolves.not.toThrow();
    });
  });
});

describe('MockLDAPProvider', () => {
  let provider: MockLDAPProvider;

  beforeEach(() => {
    provider = new MockLDAPProvider();
  });

  it('should reject unknown users', async () => {
    await expect(provider.authenticate('nobody', 'password123'))
      .rejects.toThrow('not found');
  });

  it('should support adding custom users with password', async () => {
    provider.addUser({
      username: 'custom',
      email: 'custom@test.com',
      displayName: '自定义用户',
      department: '测试',
    }, 'mypassword');

    const user = await provider.authenticate('custom', 'mypassword');
    expect(user.username).toBe('custom');
  });

  it('should reject user without password configured', async () => {
    provider.addUser({
      username: 'nopwd',
      email: 'nopwd@test.com',
      displayName: 'No Password',
      department: '测试',
    });

    await expect(provider.authenticate('nopwd', 'anything'))
      .rejects.toThrow('no password configured');
  });
});
