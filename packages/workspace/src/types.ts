/**
 * 工作空间管理类型定义
 */

/**
 * 配额状态
 */
export interface QuotaStatus {
  storage: {
    /** 已使用（字节） */
    used: number;
    /** 配额上限（字节） */
    limit: number;
    /** 使用百分比 */
    percentage: number;
    /** 是否超限 */
    exceeded: boolean;
  };
}

/**
 * 工作空间配置
 */
export interface WorkspaceConfig {
  /** 数据根目录 */
  dataRoot: string;
  /** 默认存储配额（GB） */
  defaultStorageQuota: number;
  /** 模板目录（可选，初始化时复制 AGENTS.md 等文件） */
  templateDir?: string;
}

/**
 * 用户元数据
 */
export interface UserMetadata {
  userId: string;
  username: string;
  displayName?: string;
  department?: string;
  roles: string[];
  quotas: {
    /** 存储配额（GB） */
    storage: number;
  };
  createdAt: string;
  lastActiveAt: string;
}

/**
 * 工作空间目录结构常量
 */
export const WORKSPACE_DIRS = {
  /** 用户工作空间根目录 */
  WORKSPACE: 'workspace',
  /** 会话记录 */
  SESSIONS: 'workspace/sessions',
  /** 用户上传文件 */
  FILES: 'workspace/files',
  /** Agent 生成的输出（用户可下载） */
  OUTPUTS: 'workspace/outputs',
  /** Agent 工作临时目录（中间脚本、临时数据） */
  TEMP: 'workspace/temp',
  /** 用户私有技能（二期） */
  SKILLS: 'workspace/skills',
  /** 用户个人 MCP 脚本 */
  MCP: 'workspace/mcp',
  /** 临时缓存 */
  CACHE: 'cache',
  /** 用户操作日志 */
  LOGS: 'logs',
} as const;

/**
 * 路径验证结果
 */
export interface PathValidationResult {
  /** 是否安全 */
  valid: boolean;
  /** 解析后的安全绝对路径（仅 valid=true 时有值） */
  resolvedPath?: string;
  /** 拒绝原因（仅 valid=false 时有值） */
  reason?: string;
}

/**
 * 文件清理配置
 */
export interface FileCleanupConfig {
  /** outputs/ 文件保留天数（默认 7） */
  outputRetentionDays: number;
  /** temp/ 文件保留小时数（默认 1） */
  tempRetentionHours: number;
  /** 清理扫描间隔（分钟，默认 30） */
  cleanupIntervalMinutes: number;
  /** 孤儿文件检测（每天一次，默认开启） */
  orphanDetectionEnabled: boolean;
}
