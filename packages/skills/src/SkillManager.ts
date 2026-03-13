/**
 * SkillManager — Skills 管理编排
 *
 * 负责 Skill 的生命周期管理：
 * - 发现/注册（从目录扫描 SKILL.md）
 * - 安全扫描
 * - 审批流程（仅企业级 Skill）
 * - 启用/禁用
 * - 执行调度
 * - DB 持久化（启动恢复 + 状态同步）
 *
 * 企业级 Skill: globalSkillsDir 下的全局共享 Skills
 * 个人 Skill: 用户 workspace/skills/ 下的个人 Skills
 *
 * 持久化策略：
 * - 内存 Map 作为热缓存，所有读取走内存
 * - 写操作同步到 DB（fire-and-forget，不阻塞调用方）
 * - 启动时 loadFromDb() 从 DB 恢复已审批/已激活的状态
 * - 无 Prisma client 时降级为纯内存模式
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
/**
 * WorkspaceManager 接口（避免跨包 rootDir 冲突）
 * 实际运行时由 @octopus/workspace 注入
 */
interface WorkspaceManager {
  getSubPath(userId: string, subDir: string): string;
  getWorkspacePath(userId: string): string;
  validatePath(userId: string, filepath: string): Promise<{ valid: boolean; resolvedPath?: string; reason?: string }>;
}
import { SkillScanner } from './SkillScanner';
import { SkillExecutor } from './SkillExecutor';
import { SkillMonitor } from './SkillMonitor';
import type {
  SkillInfo,
  SkillScope,
  SkillStatus,
  SkillsConfig,
  SkillExecutionRequest,
  SkillExecutionResult,
  ScanReport,
  SkillMetadata,
} from './types';
import { DEFAULT_SKILLS_CONFIG } from './types';

export class SkillManager {
  private config: SkillsConfig;
  private scanner: SkillScanner;
  private executor: SkillExecutor;
  private monitor: SkillMonitor;
  private workspaceManager: WorkspaceManager;

  /** 内存中的 Skill 注册表（热缓存，读取直接走内存） */
  private registry: Map<string, SkillInfo> = new Map();

