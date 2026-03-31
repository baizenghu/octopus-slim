/**
 * Octopus Enterprise - 认证授权模块
 *
 * 提供 LDAP 认证、JWT Token 管理
 *
 * @example
 * ```typescript
 * import { AuthService } from '@octopus/auth';
 *
 * const auth = new AuthService({
 *   ldap: { url: '...', bindDN: '...', bindPassword: '...', searchBase: '...', searchFilter: '...' },
 *   jwt: { secret: '...', accessTokenExpiresIn: '2h', refreshTokenExpiresIn: '7d' },
 *   mockLdap: process.env.LDAP_MOCK_ENABLED === 'true',
 * });
 *
 * const result = await auth.login('zhangsan', 'your-password');
 * const user = await auth.verifyToken(result.accessToken);
 * ```
 */

// 类型和常量
export {
  Role,
  Permission,
  ROLE_PERMISSIONS,
  DEFAULT_QUOTAS,
} from './types';
export type {
  User,
  TokenPayload,
  LoginResult,
  LDAPConfig,
  ResourceQuota,
} from './types';

// 认证服务
export { AuthService, MockLDAPProvider, RealLDAPProvider, InMemoryUserStore } from './AuthService';
export type { AuthServiceConfig, LDAPProvider, UserStore } from './AuthService';

// Token 管理
export { TokenManager } from './TokenManager';
export type { TokenManagerConfig, RedisLike } from './TokenManager';
