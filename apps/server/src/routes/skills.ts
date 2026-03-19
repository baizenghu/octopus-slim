/**
 * Skills 管理路由
 *
 * 企业级 Skills（管理员操作）:
 * GET    /api/skills              - 列出技能
 * POST   /api/skills/upload       - 上传 zip 包（自动解压 + 扫描）
 * PUT    /api/skills/:id          - 更新元信息
 * DELETE /api/skills/:id          - 删除技能 + 清理文件
 * POST   /api/skills/:id/scan     - 重新扫描
 * POST   /api/skills/:id/approve  - 审批通过
 * POST   /api/skills/:id/reject   - 审批拒绝
 * PUT    /api/skills/:id/enable   - 启用/禁用
 *
 * 个人 Skills（用户操作）:
 * GET    /api/skills/personal          - 列出个人技能
 * POST   /api/skills/personal/upload   - 上传个人 zip
 * DELETE /api/skills/personal/:id      - 删除个人技能
 *
 * 路径安全策略：
 * - 企业级 Skills 目录：{dataRoot}/skills/
 * - 个人 Skills 目录：{dataRoot}/users/{userId}/workspace/skills/
 */

import * as fs from 'fs';
import * as path from 'path';
import { Router } from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { SkillScanner } from '@octopus/skills';
import type { ScanReport } from '@octopus/skills';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { Prisma } from '@prisma/client';
import type { AppPrismaClient } from '../types/prisma';

