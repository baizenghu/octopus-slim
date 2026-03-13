/**
 * Skills 模块类型定义
 *
 * 定义 Skill 的数据结构、作用域、安全扫描报告等。
 * 企业级 Skills 全员共享（只读），个人 Skills 在用户工作空间内隔离。
 */

// ========== 作用域 ==========

/** Skill 作用域 */
export type SkillScope = 'enterprise' | 'personal';

/** Skill 状态 */
export type SkillStatus = 'pending' | 'scanning' | 'approved' | 'rejected' | 'active' | 'disabled';

// ========== Skill 信息 ==========

/** Skill 元数据（来自 SKILL.md frontmatter） */
export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: {
    audience?: string;
    workflow?: string;
    category?: string;
  };
}

/** Skill 完整信息 */
export interface SkillInfo {
  /** 唯一标识 */
  id: string;
  /** Skill 名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 作用域 */
  scope: SkillScope;
  /** 所有者 ID（personal 时为用户 ID，enterprise 时为 null） */
  ownerId: string | null;
  /** 版本 */
  version: string;
  /** 状态 */
  status: SkillStatus;
  /** Skill 文件所在目录（绝对路径） */
  skillPath: string;
  /** 安全扫描报告 */
  scanReport: ScanReport | null;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

// ========== 安全扫描 ==========

/** 扫描严重级别 */
export type ScanSeverity = 'info' | 'warning' | 'critical';

/** 扫描发现项 */
export interface ScanFinding {
  /** 规则 ID */
  ruleId: string;
  /** 严重级别 */
  severity: ScanSeverity;
  /** 描述 */
  message: string;
  /** 文件路径 */
  file: string;
  /** 行号 */
  line?: number;
  /** 匹配的代码片段 */
  snippet?: string;
}

/** 安全扫描报告 */
export interface ScanReport {
  /** Skill ID */
  skillId: string;
  /** 扫描时间 */
  scannedAt: Date;
  /** 是否通过 */
  passed: boolean;
  /** 扫描耗时(ms) */
  duration: number;
  /** 总文件数 */
  totalFiles: number;
  /** 总行数 */
  totalLines: number;
  /** 发现项 */
  findings: ScanFinding[];
  /** 按严重级别统计 */
  summary: {
    info: number;
    warning: number;
    critical: number;
  };
}

// ========== 执行相关 ==========

/** 执行隔离模式 */
export type IsolationMode = 'process' | 'docker';

/** Skill 执行请求 */
export interface SkillExecutionRequest {
  /** Skill ID */
  skillId: string;
  /** 调用用户 ID */
  userId: string;
  /** 脚本相对路径（相对于 Skill 目录） */
  scriptPath: string;
  /** 脚本参数 */
  args: string[];
  /** 超时时间(ms)，默认 30000 */
  timeout?: number;
  /** 隔离模式，默认 process */
  isolationMode?: IsolationMode;
}

/** Skill 执行结果 */
export interface SkillExecutionResult {
  /** 是否成功 */
  success: boolean;
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 执行耗时(ms) */
  duration: number;
  /** 生成的输出文件列表 */
  outputFiles: string[];
}

// ========== 运行时监控 ==========

/** 资源使用指标 */
export interface ResourceMetrics {
  /** CPU 使用率(%) */
  cpuPercent: number;
  /** 内存使用(bytes) */
  memoryBytes: number;
  /** 磁盘写入(bytes) */
  diskWriteBytes: number;
  /** 网络出站(bytes) */
  networkOutBytes: number;
}

/** 资源限制配置 */
export interface ResourceLimits {
  /** CPU 核数限制 */
  cpus: number;
  /** 内存上限(bytes) */
  memoryLimit: number;
  /** 磁盘写入上限(bytes) */
  diskWriteLimit: number;
  /** 是否禁止网络访问 */
  networkDisabled: boolean;
  /** 超时时间(ms) */
  timeout: number;
}

/** 默认资源限制 */
export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  cpus: 0.5,
  memoryLimit: 256 * 1024 * 1024, // 256MB
  diskWriteLimit: 100 * 1024 * 1024, // 100MB
  networkDisabled: true,
  timeout: 30_000, // 30s
};

// ========== 配置 ==========

/** 解释器路径配置 */
export interface InterpreterPaths {
  /** Python 解释器路径（默认 'python3'） */
  python?: string;
  /** Node.js 解释器路径（默认 'node'） */
  node?: string;
  /** Bash 解释器路径（默认 'bash'） */
  bash?: string;
}

/** Skills 模块配置 */
export interface SkillsConfig {
  /** 企业级 Skills 全局目录 */
  globalSkillsDir: string;
  /** 并发执行限制 */
  maxConcurrentExecutions: number;
  /** 默认隔离模式 */
  defaultIsolationMode: IsolationMode;
  /** 默认资源限制 */
  defaultResourceLimits: ResourceLimits;
  /** Docker 镜像（docker 模式时） */
  dockerImage?: string;
  /** 解释器路径配置（process 模式使用） */
  interpreters?: InterpreterPaths;
}

/** 默认配置 */
export const DEFAULT_SKILLS_CONFIG: SkillsConfig = {
  globalSkillsDir: '/opt/octopus-data/system/global-skills',
  maxConcurrentExecutions: 20,
  defaultIsolationMode: 'process',
  defaultResourceLimits: DEFAULT_RESOURCE_LIMITS,
  dockerImage: 'octopus-skill-sandbox:latest',
};
