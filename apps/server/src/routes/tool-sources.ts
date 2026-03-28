/**
 * Tool Sources 统一路由 — 合并 MCP + Skill 管理
 *
 * 企业级（管理员）:
 * GET    /api/tool-sources               - 列表（支持 ?type=mcp|skill 筛选）
 * POST   /api/tool-sources               - 创建（type 决定 MCP 还是 Skill）
 * POST   /api/tool-sources/upload         - 上传 Skill zip / MCP Python 项目
 * PUT    /api/tool-sources/:id            - 更新
 * DELETE /api/tool-sources/:id            - 删除
 * POST   /api/tool-sources/:id/test       - 测试 MCP 连接
 * POST   /api/tool-sources/:id/scan       - 扫描（Skill 安全扫描 / MCP 工具发现）
 * POST   /api/tool-sources/:id/approve    - 审批通过（仅 Skill）
 * POST   /api/tool-sources/:id/reject     - 审批拒绝（仅 Skill）
 * PUT    /api/tool-sources/:id/enable     - 启用/禁用
 *
 * 个人级:
 * GET    /api/tool-sources/personal            - 列出个人工具源
 * POST   /api/tool-sources/personal            - 创建个人 MCP
 * POST   /api/tool-sources/personal/upload     - 上传个人 Skill zip / MCP 项目
 * PUT    /api/tool-sources/personal/:id        - 更新个人工具源
 * DELETE /api/tool-sources/personal/:id        - 删除个人工具源
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Router } from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import { MCPRegistry, MCPExecutor, MCPSandbox } from '@octopus/mcp';
import type { MCPServerConfig } from '@octopus/mcp';
import { SkillScanner } from '@octopus/skills';
import type { ScanReport } from '@octopus/skills';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, adminOnly, isAdmin, type AuthenticatedRequest } from '../middleware/auth';
import type { AppPrismaClient } from '../types/prisma';
import { validateMcpUrl } from '../utils/url-validator';
import { getRuntimeConfig } from '../config';
import { invalidatePromptCache } from '../services/SystemPromptBuilder';
import { skillDirName, skillMdName, mcpDirName } from '../utils/skill-naming';
import { mergeSkillMd, generateSkillMd } from '../utils/skill-md-generator';
import { createLogger } from '../utils/logger';

const logger = createLogger('tool-sources');
const execFileAsync = promisify(execFile);

// ─── ToolSource row type (mirrors Prisma model) ─────────────────────────────

interface ToolSourceRow {
  id: string;
  name: string;
  type: string;           // 'mcp' | 'skill'
  enabled: boolean;
  scope: string;          // 'enterprise' | 'personal'
  ownerId: string | null;
  // MCP fields
  transport: string | null;
  command: string | null;
  args: unknown;
  url: string | null;
  env: unknown;
  // Skill fields
  scriptPath: string | null;
  runtime: string | null;
  // Common
  description: string | null;
  tools: unknown;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** ToolSource row → MCPServerConfig (for MCP type only) */
function toMCPConfig(row: ToolSourceRow): MCPServerConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    scope: row.scope as 'enterprise' | 'personal',
    ownerId: row.ownerId,
    transport: (row.transport || 'stdio') as 'stdio' | 'http',
    command: row.command || undefined,
    args: row.args as string[] | undefined,
    url: row.url || undefined,
    env: row.env as Record<string, string> | undefined,
    enabled: row.enabled,
    createdAt: row.createdAt,
  };
}

// ─── Router Factory ──────────────────────────────────────────────────────────

