/**
 * Gateway 配置加载
 */

import type { FileCleanupConfig } from '@octopus/workspace';

export interface GatewayConfig {
  /** 服务端口 */
  port: number;
  /** CORS 允许的域 */
  corsOrigins: string[];
  /** JWT 配置 */
  jwt: {
    secret: string;
    refreshSecret: string;
    accessTokenExpiresIn: string;
    refreshTokenExpiresIn: string;
  };
  /** LDAP 配置 */
  ldap: {
    url: string;
    bindDN: string;
    bindPassword: string;
    searchBase: string;
    searchFilter: string;
  };
  /** 是否使用 MockLDAP */
  mockLdap: boolean;
  /** 工作空间配置 */
  workspace: {
    dataRoot: string;
    defaultStorageQuota: number;
  };
  /** AI 模型配置 */
  ai: {
    apiBase: string;
    apiKey: string;
    model: string;
  };
  /** 审计日志配置 */
  audit: {
    logDir: string;
    retentionDays: number;
    enableDatabase: boolean;
  };
  /** Native Octopus Gateway */
  nativeGateway: {
    url: string;
    token: string;
  };
  /** 文件清理配置 */
  cleanup: FileCleanupConfig;
}

import * as path from 'path';

/**
 * 从环境变量加载配置
 */
export function loadConfig(): GatewayConfig {
  // 默认数据目录：项目根目录下的 data/
  const defaultDataRoot = path.resolve(__dirname, '..', '..', '..', 'data');

  return {
    port: parseInt(process.env.GATEWAY_PORT || '18790', 10),
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
    jwt: {
      secret: (() => {
        const s = process.env.JWT_SECRET;
        if (!s || s.length < 32) {
          throw new Error('JWT_SECRET 环境变量未配置或长度不足 32 字符，拒绝启动');
        }
        // 检测常见占位符和弱密钥
        const weakPatterns = ['dev-secret', 'your_jwt', 'change-me', 'secret123', 'password'];
        if (weakPatterns.some(p => s.toLowerCase().includes(p))) {
          throw new Error('JWT_SECRET 疑似占位符或弱密钥，请使用 `openssl rand -base64 64` 生成');
        }
        // 检测低熵（不同字符数过少表示密钥质量差）
        if (new Set(s).size < 10) {
          throw new Error('JWT_SECRET 熵值过低（不同字符数 < 10），请使用随机密钥');
        }
        return s;
      })(),
      refreshSecret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || '',
      accessTokenExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
      refreshTokenExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },
    ldap: {
      url: process.env.LDAP_URL || 'ldap://localhost:389',
      bindDN: process.env.LDAP_BIND_DN || '',
      bindPassword: process.env.LDAP_BIND_PASSWORD || '',
      searchBase: process.env.LDAP_SEARCH_BASE || '',
      searchFilter: process.env.LDAP_SEARCH_FILTER || '(uid={{username}})',
    },
    mockLdap: process.env.LDAP_MOCK_ENABLED === 'true',
    workspace: {
      dataRoot: process.env.DATA_ROOT || defaultDataRoot,
      defaultStorageQuota: parseInt(process.env.DEFAULT_STORAGE_QUOTA || '5', 10),
    },
    ai: {
      apiBase: process.env.OPENAI_API_BASE || '',
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'deepseek-chat',
    },
    audit: {
      logDir: process.env.AUDIT_LOG_DIR || path.join(process.env.DATA_ROOT || defaultDataRoot, 'audit-logs'),
      retentionDays: parseInt(process.env.AUDIT_RETENTION_DAYS || '30', 10),
      enableDatabase: process.env.AUDIT_DB_ENABLED !== 'false',
    },
    nativeGateway: {
      url: process.env.OCTOPUS_GATEWAY_URL || 'ws://127.0.0.1:18791',
      token: process.env.OCTOPUS_GATEWAY_TOKEN || '',
    },
    cleanup: {
      outputRetentionDays: parseInt(process.env.OUTPUT_RETENTION_DAYS || '7', 10),
      tempRetentionHours: parseInt(process.env.TEMP_RETENTION_HOURS || '1', 10),
      cleanupIntervalMinutes: parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '30', 10),
      orphanDetectionEnabled: process.env.ORPHAN_DETECTION_ENABLED !== 'false',
    },
  };
}