  /**
   * Prisma client（可选，用于 DB 持久化）
   * 使用 any 与 Prisma 动态查询交互（CLAUDE.md 允许）
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any | null;

  constructor(
    workspaceManager: WorkspaceManager,
    config?: Partial<SkillsConfig>,
    // Prisma client for DB 持久化（可选，无则降级为纯内存模式）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prismaClient?: any,
  ) {
    this.config = { ...DEFAULT_SKILLS_CONFIG, ...config };
    this.scanner = new SkillScanner();
    this.executor = new SkillExecutor(this.config);
    this.monitor = new SkillMonitor();
    this.workspaceManager = workspaceManager;
    this.db = prismaClient || null;
  }

  // ========== 启动恢复 ==========

  /**
   * 从 DB 恢复 Skill 注册表
   * 应在 discoverEnterpriseSkills/discoverPersonalSkills 之前调用
   * 这样 discover 时可以合并 DB 中的审批/启用状态
   */
  async loadFromDb(): Promise<void> {
    if (!this.db) return;

    try {
      const rows = await this.db.skill.findMany();
      let loaded = 0;

      for (const row of rows) {
        const skillPath = this.resolveSkillPathFromDb(
          row.id,
          row.scope as SkillScope,
          row.ownerId,
        );

        // 只加载文件系统上仍然存在的 skill
        if (!fs.existsSync(skillPath)) {
          console.log(`[SkillManager] DB 中 Skill 目录已不存在，跳过: ${row.id} (${skillPath})`);
          continue;
        }

        const skill: SkillInfo = {
          id: row.id,
          name: row.name,
          description: row.description || '',
          scope: row.scope as SkillScope,
          ownerId: row.ownerId,
          version: row.version || '1.0.0',
          status: row.status as SkillStatus,
          skillPath,
          scanReport: row.scanReport as ScanReport | null,
          enabled: row.enabled,
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
        };

        this.registry.set(skill.id, skill);
        loaded++;
      }

      console.log(`[SkillManager] 从 DB 恢复 ${loaded} 个 Skills（共 ${rows.length} 条记录）`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SkillManager] 从 DB 加载 Skills 失败:`, msg);
    }
  }

  // ========== 发现与注册 ==========

  /**
   * 扫描并注册企业级 Skills（全局目录）
   * 如果已调用 loadFromDb()，会保留 DB 中的审批/启用状态
   */
  async discoverEnterpriseSkills(): Promise<SkillInfo[]> {
    const dir = this.config.globalSkillsDir;
    if (!fs.existsSync(dir)) {
      console.log(`[SkillManager] 企业 Skills 目录不存在: ${dir}`);
      return [];
    }

    const skills: SkillInfo[] = [];
    const entries = await fsp.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(dir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const metadata = await this.parseSkillMd(skillMdPath);

        // 如果已从 DB 恢复，保留 DB 状态，仅更新元数据
        const existing = this.registry.get(entry.name);
        if (existing) {
          existing.name = metadata.name;
          existing.description = metadata.description;
          existing.skillPath = skillDir;
          skills.push(existing);
          continue;
        }

        // 新发现的 skill：创建并持久化
        const skill = this.createSkillInfo(
          entry.name,
          metadata,
          'enterprise',
          null,
          skillDir,
        );

        this.registry.set(skill.id, skill);
        skills.push(skill);

        // 异步持久化到 DB
        void this.persistSkill(skill);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[SkillManager] 解析 Skill 失败 (${entry.name}):`, msg);
      }
    }

    console.log(`[SkillManager] 发现 ${skills.length} 个企业 Skills`);
    return skills;
  }

  /**
   * 扫描并注册用户的个人 Skills
   * 如果已调用 loadFromDb()，会保留 DB 中的激活状态
   */
  async discoverPersonalSkills(userId: string): Promise<SkillInfo[]> {
    const skillsDir = this.workspaceManager.getSubPath(userId, 'SKILLS');
    if (!fs.existsSync(skillsDir)) return [];

    const skills: SkillInfo[] = [];
    const entries = await fsp.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillDir = path.join(skillsDir, entry.name);
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      if (!fs.existsSync(skillMdPath)) continue;

      try {
        const metadata = await this.parseSkillMd(skillMdPath);
        const skillId = `${userId}/${entry.name}`;

        // 如果已从 DB 恢复，保留 DB 状态
        const existing = this.registry.get(skillId);
        if (existing) {
          existing.name = metadata.name;
          existing.description = metadata.description;
          existing.skillPath = skillDir;
          skills.push(existing);
          continue;
        }

        const skill = this.createSkillInfo(
          skillId,
          metadata,
          'personal',
          userId,
          skillDir,
        );

        this.registry.set(skill.id, skill);
        skills.push(skill);

        // 异步持久化到 DB
        void this.persistSkill(skill);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[SkillManager] 解析个人 Skill 失败 (${entry.name}):`, msg);
      }
    }

    return skills;
  }

  // ========== 列出 ==========

  /**
   * 获取用户可用的所有 Skills（企业级 + 个人）
   */
  async listAvailableSkills(userId: string): Promise<SkillInfo[]> {
    const results: SkillInfo[] = [];

    for (const skill of this.registry.values()) {
      // 企业级且已启用 → 所有人可见
      if (skill.scope === 'enterprise' && skill.enabled) {
        results.push(skill);
      }
      // 个人且属于该用户 → 仅本人可见
      if (skill.scope === 'personal' && skill.ownerId === userId) {
        results.push(skill);
      }
    }

    return results;
  }

  /**
   * 获取所有企业级 Skills（Admin 管理用）
   */
  listEnterpriseSkills(): SkillInfo[] {
    return Array.from(this.registry.values())
      .filter(s => s.scope === 'enterprise');
  }

  /**
   * 根据 ID 获取 Skill
   */
  getSkill(skillId: string): SkillInfo | null {
    return this.registry.get(skillId) || null;
  }

  // ========== 安全扫描 ==========

  /**
   * 对 Skill 执行安全扫描
   */
  async scanSkill(skillId: string): Promise<ScanReport> {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill 不存在: ${skillId}`);

    // 更新状态
    skill.status = 'scanning';

    const report = await this.scanner.scan(skillId, skill.skillPath);
    skill.scanReport = report;

    // 根据扫描结果更新状态
    if (report.passed) {
      // 企业级需要审批，个人直接激活
      skill.status = skill.scope === 'enterprise' ? 'pending' : 'active';
      if (skill.scope === 'personal') {
        skill.enabled = true;
      }
    } else {
      skill.status = 'rejected';
    }

    // 持久化扫描结果和状态
    void this.updateSkillInDb(skillId, {
      status: skill.status,
      enabled: skill.enabled,
      scanReport: report ? JSON.parse(JSON.stringify(report)) : null,
    });

    console.log(
      `[SkillManager] 扫描完成: ${skillId} → ${report.passed ? '通过' : '未通过'} ` +
      `(${report.summary.critical} critical, ${report.summary.warning} warning)`,
    );

    return report;
  }

  // ========== 审批（仅企业级） ==========

  /**
   * 审批企业级 Skill
   */
  approveSkill(skillId: string): SkillInfo {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill 不存在: ${skillId}`);
    if (skill.scope !== 'enterprise') throw new Error('仅企业级 Skill 需要审批');
    if (skill.status !== 'pending') throw new Error(`当前状态不允许审批: ${skill.status}`);

    skill.status = 'approved';
    skill.enabled = true;
    skill.updatedAt = new Date();

    // 异步持久化（fire-and-forget）
    void this.updateSkillInDb(skillId, { status: 'approved', enabled: true });

    console.log(`[SkillManager] Skill 已审批通过: ${skillId}`);
    return skill;
  }

  /**
   * 拒绝企业级 Skill
   */
  rejectSkill(skillId: string, reason?: string): SkillInfo {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill 不存在: ${skillId}`);

    skill.status = 'rejected';
    skill.enabled = false;
    skill.updatedAt = new Date();

    // 异步持久化（fire-and-forget）
    void this.updateSkillInDb(skillId, { status: 'rejected', enabled: false });

    console.log(`[SkillManager] Skill 已拒绝: ${skillId}${reason ? ` (${reason})` : ''}`);
    return skill;
  }

  // ========== 启用/禁用 ==========

  enableSkill(skillId: string): void {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill 不存在: ${skillId}`);
    skill.enabled = true;
    skill.updatedAt = new Date();

    void this.updateSkillInDb(skillId, { enabled: true });
  }

  disableSkill(skillId: string): void {
    const skill = this.registry.get(skillId);
    if (!skill) throw new Error(`Skill 不存在: ${skillId}`);
    skill.enabled = false;
    skill.updatedAt = new Date();

    void this.updateSkillInDb(skillId, { enabled: false });
  }

  // ========== 执行 ==========

  /**
   * 执行 Skill 脚本
   */
  async executeSkill(request: SkillExecutionRequest): Promise<SkillExecutionResult> {
    const skill = this.registry.get(request.skillId);
    if (!skill) throw new Error(`Skill 不存在: ${request.skillId}`);
    if (!skill.enabled) throw new Error(`Skill 未启用: ${request.skillId}`);

    // 权限检查
    if (skill.scope === 'personal' && skill.ownerId !== request.userId) {
      throw new Error('无权执行他人的个人 Skill');
    }

    // 确定用户工作空间路径
    const workspacePath = this.workspaceManager.getSubPath(request.userId, 'WORKSPACE');

    console.log(
      `[SkillManager] 执行 Skill: ${request.skillId} ` +
      `(user=${request.userId}, script=${request.scriptPath})`,
    );

    const result = await this.executor.execute(skill, request, workspacePath);

    console.log(
      `[SkillManager] 执行完成: ${request.skillId} → ` +
      `${result.success ? '成功' : '失败'} (${result.duration}ms, ${result.outputFiles.length} files)`,
    );

    return result;
  }

  // ========== DB 持久化（内部方法） ==========

  /**
   * 根据 scope 和 ID 推导 skill 文件目录的绝对路径
   * 企业级: {globalSkillsDir}/{id}/
   * 个人: {workspaceManager.getSubPath(ownerId, 'SKILLS')}/{localName}/
   */
  private resolveSkillPathFromDb(id: string, scope: SkillScope, ownerId: string | null): string {
    if (scope === 'enterprise') {
      return path.join(this.config.globalSkillsDir, id);
    }
    // personal: id 格式为 "{userId}/{dirName}"
    const parts = id.split('/');
    const userId = ownerId || parts[0];
    const dirName = parts.length > 1 ? parts[1] : id;
    return path.join(
      this.workspaceManager.getSubPath(userId, 'SKILLS'),
      dirName,
    );
  }

  /**
   * 将 SkillInfo upsert 到 DB
   */
  private async persistSkill(skill: SkillInfo): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.skill.upsert({
        where: { id: skill.id },
        create: {
          id: skill.id,
          name: skill.name,
          description: skill.description || null,
          scope: skill.scope,
          ownerId: skill.ownerId,
          version: skill.version,
          status: skill.status,
          scanReport: skill.scanReport
            ? JSON.parse(JSON.stringify(skill.scanReport))
            : null,
          enabled: skill.enabled,
        },
        update: {
          name: skill.name,
          description: skill.description || null,
          version: skill.version,
          status: skill.status,
          scanReport: skill.scanReport
            ? JSON.parse(JSON.stringify(skill.scanReport))
            : null,
          enabled: skill.enabled,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SkillManager] DB 持久化失败 (${skill.id}):`, msg);
    }
  }

  /**
   * 更新 DB 中指定 Skill 的字段
   */
  private async updateSkillInDb(skillId: string, data: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await this.db.skill.update({
        where: { id: skillId },
        data,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // P2025: Record not found — skill 可能尚未入库，非致命错误
      console.error(`[SkillManager] DB 更新失败 (${skillId}):`, msg);
    }
  }

  // ========== 内部方法 ==========

  /**
   * 解析 SKILL.md 的 frontmatter
   */
  private async parseSkillMd(filePath: string): Promise<SkillMetadata> {
    const content = await fsp.readFile(filePath, 'utf-8');
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

    if (!fmMatch) {
      return { name: path.basename(path.dirname(filePath)), description: '' };
    }

    const fm = fmMatch[1];
    const metadata: Record<string, string> = {};

    // 简单 YAML 解析（key: value）
    for (const line of fm.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        metadata[match[1]] = match[2].trim();
      }
    }

    return {
      name: metadata.name || path.basename(path.dirname(filePath)),
      description: metadata.description || '',
      license: metadata.license,
      compatibility: metadata.compatibility,
    };
  }

  /**
   * 创建 SkillInfo 对象
   */
  private createSkillInfo(
    id: string,
    metadata: SkillMetadata,
    scope: SkillScope,
    ownerId: string | null,
    skillPath: string,
  ): SkillInfo {
    return {
      id,
      name: metadata.name,
      description: metadata.description,
      scope,
      ownerId,
      version: '1.0.0',
      status: 'active' as SkillStatus,
      skillPath,
      scanReport: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * 获取执行器实例（供外部测试用）
   */
  getExecutor(): SkillExecutor {
    return this.executor;
  }

  /**
   * 获取监控器实例
   */
  getMonitor(): SkillMonitor {
    return this.monitor;
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.monitor.stopAll();
  }
}