export function createSkillsRouter(
  authService: AuthService,
  prisma: AppPrismaClient,
  dataRoot: string,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);
  const scanner = new SkillScanner();

  /** 企业级 Skills 目录 */
  const enterpriseSkillsBase = path.resolve(dataRoot, 'skills');
  /** 用户工作空间基目录 */
  const usersBase = path.resolve(dataRoot, 'users');

  // 确保企业级目录存在
  if (!fs.existsSync(enterpriseSkillsBase)) {
    fs.mkdirSync(enterpriseSkillsBase, { recursive: true });
  }

  // multer 配置 — 临时存储 zip 文件
  const upload = multer({
    dest: path.join(dataRoot, 'tmp'),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype === 'application/zip' ||
          file.mimetype === 'application/x-zip-compressed' ||
          file.originalname.endsWith('.zip')) {
        cb(null, true);
      } else {
        cb(new Error('仅支持 zip 文件'));
      }
    },
  });

  // 管理员权限检查
  const adminOnly = (req: AuthenticatedRequest, res: any, next: any) => {
    const roles = req.user?.roles as string[] | undefined;
    if (!roles?.some((r: string) => r.toLowerCase() === 'admin')) {
      res.status(403).json({ error: '需要管理员权限' });
      return;
    }
    next();
  };

  /**
   * 解压 zip 到目标目录（使用 adm-zip，避免 execSync 命令注入风险）
   */
  function extractZip(zipPath: string, destDir: string): void {
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
  }

  /**
   * 检测技能目录中的依赖结构
   * 返回依赖类型和相关信息，存入 scanReport
   */
  function detectDeps(skillDir: string): { depsType: string; depsInfo: string; whlFiles?: string[] } {
    const depsDir = path.join(skillDir, 'deps');
    const hasNodeModules = fs.existsSync(path.join(skillDir, 'node_modules'));
    const hasPackageJson = fs.existsSync(path.join(skillDir, 'package.json'));

    // 优先检测 deps/*.whl（推荐方式）
    if (fs.existsSync(depsDir)) {
      const whlFiles = fs.readdirSync(depsDir).filter(f => f.endsWith('.whl'));
      if (whlFiles.length > 0) {
        return { depsType: 'python-whl', depsInfo: `检测到 ${whlFiles.length} 个 .whl 依赖包`, whlFiles };
      }
      // deps/ 目录存在但没有 .whl 文件
      const otherFiles = fs.readdirSync(depsDir);
      if (otherFiles.length > 0) {
        return { depsType: 'python-deps-invalid', depsInfo: 'deps/ 目录仅支持 .whl 格式，请使用 pip download 下载 wheel 包' };
      }
    }
    // packages/ 不再支持，引导用户改用 deps/*.whl
    if (fs.existsSync(path.join(skillDir, 'packages'))) {
      return { depsType: 'python-deps-invalid', depsInfo: 'packages/ 格式已废弃，请改用 deps/*.whl。下载命令: pip download -r requirements.txt --platform manylinux2014_x86_64 --python-version 312 --only-binary=:all: -d deps/' };
    }
    if (hasNodeModules) {
      return { depsType: 'node-modules', depsInfo: '已检测到 node_modules/ 目录，Node.js 依赖就绪' };
    }
    if (hasPackageJson && !hasNodeModules) {
      return { depsType: 'node-package-json-only', depsInfo: '检测到 package.json 但缺少 node_modules/，建议 npm install 后重新打包' };
    }
    return { depsType: 'none', depsInfo: '无外部依赖，使用沙箱预装包' };
  }

  /**
   * 解析 SKILL.md frontmatter (YAML)
   */
  function parseSkillMd(skillDir: string): { name?: string; description?: string; version?: string; command?: string; scriptPath?: string } {
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillMdPath)) {
      return {};
    }
    const content = fs.readFileSync(skillMdPath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const result: Record<string, string> = {};
    for (const line of yaml.split('\n')) {
      const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
      if (kv) {
        result[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
      }
    }
    return {
      name: result['name'],
      description: result['description'],
      version: result['version'],
      command: result['command'],
      scriptPath: result['script_path'] || result['scriptPath'] || result['entry'],
    };
  }

  /**
   * 递归删除目录
   */
  function rmDir(dir: string): void {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * 清理临时文件
   */
  function cleanupTmp(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }

  // =============== 企业级 Skills（管理员） ===============

  /**
   * 列出所有 Skills
   * 管理员看全部，普通用户只看已启用企业级 + 自己的个人
   */
  router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const isAdmin = (user.roles as string[])?.some((r: string) => r.toLowerCase() === 'admin');

      let skills;
      if (isAdmin) {
        skills = await prisma.skill.findMany({ orderBy: { createdAt: 'desc' } });
      } else {
        skills = await prisma.skill.findMany({
          where: {
            OR: [
              { scope: 'enterprise', enabled: true, status: 'approved' },
              { scope: 'personal', ownerId: user.id },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      res.json({ data: skills, total: skills.length });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 上传企业级 Skill（管理员）
   * 接收 zip 文件 → 解压 → 扫描 → 入库(pending)
   */
  router.post('/upload', authMiddleware, adminOnly, upload.single('file'), async (req: AuthenticatedRequest, res, next) => {
    const tmpFile = (req as any).file?.path;
    let skillDir = '';

    try {
      if (!tmpFile) {
        res.status(400).json({ error: '请上传 zip 文件' });
        return;
      }

      // 从 body 获取补充信息
      const { name: bodyName, description: bodyDesc, command: bodyCommand, scriptPath: bodyScriptPath } = req.body;

      // 生成 ID 和目标目录
      const skillId = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      skillDir = path.join(enterpriseSkillsBase, skillId);

      // 解压
      await extractZip(tmpFile, skillDir);

      // 检查是否有单层包装目录（zip 内如果只有一个文件夹，进入它）
      const entries = fs.readdirSync(skillDir);
      if (entries.length === 1) {
        const innerPath = path.join(skillDir, entries[0]);
        if (fs.statSync(innerPath).isDirectory()) {
          // 将子目录内容移到 skillDir
          const innerEntries = fs.readdirSync(innerPath);
          for (const e of innerEntries) {
            fs.renameSync(path.join(innerPath, e), path.join(skillDir, e));
          }
          fs.rmdirSync(innerPath);
        }
      }

      // 解析 SKILL.md
      const meta = parseSkillMd(skillDir);

      const finalName = bodyName || meta.name || skillId;
      const finalDesc = bodyDesc || meta.description || null;
      const finalCommand = bodyCommand || meta.command || null;
      const finalScriptPath = bodyScriptPath || meta.scriptPath || null;
      const finalVersion = meta.version || '1.0.0';

      // 依赖检测
      const deps = detectDeps(skillDir);

      // 安全扫描
      let scanReport: ScanReport | null = null;
      try {
        scanReport = await scanner.scan(skillId, skillDir);
      } catch (scanErr: any) {
        console.warn(`[skills] scan error for ${skillId}:`, scanErr.message);
      }

      // 合并依赖信息到 scanReport
      const reportWithDeps = {
        ...(scanReport ? JSON.parse(JSON.stringify(scanReport)) : {}),
        depsType: deps.depsType,
        depsInfo: deps.depsInfo,
      };

      // 写入数据库
      const skill = await prisma.skill.create({
        data: {
          id: skillId,
          name: finalName,
          description: finalDesc,
          scope: 'enterprise',
          ownerId: null,
          version: finalVersion,
          status: 'pending',
          scriptPath: finalScriptPath,
          command: finalCommand,
          scanReport: reportWithDeps,
          enabled: false,
        },
      });

      cleanupTmp(tmpFile);

      // 依赖缺失时给出提示
      const depsWarning = deps.depsType.endsWith('-only') ? deps.depsInfo : undefined;

      res.json({
        message: depsWarning ? `技能已上传，等待审批。⚠️ ${depsWarning}` : '技能已上传，等待审批',
        skill,
        scanReport: reportWithDeps,
      });
    } catch (err) {
      cleanupTmp(tmpFile || '');
      // 清理解压目录（如果入库失败）
      if (skillDir) rmDir(skillDir);
      next(err);
    }
  });

  /**
   * 更新 Skill 元信息（管理员）
   */
  router.put('/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { name, description, command, scriptPath, enabled } = req.body;

      const skill = await prisma.skill.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(command !== undefined && { command }),
          ...(scriptPath !== undefined && { scriptPath }),
          ...(enabled !== undefined && { enabled }),
        },
      });

      res.json({ message: '技能已更新', skill });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: '技能不存在' });
        return;
      }
      next(err);
    }
  });

  /**
   * 删除企业级 Skill（管理员）
   */
  router.delete('/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;

      const existing = await prisma.skill.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '技能不存在' });
        return;
      }

      // 自动清理关联此 Skill 的 agent skillsFilter（admin 可强制删除企业级技能）
      const allAgents = await prisma.agent.findMany({ select: { id: true, name: true, ownerId: true, skillsFilter: true } });
      const referencingAgents = allAgents.filter((a: any) => {
        const filter = a.skillsFilter as string[] | null;
        return Array.isArray(filter) && (filter.includes(id) || filter.includes(existing.name));
      });
      for (const agent of referencingAgents) {
        const filter = (agent.skillsFilter as string[]).filter(
          (s: string) => s !== id && s !== existing.name,
        );
        await prisma.agent.update({
          where: { id: agent.id },
          data: { skillsFilter: filter.length > 0 ? filter : Prisma.JsonNull },
        });
      }

      // 删除数据库记录
      await prisma.skill.delete({ where: { id } });

      // 清理文件目录
      const skillDir = existing.scope === 'enterprise'
        ? path.join(enterpriseSkillsBase, id)
        : path.join(usersBase, existing.ownerId || '', 'workspace', 'skills', id);
      rmDir(skillDir);

      res.json({ message: '技能已删除' });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: '技能不存在' });
        return;
      }
      next(err);
    }
  });

  /**
   * 重新扫描 Skill
   */
  router.post('/:id/scan', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;

      const existing = await prisma.skill.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '技能不存在' });
        return;
      }

      const skillDir = existing.scope === 'enterprise'
        ? path.join(enterpriseSkillsBase, id)
        : path.join(usersBase, existing.ownerId || '', 'workspace', 'skills', id);

      if (!fs.existsSync(skillDir)) {
        res.status(400).json({ error: '技能目录不存在，请重新上传' });
        return;
      }

      const scanReport = await scanner.scan(id, skillDir);

      await prisma.skill.update({
        where: { id },
        data: {
          scanReport: JSON.parse(JSON.stringify(scanReport)),
          status: scanReport.passed ? 'pending' : 'rejected',
        },
      });

      res.json({ message: '扫描完成', scanReport });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 审批通过（管理员）
   */
  router.post('/:id/approve', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;

      const existing = await prisma.skill.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '技能不存在' });
        return;
      }
      if (existing.status !== 'pending') {
        res.status(400).json({ error: `当前状态为 ${existing.status}，仅 pending 状态可审批` });
        return;
      }

      const skill = await prisma.skill.update({
        where: { id },
        data: { status: 'approved', enabled: true },
      });

      res.json({ message: '技能已审批通过', skill });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 审批拒绝（管理员）
   */
  router.post('/:id/reject', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const existing = await prisma.skill.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '技能不存在' });
        return;
      }

      const skill = await prisma.skill.update({
        where: { id },
        data: {
          status: 'rejected',
          enabled: false,
          // 将拒绝原因存入 scanReport 的 rejectReason 字段
          scanReport: {
            ...(existing.scanReport as any || {}),
            rejectReason: reason || '管理员拒绝',
          },
        },
      });

      res.json({ message: '技能已拒绝', skill });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 启用/禁用 Skill（管理员）
   */
  router.put('/:id/enable', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled 参数必须为 boolean' });
        return;
      }

      const skill = await prisma.skill.update({
        where: { id },
        data: { enabled },
      });

      res.json({ message: enabled ? '技能已启用' : '技能已禁用', skill });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: '技能不存在' });
        return;
      }
      next(err);
    }
  });

  // =============== 个人 Skills ===============

  /**
   * 列出当前用户的个人 Skills
   */
  router.get('/personal', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const skills = await prisma.skill.findMany({
        where: { scope: 'personal', ownerId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ data: skills, total: skills.length });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 上传个人 Skill
   */
  router.post('/personal/upload', authMiddleware, upload.single('file'), async (req: AuthenticatedRequest, res, next) => {
    const tmpFile = (req as any).file?.path;
    let skillDir = '';

    try {
      const user = req.user!;

      if (!tmpFile) {
        res.status(400).json({ error: '请上传 zip 文件' });
        return;
      }

      const { name: bodyName, description: bodyDesc, command: bodyCommand, scriptPath: bodyScriptPath } = req.body;

      const skillId = `skill-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const userSkillsBase = path.join(usersBase, user.id, 'workspace', 'skills');
      skillDir = path.join(userSkillsBase, skillId);

      // 确保用户 skills 目录存在
      if (!fs.existsSync(userSkillsBase)) {
        fs.mkdirSync(userSkillsBase, { recursive: true });
      }

      // 解压
      await extractZip(tmpFile, skillDir);

      // 检查单层包装目录
      const entries = fs.readdirSync(skillDir);
      if (entries.length === 1) {
        const innerPath = path.join(skillDir, entries[0]);
        if (fs.statSync(innerPath).isDirectory()) {
          const innerEntries = fs.readdirSync(innerPath);
          for (const e of innerEntries) {
            fs.renameSync(path.join(innerPath, e), path.join(skillDir, e));
          }
          fs.rmdirSync(innerPath);
        }
      }

      // 解析 SKILL.md
      const meta = parseSkillMd(skillDir);

      const finalName = bodyName || meta.name || skillId;
      const finalDesc = bodyDesc || meta.description || null;
      const finalCommand = bodyCommand || meta.command || null;
      const finalScriptPath = bodyScriptPath || meta.scriptPath || null;
      const finalVersion = meta.version || '1.0.0';

      // 依赖检测
      const deps = detectDeps(skillDir);

      // 安全扫描
      let scanReport: ScanReport | null = null;
      try {
        scanReport = await scanner.scan(skillId, skillDir);
      } catch (scanErr: any) {
        console.warn(`[skills] scan error for ${skillId}:`, scanErr.message);
      }

      // 个人 Skill：将 deps/*.whl 安装到共享 venv
      if (deps.depsType === 'python-whl') {
        const venvPip = path.resolve(dataRoot, 'skills', '.venv', 'bin', 'pip');
        if (fs.existsSync(venvPip)) {
          try {
            const depsDir = path.join(skillDir, 'deps');
            console.log(`[skills] Installing ${deps.whlFiles!.length} .whl packages to shared venv for ${skillId}...`);
            const { execSync } = await import('child_process');
            execSync(`${venvPip} install "${depsDir}/"*.whl --quiet --disable-pip-version-check --no-deps`, {
              timeout: 120000,
              stdio: 'pipe',
            });
            deps.depsType = 'python-shared-venv';
            deps.depsInfo = `${deps.whlFiles!.length} 个 .whl 包已安装到共享虚拟环境`;
            console.log(`[skills] .whl packages installed for ${skillId}`);
          } catch (installErr: any) {
            console.warn(`[skills] .whl install failed for ${skillId}:`, installErr.message);
            deps.depsInfo = `安装失败: ${installErr.stderr?.toString().slice(-200) || installErr.message}。请检查 .whl 文件是否匹配服务器平台 (Linux x86_64, Python 3.12)`;
          }
        } else {
          deps.depsInfo = '共享虚拟环境未就绪 (data/skills/.venv)，.whl 包未安装';
        }
      }

      // 合并依赖信息到 scanReport
      const reportWithDeps = {
        ...(scanReport ? JSON.parse(JSON.stringify(scanReport)) : {}),
        depsType: deps.depsType,
        depsInfo: deps.depsInfo,
      };

      // 个人 Skill: 扫描通过直接 active，不通过 rejected
      const status = scanReport?.passed !== false ? 'active' : 'rejected';
      const enabled = status === 'active';

      const skill = await prisma.skill.create({
        data: {
          id: skillId,
          name: finalName,
          description: finalDesc,
          scope: 'personal',
          ownerId: user.id,
          version: finalVersion,
          status,
          scriptPath: finalScriptPath,
          command: finalCommand,
          scanReport: reportWithDeps,
          enabled,
        },
      });

      cleanupTmp(tmpFile);

      // 依赖缺失时给出提示
      const depsWarning = deps.depsType.endsWith('-only') ? deps.depsInfo : undefined;
      let msg = status === 'active' ? '个人技能已上传并启用' : '个人技能上传成功但安全扫描未通过';
      if (depsWarning) msg += `。⚠️ ${depsWarning}`;

      res.json({
        message: msg,
        skill,
        scanReport: reportWithDeps,
      });
    } catch (err) {
      cleanupTmp(tmpFile || '');
      if (skillDir) rmDir(skillDir);
      next(err);
    }
  });

  /**
   * 删除个人 Skill
   */
  router.delete('/personal/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const existing = await prisma.skill.findUnique({ where: { id } });
      if (!existing || existing.ownerId !== user.id) {
        res.status(404).json({ error: '个人技能不存在' });
        return;
      }

      // 引用完整性检查：检查该用户是否有 agent 关联了此 Skill
      const userAgents = await prisma.agent.findMany({
        where: { ownerId: user.id },
        select: { name: true, skillsFilter: true },
      });
      const referencingAgents = userAgents.filter((a: any) => {
        const filter = a.skillsFilter as string[] | null;
        return Array.isArray(filter) && (filter.includes(id) || filter.includes(existing.name));
      });
      if (referencingAgents.length > 0) {
        const names = referencingAgents.map((a: any) => a.name).join(', ');
        res.status(409).json({ error: `无法删除：以下 Agent 仍在使用此技能：${names}。请先取消关联后再删除。` });
        return;
      }

      await prisma.skill.delete({ where: { id } });

      // 清理文件
      const skillDir = path.join(usersBase, user.id, 'workspace', 'skills', id);
      rmDir(skillDir);

      res.json({ message: '个人技能已删除' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
