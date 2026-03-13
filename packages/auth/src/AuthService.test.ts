/**
 * AuthService + RBACService 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AuthService, MockLDAPProvider, InMemoryUserStore } from '../src/AuthService';
import { RBACService } from '../src/RBACService';
import { Role, Permission } from '../src/types';
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

describe('AuthService (MockLDAP)', () => {
  let authService: AuthService;
  let userStore: InMemoryUserStore;

  beforeEach(() => {
    userStore = new InMemoryUserStore();
    authService = new AuthService(TEST_CONFIG, undefined, userStore);
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      const result = await authService.login('zhangsan', 'password123');

      expect(result.user.username).toBe('zhangsan');
      expect(result.user.department).toBe('调度中心');
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.expiresIn).toBeGreaterThan(0);
    });

    it('should assign ADMIN role to admin user', async () => {
      const result = await authService.login('admin', 'password123');

      expect(result.user.roles).toContain(Role.ADMIN);
    });

    it('should assign POWER_USER role to 调度中心 department', async () => {
      const result = await authService.login('zhangsan', 'password123');

      expect(result.user.roles).toContain(Role.POWER_USER);
    });

    it('should assign USER role to regular users', async () => {
      const result = await authService.login('lisi', 'password123');

      expect(result.user.roles).toContain(Role.USER);
    });

    it('should reject invalid username', async () => {
      await expect(authService.login('nonexistent', 'password123'))
        .rejects.toThrow('not found');
    });

    it('should reject invalid password', async () => {
      await expect(authService.login('zhangsan', 'wrongpassword'))
        .rejects.toThrow('invalid password');
    });

    it('should reuse existing user on second login', async () => {
      const first = await authService.login('lisi', 'password123');
      const second = await authService.login('lisi', 'password123');

      expect(first.user.id).toBe(second.user.id);
    });
  });

  describe('verifyToken', () => {
    it('should verify a valid token and return user', async () => {
      const loginResult = await authService.login('zhangsan', 'password123');
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
      const loginResult = await authService.login('lisi', 'password123');
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
      const loginResult = await authService.login('lisi', 'password123');
      // 没有 Redis 时 logout 应该静默成功
      await expect(authService.logout(loginResult.accessToken)).resolves.not.toThrow();
    });
  });
});

describe('MockLDAPProvider', () => {
  let provider: MockLDAPProvider;

  beforeEach(() => {
    provider = new MockLDAPProvider();
  });

  it('should authenticate preset users', async () => {
    const user = await provider.authenticate('admin', 'password123');
    expect(user.username).toBe('admin');
    expect(user.email).toBe('admin@sgcc.com.cn');
  });

  it('should support adding custom users', async () => {
    provider.addUser({
      username: 'custom',
      email: 'custom@test.com',
      displayName: '自定义用户',
      department: '测试',
    });

    const user = await provider.authenticate('custom', 'password123');
    expect(user.username).toBe('custom');
  });
});

describe('RBACService', () => {
  let rbac: RBACService;
  let authService: AuthService;

  beforeEach(() => {
    rbac = new RBACService();
    authService = new AuthService(TEST_CONFIG);
  });

  describe('hasPermission', () => {
    it('should grant ADMIN all permissions', async () => {
      const { user } = await authService.login('admin', 'password123');

      expect(rbac.hasPermission(user, Permission.TOOL_BASH)).toBe(true);
      expect(rbac.hasPermission(user, Permission.ADMIN_USER_MANAGE)).toBe(true);
      expect(rbac.hasPermission(user, Permission.ADMIN_SYSTEM_CONFIG)).toBe(true);
    });

    it('should grant POWER_USER bash and database', async () => {
      const { user } = await authService.login('zhangsan', 'password123');

      expect(rbac.hasPermission(user, Permission.TOOL_BASH)).toBe(true);
      expect(rbac.hasPermission(user, Permission.TOOL_DATABASE)).toBe(true);
      expect(rbac.hasPermission(user, Permission.ADMIN_USER_MANAGE)).toBe(false);
    });

    it('should restrict USER to basic tools', async () => {
      const { user } = await authService.login('lisi', 'password123');

      expect(rbac.hasPermission(user, Permission.TOOL_FILE_READ)).toBe(true);
      expect(rbac.hasPermission(user, Permission.TOOL_FILE_WRITE)).toBe(true);
      expect(rbac.hasPermission(user, Permission.TOOL_BASH)).toBe(false);
      expect(rbac.hasPermission(user, Permission.TOOL_DATABASE)).toBe(false);
    });
  });

  describe('canAccessResource', () => {
    it('should allow admin to access any resource', async () => {
      const { user } = await authService.login('admin', 'password123');

      expect(rbac.canAccessResource(user, { ownerId: 'other-user' })).toBe(true);
    });

    it('should restrict user to own resources', async () => {
      const { user } = await authService.login('lisi', 'password123');

      expect(rbac.canAccessResource(user, { ownerId: user.id })).toBe(true);
      expect(rbac.canAccessResource(user, { ownerId: 'other-user' })).toBe(false);
    });
  });

  describe('getAllowedTools', () => {
    it('should return bash for power users', async () => {
      const { user } = await authService.login('zhangsan', 'password123');
      const tools = rbac.getAllowedTools(user);

      expect(tools).toContain('bash');
      expect(tools).toContain('database');
    });

    it('should not return bash for regular users', async () => {
      const { user } = await authService.login('lisi', 'password123');
      const tools = rbac.getAllowedTools(user);

      expect(tools).not.toContain('bash');
      expect(tools).not.toContain('database');
    });
  });
});