export function createToolSourcesRouter(
  authService: AuthService,
  prisma: AppPrismaClient,
  mcpRegistry: MCPRegistry,
  mcpExecutor: MCPExecutor,
  dataRoot: string,
  bridge?: import('../services/EngineAdapter').EngineAdapter,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);
  const sandbox = new MCPSandbox();
  const scanner = new SkillScanner();

  /** 企业级 MCP/Skills 基目录 */
  const enterpriseMcpBase = path.resolve(dataRoot, 'mcp-servers');
  const enterpriseSkillsBase = path.resolve(dataRoot, 'skills');
  const usersBase = path.resolve(dataRoot, 'users');

  // 确保目录存在
  for (const dir of [enterpriseSkillsBase]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  // ─── 信号通知 ───

  /** 通知 enterprise-mcp plugin 刷新工具注册表 */
  function notifyMCPRegistryChanged(): void {
    const signalPath = path.resolve(
      process.env['OCTOPUS_STATE_DIR'] || path.join(process.env['HOME'] || '/home/baizh', '.octopus-enterprise'),
      'mcp-refresh-signal',
    );
    try {
      fs.writeFileSync(signalPath, Date.now().toString());
    } catch (err: unknown) {
      logger.warn('Failed to write refresh signal', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** 同步 Skill 启用状态到引擎 */
  async function syncSkillEnabledToEngine(skillKey: string, enabled: boolean) {
    if (!bridge) return;
    try {
      await bridge.configApply({ skills: { entries: { [skillKey]: { enabled } } } });
      logger.info('Synced skill to engine', { skillKey, enabled });
    } catch (e: unknown) {
      logger.warn('Failed to sync skill to engine', { skillKey, error: (e as Error).message });
    }
  }

  // ─── MCP multer: Python 项目上传 ───

  const mcpUploadDir = path.join(os.tmpdir(), 'octopus-mcp-uploads');
  fs.mkdirSync(mcpUploadDir, { recursive: true });
  const mcpUpload = multer({
    dest: mcpUploadDir,
    limits: { fileSize: 200 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.zip' || ext === '.gz' || file.originalname.endsWith('.tar.gz')) {
        cb(null, true);
      } else {
        cb(new Error('仅支持 .tar.gz 或 .zip 格式'));
      }
    },
  });

  // ─── Skill multer: zip 上传 ───

  const skillUpload = multer({
    dest: path.join(dataRoot, 'tmp'),
    limits: { fileSize: getRuntimeConfig().upload.maxSkillSizeBytes },
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

  // ─── Skill helpers ───

  function extractZip(zipPath: string, destDir: string): void {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(destDir, true);
  }

  function detectDeps(skillDir: string): { depsType: string; depsInfo: string; whlFiles?: string[] } {
    const depsDir = path.join(skillDir, 'deps');
    const hasNodeModules = fs.existsSync(path.join(skillDir, 'node_modules'));
    const hasPackageJson = fs.existsSync(path.join(skillDir, 'package.json'));

    if (fs.existsSync(depsDir)) {
      const whlFiles = fs.readdirSync(depsDir).filter(f => f.endsWith('.whl'));
      if (whlFiles.length > 0) {
        return { depsType: 'python-whl', depsInfo: `检测到 ${whlFiles.length} 个 .whl 依赖包`, whlFiles };
      }
      const otherFiles = fs.readdirSync(depsDir);
      if (otherFiles.length > 0) {
        return { depsType: 'python-deps-invalid', depsInfo: 'deps/ 目录仅支持 .whl 格式' };
      }
    }
    if (fs.existsSync(path.join(skillDir, 'packages'))) {
      return { depsType: 'python-deps-invalid', depsInfo: 'packages/ 格式已废弃，请改用 deps/*.whl' };
    }
    if (hasNodeModules) {
      return { depsType: 'node-modules', depsInfo: '已检测到 node_modules/ 目录' };
    }
    if (hasPackageJson && !hasNodeModules) {
      return { depsType: 'node-package-json-only', depsInfo: '检测到 package.json 但缺少 node_modules/' };
    }
    return { depsType: 'none', depsInfo: '无外部依赖' };
  }

  function parseSkillMd(skillDir: string): { name?: string; description?: string; version?: string; command?: string; scriptPath?: string } {
    const mdPath = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(mdPath)) return {};
    const content = fs.readFileSync(mdPath, 'utf-8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};

    const yaml = match[1];
    const result: Record<string, string> = {};
    for (const line of yaml.split('\n')) {
      const kv = line.match(/^(\w+)\s*:\s*(.+)$/);
      if (kv) result[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, '');
    }
    return {
      name: result['name'],
      description: result['description'],
      version: result['version'],
      command: result['command'],
      scriptPath: result['script_path'] || result['scriptPath'] || result['entry'],
    };
  }

  function rmDir(dir: string): void {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }

  function cleanupTmp(filePath: string): void {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  /** 安装 .whl 到共享 venv */
  async function installWhlToSharedVenv(skillDir: string, deps: { depsType: string; depsInfo: string; whlFiles?: string[] }, skillId: string) {
    if (deps.depsType !== 'python-whl') return;
    const venvPip = path.resolve(dataRoot, 'skills', '.venv', 'bin', 'pip');
    if (!fs.existsSync(venvPip)) {
      deps.depsInfo = '共享虚拟环境未就绪 (data/skills/.venv)';
      return;
    }
    try {
      const depsDir = path.join(skillDir, 'deps');
      logger.info('Installing .whl packages', { count: deps.whlFiles!.length, skillId });
      const { execFileSync } = await import('child_process');
      const whlFiles = fs.readdirSync(depsDir).filter(f => f.endsWith('.whl')).map(f => path.join(depsDir, f));
      if (whlFiles.length === 0) {
        deps.depsInfo = 'deps 目录中没有 .whl 文件';
        return;
      }
      execFileSync(venvPip, ['install', ...whlFiles, '--quiet', '--disable-pip-version-check', '--no-deps'], {
        timeout: 120000, stdio: 'pipe',
      });
      deps.depsType = 'python-shared-venv';
      deps.depsInfo = `${deps.whlFiles!.length} 个 .whl 包已安装到共享虚拟环境`;
    } catch (err: unknown) {
      const errMsg = (err as Error).message;
      const errStderr = (err as { stderr?: Buffer }).stderr;
      logger.warn('.whl install failed', { skillId, error: errMsg });
      deps.depsInfo = `安装失败: ${errStderr?.toString().slice(-200) || errMsg}`;
    }
  }

  /** 将 zip 解压并处理单层包装目录 */
  function extractAndUnwrap(zipPath: string, destDir: string): void {
    extractZip(zipPath, destDir);
    const entries = fs.readdirSync(destDir);
    if (entries.length === 1) {
      const innerPath = path.join(destDir, entries[0]);
      if (fs.statSync(innerPath).isDirectory()) {
        for (const e of fs.readdirSync(innerPath)) {
          fs.renameSync(path.join(innerPath, e), path.join(destDir, e));
        }
        fs.rmdirSync(innerPath);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  企业级路由（管理员）
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET / — 列出工具源
   * ?type=mcp|skill  筛选类型
   * 管理员看全部，普通用户只看已启用企业级 + 自己的个人
   */
  router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const typeFilter = req.query['type'] as string | undefined;
      const userIsAdmin = isAdmin(user);

      const whereType = typeFilter ? { type: typeFilter } : {};

      let sources;
      if (userIsAdmin) {
        sources = await prisma.toolSource.findMany({
          where: { ...whereType },
          orderBy: { createdAt: 'desc' },
        });
      } else {
        sources = await prisma.toolSource.findMany({
          where: {
            ...whereType,
            OR: [
              { scope: 'enterprise', enabled: true },
              { scope: 'personal', ownerId: user.id },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      // 将 config 中的 skill 字段提取到顶层（前端 SkillInfo 期望 version/status/scanReport 在顶层）
      const data = sources.map((s: any) => {
        const cfg = s.config as Record<string, unknown> | null;
        return {
          ...s,
          version: cfg?.version ?? null,
          status: cfg?.status ?? (s.enabled ? 'active' : 'pending'),
          scanReport: cfg?.scanReport ?? null,
          // skill 的 command 存在 config 中，mcp 的 command 在顶层，不覆盖
          ...(s.type === 'skill' ? { command: cfg?.command ?? null } : {}),
        };
      });
      res.json({ data, total: data.length });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST / — 创建工具源（管理员）
   * body.type = 'mcp' | 'skill'
   */
  router.post('/', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { type, name, description, scope, enabled,
        // MCP fields
        transport, command, args, url, env,
        // Skill fields
        scriptPath, runtime,
      } = req.body;

      if (!name || !type) {
        res.status(400).json({ error: 'name 和 type 为必填' });
        return;
      }

      if (type === 'mcp') {
        // MCP 特定校验
        if (!transport) {
          res.status(400).json({ error: 'MCP 类型需要 transport 字段' });
          return;
        }
        if (transport === 'stdio' && !command) {
          res.status(400).json({ error: 'stdio 模式需要 command' });
          return;
        }
        // 路径安全
        if (transport === 'stdio' && args && args.length > 0) {
          const tempConfig: MCPServerConfig = {
            id: 'temp', name, scope: 'enterprise', ownerId: null,
            transport, command, args, enabled: true, createdAt: new Date(),
          };
          const pathError = sandbox.validatePaths(tempConfig, enterpriseMcpBase);
          if (pathError) {
            res.status(400).json({ error: `路径安全校验失败: ${pathError}` });
            return;
          }
        }
        // SSRF 防护
        if (transport === 'http' && url) {
          const check = validateMcpUrl(url);
          if (!check.valid) {
            res.status(400).json({ error: check.error });
            return;
          }
        }
      }

      const id = type === 'mcp'
        ? `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        : `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const source = await prisma.toolSource.create({
        data: {
          id,
          name,
          type,
          description: description || null,
          scope: scope || 'enterprise',
          ownerId: scope === 'personal' ? req.user!.id : null,
          enabled: enabled !== false,
          // MCP
          transport: transport || null,
          command: command || null,
          args: args || null,
          url: url || null,
          env: env || null,
          // Skill
          scriptPath: scriptPath || null,
          runtime: runtime || null,
        },
      });

      // MCP: 注册到运行时
      if (type === 'mcp') {
        const config = toMCPConfig(source as unknown as ToolSourceRow);
        mcpRegistry.register(config);
        notifyMCPRegistryChanged();
      }

      res.json({ message: '工具源已创建', source });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /upload — 上传工具源（管理员）
   * Skill: zip 包
   * 通过 body.type 区分 mcp / skill（默认 skill）
   */
  router.post('/upload', authMiddleware, adminOnly, skillUpload.single('file'), async (req: AuthenticatedRequest, res, next) => {
    const tmpFile = (req as { file?: { path: string } }).file?.path;
    let skillDir = '';

    try {
      if (!tmpFile) {
        res.status(400).json({ error: '请上传文件' });
        return;
      }

      // 企业级 MCP 项目上传
      if (req.body.type === 'mcp') {
        await handleEnterpriseMCPUpload(req, res, tmpFile);
        return;
      }

      const { name: bodyName, description: bodyDesc, command: bodyCommand, scriptPath: bodyScriptPath } = req.body;

      const skillId = `skill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const dirName = skillDirName('enterprise', skillId, null);
      skillDir = path.join(enterpriseSkillsBase, dirName);

      extractAndUnwrap(tmpFile, skillDir);

      // 解析 SKILL.md
      const meta = parseSkillMd(skillDir);
      const finalName = bodyName || meta.name || skillId;
      const finalDesc = bodyDesc || meta.description || null;
      const finalCommand = bodyCommand || meta.command || null;
      const finalScriptPath = bodyScriptPath || meta.scriptPath || null;
      const finalVersion = meta.version || '1.0.0';

      // 确保 SKILL.md frontmatter
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        const existingMd = fs.readFileSync(skillMdPath, 'utf-8');
        const mergedMd = mergeSkillMd(existingMd, {
          name: finalName, description: finalDesc || '', scope: 'enterprise',
          ownerId: null, command: finalCommand, scriptPath: finalScriptPath, version: finalVersion,
        });
        fs.writeFileSync(skillMdPath, mergedMd, 'utf-8');
      } else {
        const newMd = generateSkillMd({
          name: finalName, description: finalDesc || '', scope: 'enterprise',
          ownerId: null, command: finalCommand, scriptPath: finalScriptPath, version: finalVersion,
        });
        fs.writeFileSync(skillMdPath, newMd, 'utf-8');
      }

      // 依赖检测 + 安装
      const deps = detectDeps(skillDir);
      await installWhlToSharedVenv(skillDir, deps, skillId);

      // 安全扫描
      let scanReport: ScanReport | null = null;
      try {
        scanReport = await scanner.scan(skillId, skillDir);
      } catch (scanErr: unknown) {
        logger.warn('scan error', { skillId, error: (scanErr as Error).message });
      }

      const reportWithDeps = {
        ...(scanReport ? JSON.parse(JSON.stringify(scanReport)) : {}),
        depsType: deps.depsType,
        depsInfo: deps.depsInfo,
      };

      if (scanReport && scanReport.summary.critical > 0) {
        rmDir(skillDir);
        cleanupTmp(tmpFile);
        res.status(422).json({
          error: `安全扫描未通过：发现 ${scanReport.summary.critical} 个严重问题`,
          scanReport: reportWithDeps,
        });
        return;
      }

      // 写入 ToolSource
      const source = await prisma.toolSource.create({
        data: {
          id: skillId,
          name: finalName,
          type: 'skill',
          description: finalDesc,
          scope: 'enterprise',
          ownerId: null,
          enabled: false,
          scriptPath: finalScriptPath,
          runtime: finalCommand ? undefined : 'python',
          config: {
            version: finalVersion,
            command: finalCommand,
            status: 'pending',
            scanReport: reportWithDeps,
          },
        },
      });

      cleanupTmp(tmpFile);

      const depsWarning = deps.depsType.endsWith('-only') ? deps.depsInfo : undefined;
      res.json({
        message: depsWarning ? `技能已上传，等待审批。注意: ${depsWarning}` : '技能已上传，等待审批',
        source: { ...source, version: finalVersion, status: 'pending', scanReport: reportWithDeps, command: finalCommand },
        scanReport: reportWithDeps,
      });
    } catch (err) {
      cleanupTmp(tmpFile || '');
      if (skillDir) rmDir(skillDir);
      next(err);
    }
  });

  /**
   * PUT /:id — 更新工具源（管理员）
   */
  router.put('/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { name, description, transport, command, args, url, env, enabled,
        scriptPath, runtime } = req.body;

      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }

      // MCP 路径校验
      if (existing.type === 'mcp' && args && args.length > 0) {
        const finalTransport = transport || existing.transport || 'stdio';
        if (finalTransport === 'stdio') {
          const tempConfig: MCPServerConfig = {
            id, name: name || existing.name, scope: 'enterprise', ownerId: null,
            transport: finalTransport, command: command || existing.command, args,
            enabled: true, createdAt: new Date(),
          };
          const pathError = sandbox.validatePaths(tempConfig, enterpriseMcpBase);
          if (pathError) {
            res.status(400).json({ error: `路径安全校验失败: ${pathError}` });
            return;
          }
        }
      }

      // SSRF 防护
      if (existing.type === 'mcp') {
        const finalTransport = transport || existing.transport;
        if (finalTransport === 'http' && url) {
          const check = validateMcpUrl(url);
          if (!check.valid) {
            res.status(400).json({ error: check.error });
            return;
          }
        }
      }

      const source = await prisma.toolSource.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(transport !== undefined && { transport }),
          ...(command !== undefined && { command }),
          ...(args !== undefined && { args }),
          ...(url !== undefined && { url }),
          ...(env !== undefined && { env }),
          ...(enabled !== undefined && { enabled }),
          ...(scriptPath !== undefined && { scriptPath }),
          ...(runtime !== undefined && { runtime }),
        },
      });

      // MCP: 更新运行时
      if (existing.type === 'mcp') {
        if (mcpExecutor.isConnected(id)) mcpExecutor.disconnect(id);
        mcpRegistry.unregister(id);
        mcpRegistry.register(toMCPConfig(source as unknown as ToolSourceRow));
        notifyMCPRegistryChanged();
      }

      // Skill: 同步引擎
      if (existing.type === 'skill' && enabled !== undefined) {
        const mdName = skillMdName(existing.scope, existing.name, existing.ownerId);
        await syncSkillEnabledToEngine(mdName, enabled);
      }

      res.json({ message: '工具源已更新', source });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  /**
   * DELETE /:id — 删除工具源（管理员）
   */
  router.delete('/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;

      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }

      // 引用完整性检查：agent 关联
      const allAgents = await prisma.agent.findMany({
        select: { id: true, name: true, ownerId: true, mcpFilter: true, skillsFilter: true, toolsFilter: true },
      });
      const filterField = existing.type === 'mcp' ? 'mcpFilter' : 'skillsFilter';
      const referencingAgents = allAgents.filter((a) => {
        const filter = (a as Record<string, unknown>)[filterField] as string[] | null;
        return Array.isArray(filter) && (filter.includes(id) || filter.includes(existing.name));
      });

      if (existing.type === 'mcp' && referencingAgents.length > 0) {
        // MCP: 阻止删除
        const names = referencingAgents.map((a) => `${a.ownerId}/${a.name}`).join(', ');
        res.status(409).json({ error: `无法删除：以下 Agent 仍在使用：${names}` });
        return;
      }

      if (existing.type === 'skill' && referencingAgents.length > 0) {
        // Skill: 自动清理关联（admin 可强制删除企业级技能）+ 重算权限
        const { Prisma } = await import('@prisma/client');
        const { computeToolsUpdate } = await import('../services/AgentConfigSync');
        for (const agent of referencingAgents) {
          const filter = ((agent as Record<string, unknown>)[filterField] as string[]).filter(
            (s: string) => s !== id && s !== existing.name,
          );
          const newSkillsFilter = filter.length > 0 ? filter : [];
          const agentToolsFilter = (agent as Record<string, unknown>).toolsFilter as string[] | null;
          const agentMcpFilter = (agent as Record<string, unknown>).mcpFilter as string[] | null;
          const computed = computeToolsUpdate(agent.name, agentToolsFilter, agentMcpFilter, newSkillsFilter, []);
          await prisma.agent.update({
            where: { id: agent.id },
            data: {
              [filterField]: filter.length > 0 ? filter : Prisma.JsonNull,
              toolsProfile: computed.profile,
              toolsDeny: computed.deny ?? [],
              toolsAllow: computed.alsoAllow,
            },
          });
        }
      }

      // MCP: 断开连接
      if (existing.type === 'mcp') {
        if (mcpExecutor.isConnected(id)) mcpExecutor.disconnect(id);
        mcpRegistry.unregister(id);
      }

      await prisma.toolSource.delete({ where: { id } });

      // MCP: 通知
      if (existing.type === 'mcp') {
        notifyMCPRegistryChanged();
      }

      // Skill: 清理文件 + 引擎同步
      if (existing.type === 'skill') {
        const dirName = skillDirName(existing.scope, id, existing.ownerId);
        const skillDir = path.resolve(enterpriseSkillsBase, dirName);
        const legacyDirs = [
          path.join(enterpriseSkillsBase, id),
          path.join(enterpriseSkillsBase, existing.name),
        ];
        if (existing.scope === 'personal' && existing.ownerId) {
          legacyDirs.push(path.join(usersBase, existing.ownerId, 'workspace', 'skills', id));
        }
        const targetDir = fs.existsSync(skillDir) ? skillDir : (legacyDirs.find(d => fs.existsSync(d)) || skillDir);
        rmDir(targetDir);

        const mdName = skillMdName(existing.scope, existing.name, existing.ownerId);
        await syncSkillEnabledToEngine(mdName, false);
      }

      res.json({ message: '工具源已删除' });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  /**
   * POST /:id/test — 测试连接（仅 MCP）
   */
  router.post('/:id/test', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const row = await prisma.toolSource.findUnique({ where: { id } });
      if (!row) {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }
      if (row.type !== 'mcp') {
        res.status(400).json({ error: '仅 MCP 类型支持连接测试' });
        return;
      }

      // 所有权校验
      if (row.scope === 'personal' && row.ownerId !== req.user!.id && !isAdmin(req.user)) {
        res.status(403).json({ error: '无权操作此工具源' });
        return;
      }

      const config = toMCPConfig(row as unknown as ToolSourceRow);
      const result = await mcpExecutor.testConnection(config);

      res.json({
        success: result.ok,
        message: result.ok ? '连接测试成功' : `连接测试失败: ${result.error}`,
        tools: result.ok ? (result.tools || []) : [],
      });
    } catch (err: unknown) {
      res.json({
        success: false,
        message: `连接测试失败: ${err instanceof Error ? err.message : String(err)}`,
        tools: [],
      });
    }
  });

  /**
   * POST /:id/scan — 扫描
   * MCP: 获取工具列表（等同原 GET /servers/:id/tools）
   * Skill: 安全扫描
   */
  router.post('/:id/scan', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }

      // 所有权校验
      if (existing.scope === 'personal' && existing.ownerId !== req.user!.id && !isAdmin(req.user)) {
        res.status(403).json({ error: '无权操作此工具源' });
        return;
      }

      if (existing.type === 'mcp') {
        // MCP: 扫描工具列表
        const config = toMCPConfig(existing as unknown as ToolSourceRow);
        if (!mcpExecutor.isConnected(id)) {
          await mcpExecutor.connect(config);
        }
        const tools = await mcpExecutor.listTools(id);

        // 缓存工具列表
        await prisma.toolSource.update({
          where: { id },
          data: { tools: JSON.parse(JSON.stringify(tools)) },
        });

        res.json({ tools });
      } else {
        // Skill: 安全扫描（需要 admin）
        if (!isAdmin(req.user)) {
          res.status(403).json({ error: '仅管理员可扫描企业级技能' });
          return;
        }

        const dirName = skillDirName(existing.scope, id, existing.ownerId);
        const skillDir = path.resolve(enterpriseSkillsBase, dirName);
        const legacyDir = existing.scope === 'enterprise'
          ? path.join(enterpriseSkillsBase, id)
          : path.join(usersBase, existing.ownerId || '', 'workspace', 'skills', id);
        const targetDir = fs.existsSync(skillDir) ? skillDir : legacyDir;

        if (!fs.existsSync(targetDir)) {
          res.status(400).json({ error: '技能目录不存在，请重新上传' });
          return;
        }

        const scanReport = await scanner.scan(id, targetDir);
        const cfg = (existing.config as Record<string, unknown>) || {};
        await prisma.toolSource.update({
          where: { id },
          data: {
            config: {
              ...cfg,
              scanReport: JSON.parse(JSON.stringify(scanReport)),
              status: scanReport.passed ? (cfg['status'] || 'pending') : 'rejected',
            },
          },
        });

        res.json({ message: '扫描完成', scanReport });
      }
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /:id/approve — 审批通过（仅 Skill，管理员）
   */
  router.post('/:id/approve', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }
      if (existing.type !== 'skill') {
        res.status(400).json({ error: '仅 Skill 类型支持审批' });
        return;
      }

      const cfg = (existing.config as Record<string, unknown>) || {};
      if (cfg['status'] !== 'pending') {
        res.status(400).json({ error: `当前状态为 ${cfg['status']}，仅 pending 状态可审批` });
        return;
      }

      const source = await prisma.toolSource.update({
        where: { id },
        data: {
          enabled: true,
          config: { ...cfg, status: 'approved' },
        },
      });

      await syncSkillEnabledToEngine(skillMdName(existing.scope, existing.name, existing.ownerId), true);
      res.json({ message: '技能已审批通过', source });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /:id/reject — 审批拒绝（仅 Skill，管理员）
   */
  router.post('/:id/reject', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }
      if (existing.type !== 'skill') {
        res.status(400).json({ error: '仅 Skill 类型支持审批' });
        return;
      }

      const cfg = (existing.config as Record<string, unknown>) || {};
      const source = await prisma.toolSource.update({
        where: { id },
        data: {
          enabled: false,
          config: { ...cfg, status: 'rejected', rejectReason: reason || '管理员拒绝' },
        },
      });

      await syncSkillEnabledToEngine(skillMdName(existing.scope, existing.name, existing.ownerId), false);
      res.json({ message: '技能已拒绝', source });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /:id/enable — 启用/禁用
   */
  router.put('/:id/enable', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled 参数必须为 boolean' });
        return;
      }

      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing) {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }

      const source = await prisma.toolSource.update({
        where: { id },
        data: { enabled },
      });

      if (existing.type === 'mcp') {
        // MCP: 更新 registry
        mcpRegistry.unregister(id);
        if (enabled) {
          mcpRegistry.register(toMCPConfig(source as unknown as ToolSourceRow));
        }
        notifyMCPRegistryChanged();
      } else {
        // Skill: 同步引擎
        await syncSkillEnabledToEngine(skillMdName(existing.scope, existing.name, existing.ownerId), enabled);
      }

      res.json({ message: enabled ? '已启用' : '已禁用', source });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === 'P2025') {
        res.status(404).json({ error: '工具源不存在' });
        return;
      }
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  个人级路由
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /personal — 列出个人工具源
   */
  router.get('/personal', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const typeFilter = req.query['type'] as string | undefined;

      const sources = await prisma.toolSource.findMany({
        where: {
          scope: 'personal',
          ownerId: user.id,
          ...(typeFilter ? { type: typeFilter } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      const data = sources.map((s: any) => {
        const cfg = s.config as Record<string, unknown> | null;
        return {
          ...s,
          version: cfg?.version ?? null,
          status: cfg?.status ?? (s.enabled ? 'active' : 'pending'),
          scanReport: cfg?.scanReport ?? null,
          ...(s.type === 'skill' ? { command: cfg?.command ?? null } : {}),
        };
      });
      res.json({ data, total: data.length });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /personal — 创建个人 MCP
   */
  router.post('/personal', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { name, description, transport, command, args, url, env } = req.body;

      if (!name || !transport) {
        res.status(400).json({ error: 'name 和 transport 为必填' });
        return;
      }

      // 沙箱安全校验
      const tempConfig: MCPServerConfig = {
        id: 'temp', name, scope: 'personal', ownerId: user.id,
        transport: transport as 'stdio' | 'http', command, args, url,
        enabled: true, createdAt: new Date(),
      };
      const validationError = sandbox.validate(tempConfig);
      if (validationError) {
        res.status(400).json({ error: `安全校验失败: ${validationError}` });
        return;
      }

      // 路径校验
      const userWorkspace = path.join(usersBase, user.id, 'workspace');
      const pathError = sandbox.validatePaths(tempConfig, userWorkspace);
      if (pathError) {
        res.status(400).json({ error: `路径安全校验失败: ${pathError}` });
        return;
      }

      const id = `mcp-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const source = await prisma.toolSource.create({
        data: {
          id,
          name,
          type: 'mcp',
          description: description || null,
          scope: 'personal',
          ownerId: user.id,
          enabled: true,
          transport,
          command: command || null,
          args: args || null,
          url: url || null,
          env: sandbox.sanitizeEnv(env),
        },
      });

      mcpRegistry.register(toMCPConfig(source as unknown as ToolSourceRow));
      notifyMCPRegistryChanged();
      invalidatePromptCache(user.id);

      res.json({ message: '个人 MCP 已注册', source });
    } catch (err) {
      next(err);
    }
  });

  /**
   * POST /personal/upload — 上传个人工具源
   * 自动检测类型：.zip = Skill, .tar.gz = MCP Python 项目
   * 也可通过 body.type 显式指定
   */
  router.post('/personal/upload', authMiddleware, mcpUpload.single('file'), async (req: AuthenticatedRequest, res, next) => {
    const uploadedFile = req.file;
    let tempFile: string | null = null;
    let projectDir: string | null = null;

    try {
      const user = req.user!;
      if (!uploadedFile) {
        res.status(400).json({ error: '请上传文件' });
        return;
      }
      tempFile = uploadedFile.path;

      const originalName = uploadedFile.originalname;
      const isTarGz = originalName.toLowerCase().endsWith('.tar.gz') || originalName.toLowerCase().endsWith('.tgz');
      const isZip = originalName.toLowerCase().endsWith('.zip');
      const explicitType = req.body.type as string | undefined;

      // 根据类型分发
      if (explicitType === 'mcp' || (isTarGz && explicitType !== 'skill')) {
        // ─── MCP Python 项目上传 ───
        await handlePersonalMCPUpload(req, res, user, uploadedFile, tempFile);
      } else if (explicitType === 'skill' || isZip) {
        // ─── Skill zip 上传 ───
        await handlePersonalSkillUpload(req, res, user, uploadedFile, tempFile);
      } else {
        res.status(400).json({ error: '无法识别文件类型，请指定 type=mcp 或 type=skill' });
      }
    } catch (err) {
      if (projectDir && fs.existsSync(projectDir)) {
        try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      next(err);
    } finally {
      if (tempFile && fs.existsSync(tempFile)) {
        try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
      }
    }
  });

  /** 个人 MCP Python 项目上传处理 */
  async function handlePersonalMCPUpload(
    req: AuthenticatedRequest,
    res: import('express').Response,
    user: NonNullable<AuthenticatedRequest['user']>,
    uploadedFile: Express.Multer.File,
    tempFile: string,
  ) {
    const originalName = uploadedFile.originalname;
    let projectName = (req.body.name as string || '')
      .trim()
      .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
    if (!projectName) {
      projectName = originalName
        .replace(/\.tar\.gz$/i, '')
        .replace(/\.zip$/i, '')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
    }
    if (!projectName) projectName = `mcp-project-${Date.now()}`;

    const mcpBase = path.resolve(dataRoot, 'mcp-servers');
    const dirName = mcpDirName('personal', projectName, user.id);
    const projectDir = path.join(mcpBase, dirName);

    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(projectDir, { recursive: true });

    const isZip = originalName.toLowerCase().endsWith('.zip');
    const extractTmpDir = path.join(os.tmpdir(), `octopus-extract-${Date.now()}`);
    fs.mkdirSync(extractTmpDir, { recursive: true });

    try {
      if (isZip) {
        const { stdout: zipList } = await execFileAsync('unzip', ['-l', tempFile], { timeout: 30000 });
        if (zipList.split('\n').some((e: string) => { const n = path.normalize(e.trim()); return n.startsWith('..') || path.isAbsolute(n); })) {
          res.status(400).json({ error: '压缩包中包含不合法的路径' }); return;
        }
        await execFileAsync('unzip', ['-o', '-q', tempFile, '-d', extractTmpDir], { timeout: 120000 });
      } else {
        const { stdout: tarList } = await execFileAsync('tar', ['tzf', tempFile], { timeout: 30000 });
        if (tarList.split('\n').some((e: string) => { const n = path.normalize(e.trim()); return n.startsWith('..') || path.isAbsolute(n); })) {
          res.status(400).json({ error: '压缩包中包含不合法的路径' }); return;
        }
        await execFileAsync('tar', ['xzf', tempFile, '-C', extractTmpDir], { timeout: 120000 });
      }

      // 检查单层包装
      const extractedItems = fs.readdirSync(extractTmpDir);
      let sourceDir = extractTmpDir;
      if (extractedItems.length === 1) {
        const singleItem = path.join(extractTmpDir, extractedItems[0]);
        if (fs.statSync(singleItem).isDirectory()) sourceDir = singleItem;
      }

      await execFileAsync('cp', ['-a', sourceDir + '/.', projectDir + '/'], { timeout: 60000 });
    } finally {
      fs.rmSync(extractTmpDir, { recursive: true, force: true });
    }

    // 校验 packages + requirements.txt
    const packagesDir = path.join(projectDir, 'packages');
    if (!fs.existsSync(packagesDir) || !fs.statSync(packagesDir).isDirectory() || fs.readdirSync(packagesDir).length === 0) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      res.status(400).json({ error: '请在压缩包中包含 packages/ 离线依赖目录（.whl 或 .tar.gz 格式）' }); return;
    }
    const reqFile = path.join(projectDir, 'requirements.txt');
    if (!fs.existsSync(reqFile)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      res.status(400).json({ error: '缺少 requirements.txt' }); return;
    }

    const installLogs: string[] = [];

    // 创建 venv
    try {
      const { stdout: vOut, stderr: vErr } = await execFileAsync('python3', ['-m', 'venv', path.join(projectDir, 'venv')], { timeout: 120000 });
      if (vOut) installLogs.push(vOut);
      if (vErr) installLogs.push(vErr);
    } catch (err: unknown) {
      installLogs.push((err as { stderr?: string }).stderr || (err as Error).message);
      res.status(500).json({ error: 'Python 虚拟环境创建失败', logs: installLogs }); return;
    }

    // 离线安装依赖
    const pipBin = path.join(projectDir, 'venv', 'bin', 'pip');
    try {
      const { stdout: pOut, stderr: pErr } = await execFileAsync(pipBin, ['install', '--no-index', '--find-links=' + packagesDir, '-r', reqFile], { timeout: 120000 });
      if (pOut) installLogs.push(pOut);
      if (pErr) installLogs.push(pErr);
    } catch (err: unknown) {
      installLogs.push((err as { stderr?: string }).stderr || (err as Error).message);
      res.status(500).json({ error: '依赖安装失败', logs: installLogs }); return;
    }

    // 扫描入口文件
    const entryFileCandidates = ['mcp_server.py', 'mcp_stdio.py', 'server.py', 'main.py', 'app.py', 'index.py'];
    let entryFile: string | null = null;
    for (const c of entryFileCandidates) {
      if (fs.existsSync(path.join(projectDir, c))) { entryFile = c; break; }
    }

    const python3Bin = path.join(projectDir, 'venv', 'bin', 'python3');
    const entryAbsPath = entryFile ? path.join(projectDir, entryFile) : null;

    const id = `mcp-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const source = await prisma.toolSource.create({
      data: {
        id,
        name: projectName,
        type: 'mcp',
        description: `Python MCP 项目（上传安装）${entryFile ? '' : ' - 未检测到入口文件'}`,
        scope: 'personal',
        ownerId: user.id,
        enabled: true,
        transport: 'stdio',
        command: python3Bin,
        args: entryAbsPath ? [entryAbsPath] : [],
        url: null,
        env: {},
      },
    });

    mcpRegistry.register(toMCPConfig(source as unknown as ToolSourceRow));
    notifyMCPRegistryChanged();
    invalidatePromptCache(user.id);

    res.json({
      message: entryFile
        ? `MCP 项目 "${projectName}" 上传安装成功`
        : `MCP 项目 "${projectName}" 上传安装成功，但未检测到入口文件`,
      source,
      entryFile,
      installLogs,
    });
  }

  /** 企业级 MCP Python 项目上传处理 */
  async function handleEnterpriseMCPUpload(
    req: AuthenticatedRequest,
    res: import('express').Response,
    tempFile: string,
  ) {
    const originalName = ((req as { file?: Express.Multer.File }).file as Express.Multer.File).originalname;
    let projectName = (req.body.name as string || '')
      .trim()
      .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
    if (!projectName) {
      projectName = originalName
        .replace(/\.tar\.gz$/i, '')
        .replace(/\.zip$/i, '')
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
    }
    if (!projectName) projectName = `mcp-project-${Date.now()}`;

    const mcpBase = path.resolve(dataRoot, 'mcp-servers');
    const dirName = mcpDirName('enterprise', projectName, null);
    const projectDir = path.join(mcpBase, dirName);

    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    fs.mkdirSync(projectDir, { recursive: true });

    const isZip = originalName.toLowerCase().endsWith('.zip');
    const extractTmpDir = path.join(os.tmpdir(), `octopus-extract-${Date.now()}`);
    fs.mkdirSync(extractTmpDir, { recursive: true });

    try {
      if (isZip) {
        const { stdout: zipList } = await execFileAsync('unzip', ['-l', tempFile], { timeout: 30000 });
        if (zipList.split('\n').some((e: string) => { const n = path.normalize(e.trim()); return n.startsWith('..') || path.isAbsolute(n); })) {
          res.status(400).json({ error: '压缩包中包含不合法的路径' }); return;
        }
        await execFileAsync('unzip', ['-o', '-q', tempFile, '-d', extractTmpDir], { timeout: 120000 });
      } else {
        const { stdout: tarList } = await execFileAsync('tar', ['tzf', tempFile], { timeout: 30000 });
        if (tarList.split('\n').some((e: string) => { const n = path.normalize(e.trim()); return n.startsWith('..') || path.isAbsolute(n); })) {
          res.status(400).json({ error: '压缩包中包含不合法的路径' }); return;
        }
        await execFileAsync('tar', ['xzf', tempFile, '-C', extractTmpDir], { timeout: 120000 });
      }

      // 检查单层包装
      const extractedItems = fs.readdirSync(extractTmpDir);
      let sourceDir = extractTmpDir;
      if (extractedItems.length === 1) {
        const singleItem = path.join(extractTmpDir, extractedItems[0]);
        if (fs.statSync(singleItem).isDirectory()) sourceDir = singleItem;
      }

      await execFileAsync('cp', ['-a', sourceDir + '/.', projectDir + '/'], { timeout: 60000 });
    } catch (err) {
      fs.rmSync(extractTmpDir, { recursive: true, force: true });
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
      throw err;
    } finally {
      if (fs.existsSync(extractTmpDir)) {
        fs.rmSync(extractTmpDir, { recursive: true, force: true });
      }
    }

    // 校验 packages + requirements.txt
    const packagesDir = path.join(projectDir, 'packages');
    if (!fs.existsSync(packagesDir) || !fs.statSync(packagesDir).isDirectory() || fs.readdirSync(packagesDir).length === 0) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      cleanupTmp(tempFile);
      res.status(400).json({ error: '请在压缩包中包含 packages/ 离线依赖目录（.whl 或 .tar.gz 格式）' }); return;
    }
    const reqFile = path.join(projectDir, 'requirements.txt');
    if (!fs.existsSync(reqFile)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
      cleanupTmp(tempFile);
      res.status(400).json({ error: '缺少 requirements.txt' }); return;
    }

    const installLogs: string[] = [];

    // 创建 venv
    try {
      const { stdout: vOut, stderr: vErr } = await execFileAsync('python3', ['-m', 'venv', path.join(projectDir, 'venv')], { timeout: 120000 });
      if (vOut) installLogs.push(vOut);
      if (vErr) installLogs.push(vErr);
    } catch (err: unknown) {
      installLogs.push((err as { stderr?: string }).stderr || (err as Error).message);
      fs.rmSync(projectDir, { recursive: true, force: true });
      cleanupTmp(tempFile);
      res.status(500).json({ error: 'Python 虚拟环境创建失败', logs: installLogs }); return;
    }

    // 离线安装依赖
    const pipBin = path.join(projectDir, 'venv', 'bin', 'pip');
    try {
      const { stdout: pOut, stderr: pErr } = await execFileAsync(pipBin, ['install', '--no-index', '--find-links=' + packagesDir, '-r', reqFile], { timeout: 120000 });
      if (pOut) installLogs.push(pOut);
      if (pErr) installLogs.push(pErr);
    } catch (err: unknown) {
      installLogs.push((err as { stderr?: string }).stderr || (err as Error).message);
      fs.rmSync(projectDir, { recursive: true, force: true });
      cleanupTmp(tempFile);
      res.status(500).json({ error: '依赖安装失败', logs: installLogs }); return;
    }

    // 扫描入口文件
    const entryFileCandidates = ['mcp_server.py', 'mcp_stdio.py', 'server.py', 'main.py', 'app.py', 'index.py'];
    let entryFile: string | null = null;
    for (const c of entryFileCandidates) {
      if (fs.existsSync(path.join(projectDir, c))) { entryFile = c; break; }
    }

    const python3Bin = path.join(projectDir, 'venv', 'bin', 'python3');
    const entryAbsPath = entryFile ? path.join(projectDir, entryFile) : null;

    const id = `mcp-enterprise-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const source = await prisma.toolSource.create({
      data: {
        id,
        name: projectName,
        type: 'mcp',
        description: `Python MCP 项目（企业级上传安装）${entryFile ? '' : ' - 未检测到入口文件'}`,
        scope: 'enterprise',
        ownerId: null,
        enabled: true,
        transport: 'stdio',
        command: python3Bin,
        args: entryAbsPath ? [entryAbsPath] : [],
        url: null,
        env: {},
      },
    });

    mcpRegistry.register(toMCPConfig(source as unknown as ToolSourceRow));
    notifyMCPRegistryChanged();
    // Enterprise MCP affects all users — invalidate with empty prefix to clear all
    invalidatePromptCache('');
    cleanupTmp(tempFile);

    res.json({
      message: entryFile
        ? `企业级 MCP 项目 "${projectName}" 上传安装成功`
        : `企业级 MCP 项目 "${projectName}" 上传安装成功，但未检测到入口文件`,
      source,
      entryFile,
      installLogs,
    });
  }

  /** 个人 Skill zip 上传处理 */
  async function handlePersonalSkillUpload(
    req: AuthenticatedRequest,
    res: import('express').Response,
    user: NonNullable<AuthenticatedRequest['user']>,
    _uploadedFile: Express.Multer.File,
    tmpFile: string,
  ) {
    const { name: bodyName, description: bodyDesc, command: bodyCommand, scriptPath: bodyScriptPath } = req.body;

    const skillId = `skill-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dirName = skillDirName('personal', skillId, user.id);
    const skillDir = path.join(enterpriseSkillsBase, dirName);

    try {
      extractAndUnwrap(tmpFile, skillDir);

      const meta = parseSkillMd(skillDir);
      const finalName = bodyName || meta.name || skillId;
      const finalDesc = bodyDesc || meta.description || null;
      const finalCommand = bodyCommand || meta.command || null;
      const finalScriptPath = bodyScriptPath || meta.scriptPath || null;
      const finalVersion = meta.version || '1.0.0';

      // 确保 SKILL.md frontmatter
      const skillMdPath = path.join(skillDir, 'SKILL.md');
      if (fs.existsSync(skillMdPath)) {
        const existingMd = fs.readFileSync(skillMdPath, 'utf-8');
        const mergedMd = mergeSkillMd(existingMd, {
          name: finalName, description: finalDesc || '', scope: 'personal',
          ownerId: user.id, command: finalCommand, scriptPath: finalScriptPath, version: finalVersion,
        });
        fs.writeFileSync(skillMdPath, mergedMd, 'utf-8');
      } else {
        const newMd = generateSkillMd({
          name: finalName, description: finalDesc || '', scope: 'personal',
          ownerId: user.id, command: finalCommand, scriptPath: finalScriptPath, version: finalVersion,
        });
        fs.writeFileSync(skillMdPath, newMd, 'utf-8');
      }

      // 依赖 + 扫描
      const deps = detectDeps(skillDir);

      let scanReport: ScanReport | null = null;
      try {
        scanReport = await scanner.scan(skillId, skillDir);
      } catch (scanErr: unknown) {
        logger.warn('scan error', { skillId, error: (scanErr as Error).message });
      }

      await installWhlToSharedVenv(skillDir, deps, skillId);

      const reportWithDeps = {
        ...(scanReport ? JSON.parse(JSON.stringify(scanReport)) : {}),
        depsType: deps.depsType,
        depsInfo: deps.depsInfo,
      };

      if (scanReport && scanReport.summary.critical > 0) {
        rmDir(skillDir);
        res.status(422).json({
          error: `安全扫描未通过：发现 ${scanReport.summary.critical} 个严重问题`,
          scanReport: reportWithDeps,
        });
        return;
      }

      const status = scanReport?.passed !== false ? 'active' : 'rejected';
      const enabled = status === 'active';

      const source = await prisma.toolSource.create({
        data: {
          id: skillId,
          name: finalName,
          type: 'skill',
          description: finalDesc,
          scope: 'personal',
          ownerId: user.id,
          enabled,
          scriptPath: finalScriptPath,
          runtime: finalCommand ? undefined : 'python',
          config: {
            version: finalVersion,
            command: finalCommand,
            status,
            scanReport: reportWithDeps,
          },
        },
      });

      const depsWarning = deps.depsType.endsWith('-only') ? deps.depsInfo : undefined;
      let msg = status === 'active' ? '个人技能已上传并启用' : '个人技能上传成功但安全扫描未通过';
      if (depsWarning) msg += `。注意: ${depsWarning}`;

      res.json({ message: msg, source, scanReport: reportWithDeps });
    } catch (err) {
      rmDir(skillDir);
      throw err;
    }
  }

  /**
   * PUT /personal/:id — 更新个人工具源
   */
  router.put('/personal/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing || existing.ownerId !== user.id) {
        res.status(404).json({ error: '个人工具源不存在' });
        return;
      }

      const { name, description, transport, command, args, url, env, enabled,
        scriptPath, runtime } = req.body;

      // MCP: 路径校验
      if (existing.type === 'mcp' && args && args.length > 0) {
        const finalTransport = transport || existing.transport || 'stdio';
        if (finalTransport === 'stdio') {
          const tempConfig: MCPServerConfig = {
            id, name: name || existing.name, scope: 'personal', ownerId: user.id,
            transport: finalTransport, command: command || existing.command, args,
            enabled: true, createdAt: new Date(),
          };
          const userWorkspace = path.join(usersBase, user.id, 'workspace');
          const pathError = sandbox.validatePaths(tempConfig, userWorkspace);
          if (pathError) {
            res.status(400).json({ error: `路径安全校验失败: ${pathError}` });
            return;
          }
        }
      }

      const source = await prisma.toolSource.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(transport !== undefined && { transport }),
          ...(command !== undefined && { command }),
          ...(args !== undefined && { args }),
          ...(url !== undefined && { url }),
          ...(env !== undefined && { env: existing.type === 'mcp' ? sandbox.sanitizeEnv(env) : env }),
          ...(enabled !== undefined && { enabled }),
          ...(scriptPath !== undefined && { scriptPath }),
          ...(runtime !== undefined && { runtime }),
        },
      });

      if (existing.type === 'mcp') {
        if (mcpExecutor.isConnected(id)) mcpExecutor.disconnect(id);
        mcpRegistry.unregister(id);
        mcpRegistry.register(toMCPConfig(source as unknown as ToolSourceRow));
        notifyMCPRegistryChanged();
      }

      invalidatePromptCache(user.id);
      res.json({ message: '个人工具源已更新', source });
    } catch (err) {
      next(err);
    }
  });

  /**
   * DELETE /personal/:id — 删除个人工具源
   */
  router.delete('/personal/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const existing = await prisma.toolSource.findUnique({ where: { id } });
      if (!existing || existing.ownerId !== user.id) {
        res.status(404).json({ error: '个人工具源不存在' });
        return;
      }

      // 引用完整性检查
      const filterField = existing.type === 'mcp' ? 'mcpFilter' : 'skillsFilter';
      const userAgents = await prisma.agent.findMany({
        where: { ownerId: user.id },
        select: { name: true, ownerId: true, mcpFilter: true, skillsFilter: true },
      });
      const referencingAgents = userAgents.filter((a) => {
        const filter = (a as Record<string, unknown>)[filterField] as string[] | null;
        return Array.isArray(filter) && (filter.includes(id) || filter.includes(existing.name));
      });
      if (referencingAgents.length > 0) {
        const names = referencingAgents.map((a) => a.name).join(', ');
        res.status(409).json({ error: `无法删除：以下 Agent 仍在使用：${names}` });
        return;
      }

      // MCP: 断开
      if (existing.type === 'mcp') {
        if (mcpExecutor.isConnected(id)) mcpExecutor.disconnect(id);
        mcpRegistry.unregister(id);
        notifyMCPRegistryChanged();
      }

      await prisma.toolSource.delete({ where: { id } });

      // Skill: 清理文件
      if (existing.type === 'skill') {
        const dirName = skillDirName('personal', id, user.id);
        const skillDir = path.resolve(enterpriseSkillsBase, dirName);
        const legacyDir = path.join(usersBase, user.id, 'workspace', 'skills', id);
        const targetDir = fs.existsSync(skillDir) ? skillDir : legacyDir;
        rmDir(targetDir);
      }

      invalidatePromptCache(user.id);
      res.json({ message: '个人工具源已删除' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// ─── 导出辅助函数（供其他模块使用，如 SystemPromptBuilder） ──────────────────

/**
 * 获取用户可用的 MCP 类型工具源（企业级 + 个人级）
 * 替代原 getMergedMCPServers
 */
export async function getMergedMCPServers(
  prisma: AppPrismaClient,
  userId: string,
  agentMcpFilter: string[] | null = null,
) {
  const sources = await prisma.toolSource.findMany({
    where: {
      type: 'mcp',
      enabled: true,
      OR: [
        { scope: 'enterprise' },
        { scope: 'personal', ownerId: userId },
      ],
    },
  });

  if (agentMcpFilter !== null) {
    return sources.filter((s) => agentMcpFilter.includes(s.name) || agentMcpFilter.includes(s.id));
  }

  return sources;
}
