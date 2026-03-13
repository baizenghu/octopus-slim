/**
 * 认证授权模块核心类型定义
 */

/**
 * 用户角色枚举
 */
export enum Role {
  /** 系统管理员 - 全部权限 */
  ADMIN = 'admin',
  /** 高级用户 - 可使用高级工具（bash、数据库查询） */
  POWER_USER = 'power_user',
  /** 普通用户 - 基础查询和对话功能 */
  USER = 'user',
  /** 只读用户 - 仅查询知识库 */
  READONLY = 'readonly'
}

/**
 * 权限枚举
 */
export enum Permission {
  // 工具权限
  TOOL_BASH = 'tool:bash',
  TOOL_FILE_READ = 'tool:file:read',
  TOOL_FILE_WRITE = 'tool:file:write',
  TOOL_DATABASE = 'tool:database',
  
  // 管理权限
  ADMIN_USER_MANAGE = 'admin:user:manage',
  ADMIN_SKILL_MANAGE = 'admin:skill:manage',
  ADMIN_AUDIT_VIEW = 'admin:audit:view',
  ADMIN_SYSTEM_CONFIG = 'admin:system:config',
  
  // 数据权限
  DATA_EXPORT = 'data:export',
  DATA_DELETE = 'data:delete'
}

/**
 * 资源配额定义
 */
export interface ResourceQuota {
  /** 存储配额（GB） */
  storage: number;
  /** 每天最大API调用次数 */
  apiCallsPerDay: number;
  /** 每分钟最大API调用次数 */
  apiCallsPerMinute: number;
  /** 最大并发会话数 */
  maxConcurrentSessions: number;
  /** 单次请求最大token数 */
  maxTokensPerRequest: number;
  /** bash命令超时时间（毫秒） */
  bashExecutionTimeoutMs: number;
  /** 单文件大小限制（MB） */
  maxFileSize: number;
}

/**
 * 用户信息
 */
export interface User {
  /** 用户唯一ID */
  id: string;
  /** 用户名 */
  username: string;
  /** 邮箱 */
  email: string;
  /** 部门 */
  department: string;
  /** 角色列表 */
  roles: Role[];
  /** 资源配额 */
  quotas: ResourceQuota;
  /** 账户状态 */
  status: 'active' | 'disabled';
  /** 创建时间 */
  createdAt: Date;
  /** 最后登录时间 */
  lastLoginAt?: Date;
}

/**
 * JWT Token 载荷
 */
export interface TokenPayload {
  /** 用户ID */
  userId: string;
  /** 用户名 */
  username: string;
  /** 角色列表 */
  roles: Role[];
  /** 部门 */
  department: string;
  /** Token 类型（'access' | 'refresh'），用于防止 token 混用 */
  type?: string;
  /** 签发时间 */
  iat: number;
  /** 过期时间 */
  exp: number;
}

/**
 * 登录结果
 */
export interface LoginResult {
  /** 用户信息 */
  user: User;
  /** 访问令牌 */
  accessToken: string;
  /** 刷新令牌 */
  refreshToken: string;
  /** 过期时间（秒） */
  expiresIn: number;
}

/**
 * LDAP 配置
 */
export interface LDAPConfig {
  /** LDAP服务器URL */
  url: string;
  /** 绑定DN */
  bindDN: string;
  /** 绑定密码 */
  bindPassword: string;
  /** 搜索基础DN */
  searchBase: string;
  /** 搜索过滤器模板 */
  searchFilter: string;
}

/**
 * 角色-权限映射表
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.ADMIN]: Object.values(Permission),
  [Role.POWER_USER]: [
    Permission.TOOL_BASH,
    Permission.TOOL_FILE_READ,
    Permission.TOOL_FILE_WRITE,
    Permission.TOOL_DATABASE,
    Permission.DATA_EXPORT
  ],
  [Role.USER]: [
    Permission.TOOL_FILE_READ,
    Permission.TOOL_FILE_WRITE
  ],
  [Role.READONLY]: [
    Permission.TOOL_FILE_READ
  ]
};

/**
 * 默认配额模板
 */
export const DEFAULT_QUOTAS: Record<string, ResourceQuota> = {
  default: {
    storage: 5,
    apiCallsPerDay: 200,
    apiCallsPerMinute: 5,
    maxConcurrentSessions: 2,
    maxTokensPerRequest: 4000,
    bashExecutionTimeoutMs: 30000,
    maxFileSize: 10
  },
  power_user: {
    storage: 20,
    apiCallsPerDay: 1000,
    apiCallsPerMinute: 20,
    maxConcurrentSessions: 5,
    maxTokensPerRequest: 32000,
    bashExecutionTimeoutMs: 300000,
    maxFileSize: 100
  },
  admin: {
    storage: 100,
    apiCallsPerDay: -1,  // 无限制
    apiCallsPerMinute: -1,
    maxConcurrentSessions: 10,
    maxTokensPerRequest: 128000,
    bashExecutionTimeoutMs: 600000,
    maxFileSize: 1000
  }
};
