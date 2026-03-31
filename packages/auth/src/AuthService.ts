/**
 * 认证服务 - LDAP认证 + JWT Token + MockLDAP
 * 
 * 支持两种认证模式：
 * 1. LDAP模式（生产环境）- 连接真实 LDAP/AD 服务器
 * 2. Mock模式（开发环境）- 使用内存用户数据，无需 LDAP 服务器
 */

import type { User, LoginResult, LDAPConfig, Role } from './types';
import { DEFAULT_QUOTAS } from './types';
import { TokenManager, type TokenManagerConfig, type RedisLike } from './TokenManager';

/**
 * LDAP 认证返回的用户信息
 */
interface LDAPUserInfo {
  username: string;
  email: string;
  displayName: string;
  department: string;
  dn?: string;
}

/**
 * LDAP 认证提供者接口
 */
export interface LDAPProvider {
  authenticate(username: string, password: string): Promise<LDAPUserInfo>;
}

/**
 * 用户存储接口（数据库抽象）
 */
export interface UserStore {
  findByUsername(username: string): Promise<User | null>;
  findById(userId: string): Promise<User | null>;
  create(user: Omit<User, 'createdAt'> & { ldapDn?: string }): Promise<User>;
  updateLastLogin(userId: string): Promise<void>;
}

/**
 * 认证服务配置
 */
export interface AuthServiceConfig {
  ldap: LDAPConfig;
  jwt: TokenManagerConfig;
  /** 是否使用 Mock LDAP（开发模式） */
  mockLdap?: boolean;
}

/**
 * Mock LDAP 提供者（开发环境用）
 * 
 * 预置用户列表，密码统一为 'password123'
 */
export class MockLDAPProvider implements LDAPProvider {
  private mockUsers: Map<string, LDAPUserInfo> = new Map([
    ['admin', { username: 'admin', email: 'admin@sgcc.com.cn', displayName: '系统管理员', department: '信息中心' }],
    ['zhangsan', { username: 'zhangsan', email: 'zhangsan@sgcc.com.cn', displayName: '张三', department: '调度中心' }],
    ['lisi', { username: 'lisi', email: 'lisi@sgcc.com.cn', displayName: '李四', department: '运维部门' }],
    ['wangwu', { username: 'wangwu', email: 'wangwu@sgcc.com.cn', displayName: '王五', department: '营销部门' }],
    ['zhaoliu', { username: 'zhaoliu', email: 'zhaoliu@sgcc.com.cn', displayName: '赵六', department: '财务部门' }],
  ]);

  /** 用户密码表（默认 password123） */
  private passwords: Map<string, string> = new Map();

  async authenticate(username: string, password: string): Promise<LDAPUserInfo> {
    const user = this.mockUsers.get(username);
    if (!user) {
      throw new Error(`Authentication failed: user '${username}' not found`);
    }
    const expectedPassword = this.passwords.get(username);
    if (!expectedPassword) {
      throw new Error(`Authentication failed: no password configured for '${username}'`);
    }
    // 支持 bcrypt 哈希密码（以 $2a$/$2b$ 开头）和明文密码（向后兼容）
    let passwordValid: boolean;
    if (expectedPassword.startsWith('$2a$') || expectedPassword.startsWith('$2b$')) {
      // bcrypt hashed password — dynamic import to avoid hard dependency
      const bcryptModule = await import('bcryptjs');
      const bcrypt = (bcryptModule as any).default || bcryptModule;
      passwordValid = await bcrypt.compare(password, expectedPassword);
    } else {
      passwordValid = password === expectedPassword;
    }
    if (!passwordValid) {
      throw new Error('Authentication failed: invalid password');
    }
    return { ...user };
  }

  /** 添加 Mock 用户（支持自定义密码） */
  addUser(info: LDAPUserInfo, password?: string): void {
    this.mockUsers.set(info.username, info);
    if (password) {
      this.passwords.set(info.username, password);
    }
  }

  /** 删除 Mock 用户 */
  removeUser(username: string): void {
    this.mockUsers.delete(username);
    this.passwords.delete(username);
  }
}

/**
 * 真实 LDAP 提供者
 */
export class RealLDAPProvider implements LDAPProvider {
  private config: LDAPConfig;

