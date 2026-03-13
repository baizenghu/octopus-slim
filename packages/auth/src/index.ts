/**
 * Octopus Enterprise - 认证授权模块
 * 
 * 提供 LDAP 认证、JWT Token 管理和 RBAC 权限控制
 * 
 * @example
 * ```typescript
 * import { AuthService, RBACService } from '@octopus/auth';
 * 
 * const auth = new AuthService({
 *   ldap: { url: '...', bindDN: '...', bindPassword: '...', searchBase: '...', searchFilter: '...' },
 *   jwt: { secret: '...', accessTokenExpiresIn: '2h', refreshTokenExpiresIn: '7d' },
 *   mockLdap: process.env.LDAP_MOCK_ENABLED === 'true',
 * });
 * 
 * const result = await auth.login('zhangsan', 'password123');
 * const user = await auth.verifyToken(result.accessToken);
 * 
 * const rbac = new RBACService();
 * rbac.hasPermission(user, Permission.TOOL_BASH);
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

// RBAC
export { RBACService } from './RBACService';

// Token 管理
export { TokenManager } from './TokenManager';
export type { TokenManagerConfig, RedisLike } from './TokenManager';
