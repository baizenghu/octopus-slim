/**
 * 工作空间管理器
 *
 * 负责用户工作空间的生命周期管理：
 * - 创建/初始化用户目录结构
 * - 路径安全验证（防路径穿越 + 符号链接检查）
 * - 存储使用量计算
 * - 用户元数据管理
 * - 用户个人 .env 文件管理
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import type {
  QuotaStatus,
  WorkspaceConfig,
  UserMetadata,
  PathValidationResult,
} from './types';
import { WORKSPACE_DIRS } from './types';

/** 用户 .env 模板 */
/**
 * 工作空间管理器
 */
export class WorkspaceManager {
  private config: WorkspaceConfig;

  constructor(config: WorkspaceConfig) {
    this.config = config;
  }

  /**
   * 初始化用户工作空间
   * 创建完整的目录结构 + 元数据文件
   */
  async initWorkspace(userId: string, username: string, meta?: Partial<UserMetadata>): Promise<string> {
    const userRoot = this.getUserRootPath(userId);

    // 如果已存在则跳过
    if (fs.existsSync(userRoot)) {
      return this.getWorkspacePath(userId);
    }

    // 创建所有子目录（mode 0o777: Docker sandbox uid=2000 需要写权限）
    const dirs = Object.values(WORKSPACE_DIRS);
    for (const dir of dirs) {
      const dirPath = path.join(userRoot, dir);
      await fsp.mkdir(dirPath, { recursive: true });
      await fsp.chmod(dirPath, 0o777);
    }
    // 用户根目录也需要可写（sandbox 需要在此创建文件）
    await fsp.chmod(userRoot, 0o777);

    // 写入元数据
    const metadata: UserMetadata = {
      userId,
      username,
      displayName: meta?.displayName || username,
      department: meta?.department || '',
      roles: meta?.roles || ['user'],
      quotas: {
        storage: meta?.quotas?.storage || this.config.defaultStorageQuota,
      },
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    await this.writeMetadata(userId, metadata);

    // 复制模板文件（如果配置了模板目录）
    if (this.config.templateDir && fs.existsSync(this.config.templateDir)) {
      await this.copyTemplates(userId);
    }

    return this.getWorkspacePath(userId);
  }

  /**
   * 获取用户工作空间路径（workspace 子目录）
   */
  getWorkspacePath(userId: string): string {
    return path.join(this.config.dataRoot, 'users', userId, WORKSPACE_DIRS.WORKSPACE);
  }

  /**
   * 获取用户根目录路径
   */
  getUserRootPath(userId: string): string {
    return path.join(this.config.dataRoot, 'users', userId);
  }

  /**
   * 获取用户特定子目录路径
   */
  getSubPath(userId: string, subDir: keyof typeof WORKSPACE_DIRS): string {
    return path.join(this.config.dataRoot, 'users', userId, WORKSPACE_DIRS[subDir]);
  }

  /**
   * 验证文件路径是否在工作空间内（防路径穿越 + 符号链接检查）
   * 
   * 安全策略：
   * 1. 解析相对路径为绝对路径
   * 2. 规范化后检查前缀
   * 3. 检查路径中是否有 .. 分量
   * 4. 如果文件已存在，解析真实路径（防止符号链接逃逸）
   */
  async validatePath(userId: string, filepath: string): Promise<PathValidationResult> {
    const workspaceBase = this.getWorkspacePath(userId);

    // 快速检查：路径中不应包含 null 字节
    if (filepath.includes('\0')) {
      return { valid: false, reason: 'Path contains null bytes' };
    }

    // 解析为绝对路径
    const resolved = path.resolve(workspaceBase, filepath);

    // 规范化路径
    const normalizedBase = path.normalize(workspaceBase) + path.sep;
    const normalizedResolved = path.normalize(resolved);

    // 前缀检查（确保在 workspace 内）
    if (!normalizedResolved.startsWith(normalizedBase) && normalizedResolved !== normalizedBase.slice(0, -1)) {
      return { valid: false, reason: 'Path traversal detected: path is outside workspace' };
    }

    // 如果文件/目录已存在，检查真实路径（防止符号链接逃逸）
    try {
      if (fs.existsSync(resolved)) {
        const realPath = await fsp.realpath(resolved);
        const realBase = await fsp.realpath(workspaceBase);
        if (!realPath.startsWith(realBase + path.sep) && realPath !== realBase) {
          return { valid: false, reason: 'Symlink escape detected: real path is outside workspace' };
        }
      }
    } catch {
      // 文件不存在或权限不足，前缀检查已通过即可
    }

    return { valid: true, resolvedPath: resolved };
  }

  /**
   * 同步版路径验证（不检查符号链接，适用于性能敏感场景）
   */
  validatePathSync(userId: string, filepath: string): string | null {
    const workspaceBase = this.getWorkspacePath(userId);

    if (filepath.includes('\0')) return null;

    const resolved = path.resolve(workspaceBase, filepath);
    const normalizedBase = path.normalize(workspaceBase) + path.sep;
    const normalizedResolved = path.normalize(resolved);

    if (!normalizedResolved.startsWith(normalizedBase) && normalizedResolved !== normalizedBase.slice(0, -1)) {
      return null;
    }

    return resolved;
  }

  /**
   * 计算用户工作空间使用量（字节）
   */
  async calculateUsage(userId: string): Promise<number> {
    const userRoot = this.getUserRootPath(userId);

    if (!fs.existsSync(userRoot)) {
      return 0;
    }

    return this.getDirectorySize(userRoot);
  }

  /**
   * 检查用户配额状态
   */
  async checkQuota(userId: string, customLimitGB?: number): Promise<QuotaStatus> {
    const used = await this.calculateUsage(userId);
    const limitGB = customLimitGB || this.config.defaultStorageQuota;
    const limit = limitGB * 1024 * 1024 * 1024;

    return {
      storage: {
        used,
        limit,
        percentage: limit > 0 ? Math.round((used / limit) * 100) : 0,
        exceeded: used > limit,
      },
    };
  }

  /**
   * 配额拦截：超限时抛出异常，阻止写入操作
   */
  async enforceQuota(userId: string, customLimitGB?: number): Promise<void> {
    const status = await this.checkQuota(userId, customLimitGB);
    if (status.storage.exceeded) {
      const usedMB = Math.round(status.storage.used / 1024 / 1024);
      const limitMB = Math.round(status.storage.limit / 1024 / 1024);
      throw new Error(
        `存储配额已超限（已用 ${usedMB}MB / 限额 ${limitMB}MB），请清理文件后重试`,
      );
    }
  }

  /**
   * 删除用户工作空间
   *
   * ⚠️ 危险操作，建议先备份
   */
  async deleteWorkspace(userId: string): Promise<void> {
    const userRoot = this.getUserRootPath(userId);

    if (!fs.existsSync(userRoot)) {
      return;
    }

    // 安全检查：确保路径在 dataRoot/users/ 下
    const usersBase = path.join(this.config.dataRoot, 'users');
    if (!userRoot.startsWith(usersBase)) {
      throw new Error('Security violation: attempted to delete path outside users directory');
    }

    try {
      await fsp.rm(userRoot, { recursive: true, force: true });
    } catch (err: any) {
      if (err.code === 'EACCES' || err.code === 'EPERM') {
        // sandbox 容器以 root/uid=2000 创建的文件，当前进程无权删除
        // 借助 Docker 容器以 root 身份清理
        const { execFileSync } = await import('child_process');
        try {
          const image = process.env.OCTOPUS_SANDBOX_IMAGE || 'octopus-sandbox:enterprise';
          execFileSync('docker', [
            'run', '--rm', '--user', 'root',
            '-v', `${userRoot}:/target`,
            image,
            'bash', '-c', 'rm -rf /target/* /target/.[!.]*',
          ], { timeout: 15000 });
          // 容器清理了挂载内容，宿主目录本身用 rmdir 清除
          await fsp.rmdir(userRoot).catch(() => {});
        } catch (dockerErr: any) {
          throw new Error(`Workspace cleanup failed (EACCES + Docker fallback failed): ${dockerErr.message}`);
        }
      } else {
        throw err;
      }
    }
  }

  /**
   * 列出所有用户工作空间
   */
  async listWorkspaces(): Promise<string[]> {
    const usersDir = path.join(this.config.dataRoot, 'users');

    if (!fs.existsSync(usersDir)) {
      return [];
    }

    const entries = await fsp.readdir(usersDir, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name);
  }

  /**
   * 读取用户元数据
   */
  async getUserMetadata(userId: string): Promise<UserMetadata | null> {
    const metaPath = path.join(this.getUserRootPath(userId), 'metadata.json');

    try {
      const content = await fsp.readFile(metaPath, 'utf-8');
      return JSON.parse(content) as UserMetadata;
    } catch {
      return null;
    }
  }

  /**
   * 更新用户元数据
   */
  async updateUserMetadata(userId: string, updates: Partial<UserMetadata>): Promise<void> {
    const existing = await this.getUserMetadata(userId);
    if (!existing) {
      throw new Error(`Workspace not found for user: ${userId}`);
    }

    const updated = { ...existing, ...updates, lastActiveAt: new Date().toISOString() };
    await this.writeMetadata(userId, updated);
  }

  /**
   * 更新最后活跃时间
   */
  async touchLastActive(userId: string): Promise<void> {
    await this.updateUserMetadata(userId, {});
  }

  /**
   * 检查工作空间是否已存在
   */
  exists(userId: string): boolean {
    return fs.existsSync(this.getUserRootPath(userId));
  }

  /**
   * 获取专业 Agent 的独立工作空间路径
   * default agent 使用用户主 workspace，专业 agent 使用 agents/{agentName}/workspace/
   */
  getAgentWorkspacePath(userId: string, agentName: string): string {
    return path.join(this.config.dataRoot, 'users', userId, 'agents', agentName, 'workspace');
  }

  /**
   * 初始化专业 Agent 的独立工作空间
   * 创建目录结构 + chmod 0o755（Docker sandbox uid=2000 通过同组获取写权限）
   */
  async initAgentWorkspace(userId: string, agentName: string): Promise<string> {
    const agentWorkspace = this.getAgentWorkspacePath(userId, agentName);
    if (!fs.existsSync(agentWorkspace)) {
      await fsp.mkdir(agentWorkspace, { recursive: true, mode: 0o777 });
    }

    // 创建 outputs 子目录
    const outputsDir = path.join(agentWorkspace, 'outputs');
    if (!fs.existsSync(outputsDir)) {
      await fsp.mkdir(outputsDir, { recursive: true, mode: 0o777 });
    }

    return agentWorkspace;
  }

  /**
   * 删除专业 Agent 的工作空间
   */
  async deleteAgentWorkspace(userId: string, agentName: string): Promise<void> {
    if (agentName === 'default') return;

    const agentDir = path.join(this.config.dataRoot, 'users', userId, 'agents', agentName);

    // 安全检查
    const usersBase = path.join(this.config.dataRoot, 'users');
    if (!agentDir.startsWith(usersBase)) {
      throw new Error('Security violation: attempted to delete path outside users directory');
    }

    if (fs.existsSync(agentDir)) {
      await fsp.rm(agentDir, { recursive: true, force: true });
    }
  }

  /**
   * 确保用户 outputs 目录存在
   * 用于 Skill 执行前保证输出目录可用（兼容早期创建的工作空间）
   */
  async ensureOutputsDir(userId: string): Promise<string> {
    const outputsDir = path.join(
      this.config.dataRoot, 'users', userId, WORKSPACE_DIRS.OUTPUTS,
    );
    if (!fs.existsSync(outputsDir)) {
      await fsp.mkdir(outputsDir, { recursive: true });
      await fsp.chmod(outputsDir, 0o755);
    }
    return outputsDir;
  }

  // ========== 私有方法 ==========

  /**
   * 写入元数据文件
   */
  private async writeMetadata(userId: string, metadata: UserMetadata): Promise<void> {
    const metaPath = path.join(this.getUserRootPath(userId), 'metadata.json');
    await fsp.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  }

  /**
   * 复制模板文件到用户工作空间
   */
  private async copyTemplates(userId: string): Promise<void> {
    if (!this.config.templateDir) return;

    const targetDir = this.getWorkspacePath(userId);
    const entries = await fsp.readdir(this.config.templateDir);

    for (const entry of entries) {
      const src = path.join(this.config.templateDir, entry);
      const dest = path.join(targetDir, entry);
      const stat = await fsp.stat(src);

      if (stat.isFile()) {
        await fsp.copyFile(src, dest);
      }
    }
  }

  /**
   * 递归计算目录大小
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let total = 0;

    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          total += await this.getDirectorySize(fullPath);
        } else if (entry.isFile()) {
          const stat = await fsp.stat(fullPath);
          total += stat.size;
        }
        // 跳过符号链接和其他特殊文件
      }
    } catch {
      // 权限不足或目录不存在
    }

    return total;
  }
}

