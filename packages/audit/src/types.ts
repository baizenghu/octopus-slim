/**
 * 审计日志类型定义
 */

import type { PrismaClient } from '@prisma/client';

/**
 * 审计操作类型
 */
export enum AuditAction {
  // 认证操作
  AUTH_LOGIN = 'auth:login',
  AUTH_LOGOUT = 'auth:logout',
  AUTH_TOKEN_REFRESH = 'auth:token:refresh',
  AUTH_LOGIN_FAILED = 'auth:login:failed',

  // 工具操作
  TOOL_BASH_EXECUTE = 'tool:bash:execute',
  TOOL_FILE_READ = 'tool:file:read',
  TOOL_FILE_WRITE = 'tool:file:write',
  TOOL_WEB_SEARCH = 'tool:web:search',
  TOOL_RAG_SEARCH = 'tool:rag:search',

  // 会话操作
  SESSION_CREATE = 'session:create',
  SESSION_DELETE = 'session:delete',
  SESSION_MESSAGE = 'session:message',

  // 管理操作
  ADMIN_USER_CREATE = 'admin:user:create',
  ADMIN_USER_UPDATE = 'admin:user:update',
  ADMIN_USER_DELETE = 'admin:user:delete',
  ADMIN_PERMISSION_GRANT = 'admin:permission:grant',

  // 数据操作
  DATA_EXPORT = 'data:export',
  DATA_DELETE = 'data:delete',
  DATA_UPLOAD = 'data:upload',

  // 审计自身操作
  AUDIT_QUERY = 'audit:query',
  AUDIT_EXPORT = 'audit:export',
  AUDIT_ARCHIVE = 'audit:archive',
}

/**
 * 审计日志条目（写入用）
 */
export interface AuditLogEntry {
  /** 用户ID */
  userId: string | null;
  /** 用户名 */
  username: string;
  /** 操作类型 */
  action: AuditAction;
  /** 操作资源 */
  resource?: string;
  /** 详细信息 */
  details?: Record<string, unknown>;
  /** IP地址 */
  ipAddress?: string;
  /** User-Agent */
  userAgent?: string;
  /** 是否成功 */
  success?: boolean;
  /** 错误信息 */
  errorMessage?: string;
  /** 操作耗时(ms) */
  durationMs?: number;
}

/**
 * 审计日志记录（查询返回用，包含自动生成字段）
 */
export interface AuditLogRecord extends AuditLogEntry {
  /** 日志ID */
  logId: bigint;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 日志查询过滤条件
 */
export interface AuditQueryFilters {
  userId?: string;
  startTime?: string;
  endTime?: string;
  action?: AuditAction;
  success?: boolean;
  resource?: string;
  /** 分页 - 偏移量 */
  offset?: number;
  /** 分页 - 每页条数 */
  limit?: number;
  /** 排序方式，默认 desc */
  orderBy?: 'asc' | 'desc';
}

/**
 * 分页查询结果
 */
export interface AuditQueryResult {
  data: AuditLogRecord[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * 导出格式
 */
export type AuditExportFormat = 'csv' | 'json';

/**
 * 归档结果
 */
export interface AuditArchiveResult {
  /** 归档的记录数 */
  archivedCount: number;
  /** 归档文件路径 */
  archiveFile: string;
  /** 归档截止日期 */
  beforeDate: Date;
}

/**
 * 审计日志配置
 */
export interface AuditLoggerConfig {
  /** 日志目录 */
  logDir: string;
  /** 保留天数（超过后归档） */
  retentionDays: number;
  /** 是否启用数据库存储 */
  enableDatabase: boolean;
  /** Prisma Client 实例（enableDatabase=true 时必须传入） */
  prisma?: PrismaClient;
}
