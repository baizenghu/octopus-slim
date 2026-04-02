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

// ─── 运行时配置（从 octopus.json enterprise 段读取，可在前端 SystemConfig 页配置） ───

export interface RuntimeConfig {
  /** 对话相关 */
  chat: {
    sseHeartbeatIntervalMs: number;
    sessionPrefsTTLMs: number;
    sessionPrefsCleanupIntervalMs: number;
    maxAttachmentSizeBytes: number;
    maxSessionTokensCache: number;
    heartbeatSummaryMaxChars: number;
  };
  /** 上传限制 */
  upload: {
    maxFileSizeBytes: number;
    maxSkillSizeBytes: number;
    maxAvatarSizeBytes: number;
  };
  /** 安全与限流 */
  security: {
    loginFailThreshold: number;
    loginFailWindowMs: number;
    apiRateThreshold: number;
    cleanupIntervalMs: number;
    authCacheTTLMs: number;
    authCacheMaxSize: number;
    rateLimitWindowMs: number;
    rateLimitMax: number;
  };
  /** 引擎交互 */
  engine: {
    port: number;
    configBatchWindowMs: number;
    maxConfigRetries: number;
    agentInitTimeoutMs: number;
  };
  /** IM 相关 */
  im: {
    runTimeoutMs: number;
    bindWindowMs: number;
    bindMaxAttempts: number;
    fileSizeLimitBytes: number;
  };
  /** 调度器 */
  scheduler: {
    defaultHeartbeatDelayMs: number;
  };
  /** 管理面板 */
  admin: {
    maxPageSize: number;
    defaultAuditQueryLimit: number;
    dashboardStatsDays: number;
  };
  /** 文件管理 */
  files: {
    tempLinkExpiryMs: number;
  };
  /** Skills */
  skills: {
    maxSkillMdChars: number;
  };
  /** 异步 Agent 任务 */
  agents: {
    /** 每用户最大并发后台任务数（默认 2） */
    maxAsyncTasksPerUser: number;
    /** 全局最大并发 Coordinator 任务数（默认 5） */
    maxConcurrentCoordinators: number;
    /** 是否在异步任务执行前自动压缩 session 历史（默认 true） */
    compactionEnabled: boolean;
    /** 压缩后保留的最大行数（默认 400） */
    compactionMaxLines: number;
  };
}

const RUNTIME_DEFAULTS: RuntimeConfig = {
  chat: {
    sseHeartbeatIntervalMs: 15_000,
    sessionPrefsTTLMs: 30 * 60 * 1000,
    sessionPrefsCleanupIntervalMs: 5 * 60 * 1000,
    maxAttachmentSizeBytes: 10 * 1024 * 1024,
    maxSessionTokensCache: 2000,
    heartbeatSummaryMaxChars: 2000,
  },
  upload: {
    maxFileSizeBytes: 20 * 1024 * 1024,
    maxSkillSizeBytes: 50 * 1024 * 1024,
    maxAvatarSizeBytes: 2 * 1024 * 1024,
  },
  security: {
    loginFailThreshold: 10,
    loginFailWindowMs: 60 * 1000,
    apiRateThreshold: 200,
    cleanupIntervalMs: 5 * 60 * 1000,
    authCacheTTLMs: 5 * 60 * 1000,
    authCacheMaxSize: 1000,
    rateLimitWindowMs: 60 * 1000,
    rateLimitMax: 20,
  },
  engine: {
    port: 19791,
    configBatchWindowMs: 2000,
    maxConfigRetries: 5,
    agentInitTimeoutMs: 1500,
  },
  im: {
    runTimeoutMs: 30 * 60 * 1000,
    bindWindowMs: 15 * 60 * 1000,
    bindMaxAttempts: 5,
    fileSizeLimitBytes: 10 * 1024 * 1024,
  },
  scheduler: {
    defaultHeartbeatDelayMs: 60_000,
  },
  admin: {
    maxPageSize: 100,
    defaultAuditQueryLimit: 50,
    dashboardStatsDays: 7,
  },
  files: {
    tempLinkExpiryMs: 5 * 60 * 1000,
  },
  skills: {
    maxSkillMdChars: 8000,
  },
  agents: {
    maxAsyncTasksPerUser: 2,
    maxConcurrentCoordinators: 5,
    compactionEnabled: true,
    compactionMaxLines: 400,
  },
};

let _runtimeConfig: RuntimeConfig = { ...RUNTIME_DEFAULTS };

/** 从 octopus.json 的 enterprise 字段初始化运行时配置 */
export function initRuntimeConfig(enterprise?: Record<string, any>): void {
  if (!enterprise) {
    _runtimeConfig = { ...RUNTIME_DEFAULTS };
    return;
  }
  _runtimeConfig = {
    chat: { ...RUNTIME_DEFAULTS.chat, ...enterprise.chat },
    upload: { ...RUNTIME_DEFAULTS.upload, ...enterprise.upload },
    security: { ...RUNTIME_DEFAULTS.security, ...enterprise.security },
    engine: { ...RUNTIME_DEFAULTS.engine, ...enterprise.engine },
    im: { ...RUNTIME_DEFAULTS.im, ...enterprise.im },
    scheduler: { ...RUNTIME_DEFAULTS.scheduler, ...enterprise.scheduler },
    admin: { ...RUNTIME_DEFAULTS.admin, ...enterprise.admin },
    files: { ...RUNTIME_DEFAULTS.files, ...enterprise.files },
    skills: { ...RUNTIME_DEFAULTS.skills, ...enterprise.skills },
    agents: { ...RUNTIME_DEFAULTS.agents, ...enterprise.agents },
  };
}

/** 获取运行时配置 */
export function getRuntimeConfig(): RuntimeConfig {
  return _runtimeConfig;
}

/** 获取默认值（用于前端回显） */
export function getRuntimeDefaults(): RuntimeConfig {
  return RUNTIME_DEFAULTS;
}

// ─── 网关配置（从 .env 加载） ───

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
      refreshSecret: (() => {
        const s = process.env.JWT_REFRESH_SECRET;
        if (!s) throw new Error('JWT_REFRESH_SECRET 环境变量未设置。refresh token 必须使用独立密钥，不能与 JWT_SECRET 相同');
        return s;
      })(),
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
      filesRetentionDays: parseInt(process.env.FILES_RETENTION_DAYS || '30', 10),
      tempRetentionHours: parseInt(process.env.TEMP_RETENTION_HOURS || '1', 10),
      cleanupIntervalMinutes: parseInt(process.env.CLEANUP_INTERVAL_MINUTES || '30', 10),
      orphanDetectionEnabled: process.env.ORPHAN_DETECTION_ENABLED !== 'false',
    },
  };
}