  constructor(config: LDAPConfig) {
    this.config = config;
  }

  async authenticate(username: string, password: string): Promise<LDAPUserInfo> {
    // 动态导入 ldapjs，避免 Mock 模式下也需要安装
    const ldapModule = await import('ldapjs');
    // 兼容 ESM / CJS 两种导入模式
    const ldap = (ldapModule as any).default || ldapModule;
    
    return new Promise((resolve, reject) => {
      const client = ldap.createClient({ url: this.config.url });

      // Step 1: 使用管理员账号绑定
      client.bind(this.config.bindDN, this.config.bindPassword, (bindErr: any) => {
        if (bindErr) {
          client.destroy();
          return reject(new Error(`LDAP bind failed: ${bindErr.message}`));
        }

        // Step 2: 搜索用户（转义特殊字符防止 LDAP 注入）
        const escapedUsername = username.replace(/[\\*()\0/]/g, c => `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
        const filter = this.config.searchFilter.replace('{{username}}', escapedUsername);
        const opts = {
          filter,
          scope: 'sub' as const,
          attributes: ['sAMAccountName', 'mail', 'displayName', 'department', 'dn'],
        };

        client.search(this.config.searchBase, opts, (searchErr: any, res: any) => {
          if (searchErr) {
            client.destroy();
            return reject(new Error(`LDAP search failed: ${searchErr.message}`));
          }

          let userEntry: any = null;

          res.on('searchEntry', (entry: any) => {
            userEntry = entry.pojo;
          });

          res.on('end', () => {
            if (!userEntry) {
              client.destroy();
              return reject(new Error(`Authentication failed: user '${username}' not found`));
            }

            // Step 3: 使用用户凭证验证密码
            const userDn = userEntry.objectName || userEntry.dn;
            client.bind(userDn, password, (authErr: any) => {
              client.destroy();

              if (authErr) {
                return reject(new Error('Authentication failed: invalid password'));
              }

              const attrs = userEntry.attributes || [];
              const getAttr = (name: string) => {
                const attr = attrs.find((a: any) => a.type === name);
                return attr?.values?.[0] || '';
              };

              resolve({
                username: getAttr('sAMAccountName') || username,
                email: getAttr('mail') || `${username}@sgcc.com.cn`,
                displayName: getAttr('displayName') || username,
                department: getAttr('department') || '',
                dn: userDn,
              });
            });
          });

          res.on('error', (err: any) => {
            client.destroy();
            reject(new Error(`LDAP search error: ${err.message}`));
          });
        });
      });
    });
  }
}

/**
 * 内存用户存储（开发/测试用）
 */
export class InMemoryUserStore implements UserStore {
  private users: Map<string, User> = new Map();

  async findByUsername(username: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return null;
  }

  async findById(userId: string): Promise<User | null> {
    return this.users.get(userId) || null;
  }

  async create(userData: Omit<User, 'createdAt'>): Promise<User> {
    const user: User = { ...userData, createdAt: new Date() };
    this.users.set(user.id, user);
    return user;
  }

  async updateLastLogin(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) {
      user.lastLoginAt = new Date();
    }
  }
}

/**
 * 认证服务类
 */
/** 登录失败锁定配置 */
const LOGIN_LOCK_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_SEC = 900; // 15 分钟

export class AuthService {
  private ldapProvider: LDAPProvider;
  private tokenManager: TokenManager;
  private userStore: UserStore;
  private redis: RedisLike | null;
  /** 内存 fallback：username → { count, expiresAt } */
  private loginFailures = new Map<string, { count: number; expiresAt: number }>();

  constructor(
    config: AuthServiceConfig,
    redis?: RedisLike,
    userStore?: UserStore,
  ) {
    // 根据配置选择 LDAP 提供者
    this.ldapProvider = config.mockLdap
      ? new MockLDAPProvider()
      : new RealLDAPProvider(config.ldap);

    this.redis = redis || null;
    this.tokenManager = new TokenManager(config.jwt, redis);
    this.userStore = userStore || new InMemoryUserStore();
  }

  // ---- 登录失败锁定 ----

  private async checkLoginLock(username: string): Promise<boolean> {
    if (this.redis) {
      try {
        const count = await this.redis.get(`login_fail:${username}`);
        return count !== null && parseInt(count) >= LOGIN_LOCK_MAX_ATTEMPTS;
      } catch {
        // Redis 不可用时降级放行，不 fallthrough 到内存（两者数据不同步）
        return false;
      }
    }
    // 无 Redis 时使用内存 fallback
    const entry = this.loginFailures.get(username);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.loginFailures.delete(username);
      return false;
    }
    return entry.count >= LOGIN_LOCK_MAX_ATTEMPTS;
  }

  private async recordLoginFailure(username: string): Promise<void> {
    if (this.redis) {
      try {
        const key = `login_fail:${username}`;
        // 优先使用原子 INCR + EXPIRE，避免 GET+SET 竞态
        if (this.redis.incr && this.redis.expire) {
          await this.redis.incr(key);
          await this.redis.expire(key, LOGIN_LOCK_DURATION_SEC);
        } else {
          const current = await this.redis.get(key);
          const newCount = (current ? parseInt(current) : 0) + 1;
          await this.redis.set(key, String(newCount), 'EX', LOGIN_LOCK_DURATION_SEC);
        }
        return;
      } catch { /* Redis 不可用时降级到内存 */ }
    }
    const entry = this.loginFailures.get(username);
    if (entry && Date.now() <= entry.expiresAt) {
      entry.count++;
      // 不重置 expiresAt，保持固定锁定窗口
    } else {
      const expiresAt = Date.now() + LOGIN_LOCK_DURATION_SEC * 1000;
      this.loginFailures.set(username, { count: 1, expiresAt });
    }
  }

  private async clearLoginFailure(username: string): Promise<void> {
    if (this.redis) {
      try {
        if (this.redis.del) {
          await this.redis.del(`login_fail:${username}`);
        } else {
          await this.redis.set(`login_fail:${username}`, '0', 'EX', 1);
        }
      } catch { /* ignore */ }
    }
    this.loginFailures.delete(username);
  }

  /**
   * 管理员解锁用户（清除登录失败计数）
   */
  async unlockUser(username: string): Promise<void> {
    await this.clearLoginFailure(username);
  }

  /**
   * 用户登录
   */
  async login(username: string, password: string): Promise<LoginResult> {
    // LDAP 注入防护 + userId 格式约束：禁止下划线（会导致 parseSessionKeyUserId 解析错误）
    if (!/^[a-zA-Z0-9.\-]{2,32}$/.test(username)) {
      throw new Error('用户名格式不合法');
    }

    // 登录失败锁定检查（等保 2.0 要求）
    if (await this.checkLoginLock(username)) {
      throw new Error('账户已锁定，请 15 分钟后重试');
    }

    // Step 1: LDAP 认证
    let ldapUser: LDAPUserInfo;
    try {
      ldapUser = await this.ldapProvider.authenticate(username, password);
    } catch (err) {
      await this.recordLoginFailure(username);
      throw err;
    }

    // 认证成功，清除失败计数
    await this.clearLoginFailure(username);

    // Step 2: 获取或创建本地用户
    const user = await this.getOrCreateUser(ldapUser);

    // Step 3: 生成 Token
    const accessToken = this.tokenManager.generateAccessToken(user);
    const refreshToken = this.tokenManager.generateRefreshToken(user);

    // Step 4: 记录登录时间
    await this.userStore.updateLastLogin(user.id);

    return {
      user,
      accessToken,
      refreshToken,
      expiresIn: this.tokenManager.parseExpiresIn(
        process.env.JWT_EXPIRES_IN || '2h'
      ),
    };
  }

  /**
   * 验证 Token 并返回用户信息
   *
   * 如果 InMemoryUserStore 中找不到用户（Gateway 重启后），
   * 则从 JWT payload 重建用户对象并写回 store
   */
  async verifyToken(token: string): Promise<User> {
    const payload = await this.tokenManager.verifyToken(token);
    let user = await this.userStore.findById(payload.userId);

    if (!user) {
      // Gateway 重启后 InMemoryUserStore 丢失数据，从 JWT 恢复
      user = await this.userStore.create({
        id: payload.userId,
        username: payload.username,
        email: `${payload.username}@sgcc.com.cn`,
        department: payload.department || '',
        roles: payload.roles || ['user'],
        quotas: DEFAULT_QUOTAS.default,
        status: 'active',
        lastLoginAt: new Date(),
      });
    }

    if (user.status !== 'active') {
      throw new Error('User account is disabled');
    }
    return user;
  }

  /**
   * 刷新 Token
   */
  async refreshToken(oldRefreshToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const { userId } = await this.tokenManager.verifyRefreshToken(oldRefreshToken);
    const user = await this.userStore.findById(userId);
    if (!user || user.status !== 'active') {
      throw new Error('User not found or disabled');
    }

    // 将旧 refresh token 加入黑名单，防止泄露后被重复使用
    await this.tokenManager.blacklistToken(oldRefreshToken);

    const accessToken = this.tokenManager.generateAccessToken(user);
    const newRefreshToken = this.tokenManager.generateRefreshToken(user);
    return {
      accessToken,
      refreshToken: newRefreshToken,
      expiresIn: this.tokenManager.parseExpiresIn(
        process.env.JWT_EXPIRES_IN || '2h'
      ),
    };
  }

  /**
   * 用户登出（Token 加入黑名单）
   */
  async logout(token: string): Promise<void> {
    await this.tokenManager.blacklistToken(token);
  }

  /**
   * 获取 TokenManager（供外部使用）
   */
  getTokenManager(): TokenManager {
    return this.tokenManager;
  }

  /**
   * 获取或创建本地用户
   * LDAP 认证成功后，在本地数据库查找或创建用户记录
   */
  private async getOrCreateUser(ldapUser: LDAPUserInfo): Promise<User> {
    // 先查找已有用户
    const existing = await this.userStore.findByUsername(ldapUser.username);
    if (existing) return existing;

    // 根据用户名推断角色（可配置化）
    const roles = this.inferRoles(ldapUser);
    const quotaTemplate = roles.includes('admin' as Role) ? 'admin'
      : roles.includes('power_user' as Role) ? 'power_user'
      : 'default';

    // 创建新用户（使用稳定 ID，不加时间戳）
    return this.userStore.create({
      id: `user-${ldapUser.username}`,
      username: ldapUser.username,
      email: ldapUser.email,
      department: ldapUser.department,
      roles,
      quotas: DEFAULT_QUOTAS[quotaTemplate],
      status: 'active',
      lastLoginAt: new Date(),
    });
  }

  /** 管理员用户名列表（可通过环境变量 ADMIN_USERNAMES 配置，逗号分隔） */
  private static ADMIN_USERNAMES: Set<string> = new Set(
    (process.env.ADMIN_USERNAMES || 'admin').split(',').map(s => s.trim()).filter(Boolean),
  );

  /**
   * 根据 LDAP 信息推断用户角色
   * 管理员列表通过环境变量 ADMIN_USERNAMES 配置（默认仅 'admin'）
   * 生产环境应根据 LDAP 组成员关系确定
   */
  private inferRoles(ldapUser: LDAPUserInfo): Role[] {
    // 基于可配置的管理员用户名列表（而非硬编码）
    if (AuthService.ADMIN_USERNAMES.has(ldapUser.username)) {
      return ['admin' as Role];
    }
    // 调度中心 → 高级用户
    if (ldapUser.department === '调度中心') {
      return ['power_user' as Role];
    }
    // 默认普通用户
    return ['user' as Role];
  }
  /**
   * 注册 Mock 用户（仅 Mock LDAP 模式下有效）
   * Admin Console 创建用户时调用，使新用户可以登录
   */
  registerMockUser(info: { username: string; email: string; displayName: string; department: string }, password?: string): boolean {
    if (this.ldapProvider instanceof MockLDAPProvider) {
      this.ldapProvider.addUser(info, password);
      return true;
    }
    return false; // 生产环境 LDAP 不支持动态注册
  }

  /**
   * 从 Mock LDAP 删除用户（仅 Mock LDAP 模式下有效）
   */
  removeMockUser(username: string): boolean {
    if (this.ldapProvider instanceof MockLDAPProvider) {
      this.ldapProvider.removeUser(username);
      return true;
    }
    return false;
  }
}
