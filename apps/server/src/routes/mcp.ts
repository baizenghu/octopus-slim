import { invalidatePromptCache } from '../services/SystemPromptBuilder';

/**
 * MCP 管理路由
 *
 * 企业级 MCP（管理员操作）:
 * GET    /api/mcp/servers          - 列出 MCP Server
 * POST   /api/mcp/servers          - 注册 MCP Server
 * PUT    /api/mcp/servers/:id      - 更新 MCP Server
 * DELETE /api/mcp/servers/:id      - 删除 MCP Server
 * POST   /api/mcp/servers/:id/test - 测试连接
 * GET    /api/mcp/servers/:id/tools- 获取工具列表
 *
 * 个人 MCP（用户操作）:
 * GET    /api/mcp/personal         - 列出个人 MCP
 * POST   /api/mcp/personal         - 注册个人 MCP
 * POST   /api/mcp/personal/upload  - 上传 Python MCP 项目（.tar.gz/.zip）
 * PUT    /api/mcp/personal/:id     - 更新个人 MCP
 * DELETE /api/mcp/personal/:id     - 删除个人 MCP
 *
 * 路径安全策略：
 * - 企业级 MCP 脚本必须位于 {dataRoot}/mcp-servers/ 目录下
 * - 个人 MCP 脚本必须位于 {dataRoot}/users/{userId}/workspace/ 目录下
 * - 个人上传 MCP 项目位于 {dataRoot}/users/{userId}/mcp-servers/ 目录下
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Router } from 'express';
import multer from 'multer';
import { MCPRegistry, MCPExecutor, MCPSandbox } from '@octopus/mcp';
import type { MCPServerConfig } from '@octopus/mcp';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, adminOnly, isAdmin, type AuthenticatedRequest } from '../middleware/auth';
import type { AppPrismaClient } from '../types/prisma';
import { validateMcpUrl } from '../utils/url-validator';
import { createLogger } from '../utils/logger';

const logger = createLogger('mcp');

const execFileAsync = promisify(execFile);

export function createMcpRouter(
  authService: AuthService,
  prisma: AppPrismaClient,
  mcpRegistry: MCPRegistry,
  mcpExecutor: MCPExecutor,
  dataRoot: string,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);
  const sandbox = new MCPSandbox();

  /**
   * 通知 enterprise-mcp plugin 刷新工具注册表
   * 通过写入信号文件触发 plugin 侧的 file watcher 重新加载
   */
  function notifyMCPRegistryChanged(): void {
    const signalPath = path.resolve(
      process.env['OCTOPUS_STATE_DIR'] || path.join(process.env['HOME'] || '/home/baizh', '.octopus-enterprise'),
      'mcp-refresh-signal',
    );
    try {
      fs.writeFileSync(signalPath, Date.now().toString());
    } catch (err: any) {
      logger.warn('Failed to write refresh signal', { error: err.message });
    }
  }

  /** 企业级 MCP 脚本目录 */
  const enterpriseMcpBase = path.resolve(dataRoot, 'mcp-servers');
  /** 用户工作空间基目录 */
  const usersBase = path.resolve(dataRoot, 'users');

  // Prisma → MCPServerConfig 转换
  function toConfig(row: any): MCPServerConfig {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      scope: row.scope as 'enterprise' | 'personal',
      ownerId: row.ownerId,
      transport: row.transport as 'stdio' | 'http',
      command: row.command || undefined,
      args: row.args as string[] | undefined,
      url: row.url || undefined,
      env: row.env as Record<string, string> | undefined,
      enabled: row.enabled,
      createdAt: row.createdAt,
    };
  }

  // =============== 企业级 MCP（管理员） ===============

  /**
   * 列出所有 MCP Server
   * 管理员看全部，普通用户只看已启用的企业级 + 自己的个人 MCP
   */
  router.get('/servers', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const userIsAdmin = isAdmin(user);

      let servers;
      if (userIsAdmin) {
        servers = await prisma.mCPServer.findMany({ orderBy: { createdAt: 'desc' } });
      } else {
        servers = await prisma.mCPServer.findMany({
          where: {
            OR: [
              { scope: 'enterprise', enabled: true },
              { scope: 'personal', ownerId: user.id },
            ],
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      res.json({ data: servers, total: servers.length });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 注册新 MCP Server（管理员）
   */
  router.post('/servers', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { name, description, scope, transport, command, args, url, env, enabled } = req.body;

      if (!name || !transport) {
        res.status(400).json({ error: 'name 和 transport 为必填' });
        return;
      }

      if (transport === 'stdio' && !command) {
        res.status(400).json({ error: 'stdio 模式需要 command' });
        return;
      }

      // 企业级 MCP 路径校验：脚本必须在 {dataRoot}/mcp-servers/ 内
      if (transport === 'stdio' && args && args.length > 0) {
        const tempConfig: MCPServerConfig = {
          id: 'temp', name, scope: 'enterprise', ownerId: null, transport, command, args,
          enabled: true, createdAt: new Date(),
        };
        const pathError = sandbox.validatePaths(tempConfig, enterpriseMcpBase);
        if (pathError) {
          res.status(400).json({ error: `路径安全校验失败: ${pathError}。企业级 MCP 脚本必须放在 ${enterpriseMcpBase}/ 目录下` });
          return;
        }
      }

      // SSRF 防护：校验 HTTP URL 不指向内网地址
      if (transport === 'http' && url) {
        const check = validateMcpUrl(url);
        if (!check.valid) {
          res.status(400).json({ error: check.error });
          return;
        }
      }

      const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const server = await prisma.mCPServer.create({
        data: {
          id,
          name,
          description: description || null,
          scope: scope || 'enterprise',
          ownerId: scope === 'personal' ? req.user!.id : null,
          transport,
          command: command || null,
          args: args || null,
          url: url || null,
          env: env || null,
          enabled: enabled !== false,
        },
      });

      // 同步到运行时 Registry，并通知 plugin 侧刷新
      const config = toConfig(server);
      mcpRegistry.register(config);
      notifyMCPRegistryChanged();

      res.json({ message: 'MCP Server 已注册', server });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 更新 MCP Server（管理员）
   */
  router.put('/servers/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const { name, description, transport, command, args, url, env, enabled } = req.body;

      // 如果更新了 args，校验路径
      if (args && args.length > 0) {
        const existing = await prisma.mCPServer.findUnique({ where: { id } });
        const finalTransport = transport || existing?.transport || 'stdio';
        if (finalTransport === 'stdio') {
          const tempConfig: MCPServerConfig = {
            id, name: name || existing?.name || '', scope: 'enterprise', ownerId: null,
            transport: finalTransport, command: command || existing?.command, args,
            enabled: true, createdAt: new Date(),
          };
          const pathError = sandbox.validatePaths(tempConfig, enterpriseMcpBase);
          if (pathError) {
            res.status(400).json({ error: `路径安全校验失败: ${pathError}` });
            return;
          }
        }
      }

      // SSRF 防护：校验 HTTP URL 不指向内网地址
      const finalTransportForUrl = transport || (await prisma.mCPServer.findUnique({ where: { id }, select: { transport: true } }))?.transport;
      if (finalTransportForUrl === 'http' && url) {
        const check = validateMcpUrl(url);
        if (!check.valid) {
          res.status(400).json({ error: check.error });
          return;
        }
      }

      const server = await prisma.mCPServer.update({
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
        },
      });

      // 更新运行时（断开旧连接，重新注册），通知 plugin 侧刷新
      if (mcpExecutor.isConnected(id)) {
        mcpExecutor.disconnect(id);
      }
      mcpRegistry.unregister(id);
      mcpRegistry.register(toConfig(server));
      notifyMCPRegistryChanged();

      res.json({ message: 'MCP Server 已更新', server });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'MCP Server 不存在' });
        return;
      }
      next(err);
    }
  });

  /**
   * 删除 MCP Server（管理员）
   */
  router.delete('/servers/:id', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;

      // 引用完整性检查：检查是否有 agent 关联了此 MCP
      const server = await prisma.mCPServer.findUnique({ where: { id } });
      if (server) {
        const allAgents = await prisma.agent.findMany({ select: { name: true, ownerId: true, mcpFilter: true } });
        const referencingAgents = allAgents.filter((a: any) => {
          const filter = a.mcpFilter as string[] | null;
          return Array.isArray(filter) && (filter.includes(id) || filter.includes(server.name));
        });
        if (referencingAgents.length > 0) {
          const names = referencingAgents.map((a: any) => `${a.ownerId}/${a.name}`).join(', ');
          res.status(409).json({ error: `无法删除：以下 Agent 仍在使用此 MCP Server：${names}。请先取消关联后再删除。` });
          return;
        }
      }

      // 断开连接，通知 plugin 侧刷新
      if (mcpExecutor.isConnected(id)) {
        mcpExecutor.disconnect(id);
      }
      mcpRegistry.unregister(id);

      await prisma.mCPServer.delete({ where: { id } });
      notifyMCPRegistryChanged();

      res.json({ message: 'MCP Server 已删除' });
    } catch (err: any) {
      if (err.code === 'P2025') {
        res.status(404).json({ error: 'MCP Server 不存在' });
        return;
      }
      next(err);
    }
  });

  /**
   * 测试 MCP Server 连接
   */
  router.post('/servers/:id/test', authMiddleware, async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const row = await prisma.mCPServer.findUnique({ where: { id } });
      if (!row) {
        res.status(404).json({ error: 'MCP Server 不存在' });
        return;
      }

      // 所有权校验：personal scope 需要 owner 或 admin
      if (row.scope === 'personal' && row.ownerId !== req.user!.id) {
        if (!isAdmin(req.user)) {
          res.status(403).json({ error: '无权操作此 MCP Server' });
          return;
        }
      }

      const config = toConfig(row);
      const result = await mcpExecutor.testConnection(config);

      if (result.ok) {
        res.json({
          success: true,
          message: '连接测试成功',
          tools: result.tools || [],
        });
      } else {
        res.json({
          success: false,
          message: `连接测试失败: ${result.error}`,
          tools: [],
        });
      }
    } catch (err: any) {
      res.json({
        success: false,
        message: `连接测试失败: ${err.message}`,
        tools: [],
      });
    }
  });

  /**
   * 获取 MCP Server 工具列表
   */
  router.get('/servers/:id/tools', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { id } = req.params;
      const row = await prisma.mCPServer.findUnique({ where: { id } });
      if (!row) {
        res.status(404).json({ error: 'MCP Server 不存在' });
        return;
      }

      // 所有权校验：personal scope 需要 owner 或 admin
      if (row.scope === 'personal' && row.ownerId !== req.user!.id) {
        if (!isAdmin(req.user)) {
          res.status(403).json({ error: '无权操作此 MCP Server' });
          return;
        }
      }

      const config = toConfig(row);

      // 临时连接获取工具列表
      if (!mcpExecutor.isConnected(id)) {
        await mcpExecutor.connect(config);
      }
      const tools = await mcpExecutor.listTools(id);

      res.json({ tools });
    } catch (err) {
      next(err);
    }
  });

  // =============== 个人 MCP ===============

  /**
   * 列出当前用户的个人 MCP
   */
  router.get('/personal', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const servers = await prisma.mCPServer.findMany({
        where: { scope: 'personal', ownerId: user.id },
        orderBy: { createdAt: 'desc' },
      });
      res.json({ data: servers, total: servers.length });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 注册个人 MCP Server
   */
  router.post('/personal', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { name, description, transport, command, args, url, env } = req.body;

      if (!name || !transport) {
        res.status(400).json({ error: 'name 和 transport 为必填' });
        return;
      }

      // 沙箱安全校验（命令白名单 + transport）
      const tempConfig: MCPServerConfig = {
        id: 'temp',
        name,
        scope: 'personal',
        ownerId: user.id,
        transport: transport as 'stdio' | 'http',
        command,
        args,
        url,
        enabled: true,
        createdAt: new Date(),
      };
      const validationError = sandbox.validate(tempConfig);
      if (validationError) {
        res.status(400).json({ error: `安全校验失败: ${validationError}` });
        return;
      }

      // 路径校验：脚本必须在用户自己的工作空间内
      const userWorkspace = path.join(usersBase, user.id, 'workspace');
      const pathError = sandbox.validatePaths(tempConfig, userWorkspace);
      if (pathError) {
        res.status(400).json({ error: `路径安全校验失败: ${pathError}。个人 MCP 脚本必须放在您的工作空间 (workspace/mcp/) 目录下` });
        return;
      }

      const id = `mcp-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const server = await prisma.mCPServer.create({
        data: {
          id,
          name,
          description: description || null,
          scope: 'personal',
          ownerId: user.id,
          transport,
          command: command || null,
          args: args || null,
          url: url || null,
          env: sandbox.sanitizeEnv(env),
          enabled: true,
        },
      });

      mcpRegistry.register(toConfig(server));
      notifyMCPRegistryChanged();
      invalidatePromptCache(user.id);
      res.json({ message: '个人 MCP Server 已注册', server });
    } catch (err) {
      next(err);
    }
  });

  // =============== 个人 MCP 上传 Python 项目 ===============

  // multer 配置：临时目录，200MB 限制
  const uploadDir = path.join(os.tmpdir(), 'octopus-mcp-uploads');
  fs.mkdirSync(uploadDir, { recursive: true });
  const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext === '.zip' || ext === '.gz' || file.originalname.endsWith('.tar.gz')) {
        cb(null, true);
      } else {
        cb(new Error('仅支持 .tar.gz 或 .zip 格式的压缩包'));
      }
    },
  });

  /**
   * 上传 Python MCP 项目（.tar.gz / .zip）
   * 自动解压、创建 venv、离线安装依赖、扫描入口文件、创建 DB 记录
   */
  router.post('/personal/upload', authMiddleware, upload.single('file'), async (req: AuthenticatedRequest, res, next) => {
    const uploadedFile = req.file;
    let tempFile: string | null = null;
    let projectDir: string | null = null;

    try {
      const user = req.user!;

      if (!uploadedFile) {
        res.status(400).json({ error: '请上传压缩包文件（.tar.gz 或 .zip）' });
        return;
      }
      tempFile = uploadedFile.path;

      // 从文件名或请求参数中确定项目名
      const originalName = uploadedFile.originalname;
      let projectName = (req.body.name as string || '')
        .trim()
        .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
      if (!projectName) {
        // 从文件名推导：去掉 .tar.gz / .zip 后缀
        projectName = originalName
          .replace(/\.tar\.gz$/i, '')
          .replace(/\.zip$/i, '')
          .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, '_');
      }
      if (!projectName) {
        projectName = `mcp-project-${Date.now()}`;
      }

      // 目标目录：data/users/{userId}/mcp-servers/{projectName}/
      const userMcpBase = path.resolve(dataRoot, 'users', user.id, 'mcp-servers');
      projectDir = path.join(userMcpBase, projectName);

      // 如果目标目录已存在，先清理
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
      fs.mkdirSync(projectDir, { recursive: true });

      // 判断压缩包类型并解压
      const isZip = originalName.toLowerCase().endsWith('.zip');
      const isTarGz = originalName.toLowerCase().endsWith('.tar.gz') || originalName.toLowerCase().endsWith('.tgz');

      if (!isZip && !isTarGz) {
        res.status(400).json({ error: '仅支持 .tar.gz 或 .zip 格式的压缩包' });
        return;
      }

      // 解压到临时目录，然后检查是否有单层包裹目录
      const extractTmpDir = path.join(os.tmpdir(), `octopus-extract-${Date.now()}`);
      fs.mkdirSync(extractTmpDir, { recursive: true });

      try {
        if (isZip) {
          // 解压前检查路径穿越（使用 execFile 防止命令注入）
          const { stdout: zipList } = await execFileAsync('unzip', ['-l', tempFile], { timeout: 30000 });
          const entries = zipList.split('\n');
          const hasTraversal = entries.some((entry: string) => {
            const normalized = path.normalize(entry.trim());
            return normalized.startsWith('..') || path.isAbsolute(normalized);
          });
          if (hasTraversal) {
            res.status(400).json({ error: '压缩包中包含不合法的路径' });
            return;
          }
          await execFileAsync('unzip', ['-o', '-q', tempFile, '-d', extractTmpDir], { timeout: 120000 });
        } else {
          // tar 解压前检查路径穿越（使用 execFile 防止命令注入）
          const { stdout: tarList } = await execFileAsync('tar', ['tzf', tempFile], { timeout: 30000 });
          const entries = tarList.split('\n');
          const hasTraversal = entries.some((entry: string) => {
            const normalized = path.normalize(entry.trim());
            return normalized.startsWith('..') || path.isAbsolute(normalized);
          });
          if (hasTraversal) {
            res.status(400).json({ error: '压缩包中包含不合法的路径' });
            return;
          }
          await execFileAsync('tar', ['xzf', tempFile, '-C', extractTmpDir], { timeout: 120000 });
        }

        // 检查是否有单层包裹目录（常见：压缩包内只有一个顶级目录）
        const extractedItems = fs.readdirSync(extractTmpDir);
        let sourceDir = extractTmpDir;
        if (extractedItems.length === 1) {
          const singleItem = path.join(extractTmpDir, extractedItems[0]);
          if (fs.statSync(singleItem).isDirectory()) {
            sourceDir = singleItem;
          }
        }

        // 移动文件到目标项目目录
        await execFileAsync('cp', ['-a', sourceDir + '/.', projectDir + '/'], { timeout: 60000 });
      } finally {
        // 清理临时解压目录
        fs.rmSync(extractTmpDir, { recursive: true, force: true });
      }

      // 校验：packages/ 目录存在且非空
      const packagesDir = path.join(projectDir, 'packages');
      if (!fs.existsSync(packagesDir) || !fs.statSync(packagesDir).isDirectory()) {
        // 清理已解压的项目目录
        fs.rmSync(projectDir, { recursive: true, force: true });
        projectDir = null;
        res.status(400).json({ error: '请在压缩包中包含 packages 离线依赖目录' });
        return;
      }
      const packageFiles = fs.readdirSync(packagesDir);
      if (packageFiles.length === 0) {
        fs.rmSync(projectDir, { recursive: true, force: true });
        projectDir = null;
        res.status(400).json({ error: '请在压缩包中包含 packages 离线依赖目录（目录为空）' });
        return;
      }

      // 校验：requirements.txt 存在
      const reqFile = path.join(projectDir, 'requirements.txt');
      if (!fs.existsSync(reqFile)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
        projectDir = null;
        res.status(400).json({ error: '缺少 requirements.txt' });
        return;
      }

      const installLogs: string[] = [];

      // 创建 venv
      try {
        const { stdout: venvOut, stderr: venvErr } = await execFileAsync(
          'python3', ['-m', 'venv', path.join(projectDir, 'venv')],
          { timeout: 120000 },
        );
        if (venvOut) installLogs.push(venvOut);
        if (venvErr) installLogs.push(venvErr);
      } catch (err: any) {
        installLogs.push(err.stderr || err.message);
        res.status(500).json({
          error: 'Python 虚拟环境创建失败',
          logs: installLogs,
        });
        return;
      }

      // 离线安装依赖
      const pipBin = path.join(projectDir, 'venv', 'bin', 'pip');
      try {
        const { stdout: pipOut, stderr: pipErr } = await execFileAsync(
          pipBin, ['install', '--no-index', '--find-links=' + packagesDir, '-r', reqFile],
          { timeout: 120000 },
        );
        if (pipOut) installLogs.push(pipOut);
        if (pipErr) installLogs.push(pipErr);
      } catch (err: any) {
        installLogs.push(err.stderr || err.message);
        res.status(500).json({
          error: '依赖安装失败，请检查 packages 目录是否完整',
          logs: installLogs,
        });
        return;
      }

      // 扫描入口文件（按优先级）
      const entryFileCandidates = ['server.py', 'main.py', 'app.py', 'index.py'];
      let entryFile: string | null = null;
      for (const candidate of entryFileCandidates) {
        if (fs.existsSync(path.join(projectDir, candidate))) {
          entryFile = candidate;
          break;
        }
      }

      // 构建 command 和 args
      const python3Bin = path.join(projectDir, 'venv', 'bin', 'python3');
      const args = entryFile ? [entryFile] : [];

      // 创建 DB 记录
      const id = `mcp-personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const server = await prisma.mCPServer.create({
        data: {
          id,
          name: projectName,
          description: `Python MCP 项目（上传安装）${entryFile ? '' : ' - 未检测到入口文件，请手动指定'}`,
          scope: 'personal',
          ownerId: user.id,
          transport: 'stdio',
          command: python3Bin,
          args,
          url: null,
          env: {},
          enabled: true,
        },
      });

      // 通知 plugin 刷新
      mcpRegistry.register(toConfig(server));
      notifyMCPRegistryChanged();

      invalidatePromptCache(user.id);
      res.json({
        message: entryFile
          ? `MCP 项目 "${projectName}" 上传安装成功`
          : `MCP 项目 "${projectName}" 上传安装成功，但未检测到入口文件（server.py/main.py/app.py/index.py），请手动指定`,
        server,
        entryFile,
        installLogs,
      });
    } catch (err) {
      // 出错时清理项目目录（如果已创建）
      if (projectDir && fs.existsSync(projectDir)) {
        try {
          fs.rmSync(projectDir, { recursive: true, force: true });
        } catch { /* ignore cleanup errors */ }
      }
      next(err);
    } finally {
      // 清理临时上传文件
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch { /* ignore cleanup errors */ }
      }
    }
  });

  /**
   * 更新个人 MCP Server
   */
  router.put('/personal/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      // 验证所有权
      const existing = await prisma.mCPServer.findUnique({ where: { id } });
      if (!existing || existing.ownerId !== user.id) {
        res.status(404).json({ error: '个人 MCP Server 不存在' });
        return;
      }

      const { name, description, transport, command, args, url, env, enabled } = req.body;

      // 如果更新了 args，重新校验路径
      if (args && args.length > 0) {
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

      const server = await prisma.mCPServer.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description }),
          ...(transport !== undefined && { transport }),
          ...(command !== undefined && { command }),
          ...(args !== undefined && { args }),
          ...(url !== undefined && { url }),
          ...(env !== undefined && { env: sandbox.sanitizeEnv(env) }),
          ...(enabled !== undefined && { enabled }),
        },
      });

      if (mcpExecutor.isConnected(id)) {
        mcpExecutor.disconnect(id);
      }
      mcpRegistry.unregister(id);
      mcpRegistry.register(toConfig(server));
      notifyMCPRegistryChanged();
      invalidatePromptCache(user.id);

      res.json({ message: '个人 MCP Server 已更新', server });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 删除个人 MCP Server
   */
  router.delete('/personal/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const existing = await prisma.mCPServer.findUnique({ where: { id } });
      if (!existing || existing.ownerId !== user.id) {
        res.status(404).json({ error: '个人 MCP Server 不存在' });
        return;
      }

      // 引用完整性检查
      const allAgents = await prisma.agent.findMany({ where: { ownerId: user.id }, select: { name: true, ownerId: true, mcpFilter: true } });
      const referencingAgents = allAgents.filter((a: any) => {
        const filter = a.mcpFilter as string[] | null;
        return Array.isArray(filter) && (filter.includes(id) || filter.includes(existing.name));
      });
      if (referencingAgents.length > 0) {
        const names = referencingAgents.map((a: any) => a.name).join(', ');
        res.status(409).json({ error: `无法删除：以下 Agent 仍在使用此 MCP Server：${names}。请先取消关联后再删除。` });
        return;
      }

      if (mcpExecutor.isConnected(id)) {
        mcpExecutor.disconnect(id);
      }
      mcpRegistry.unregister(id);

      await prisma.mCPServer.delete({ where: { id } });

      // 通知 plugin 侧刷新工具注册表
      notifyMCPRegistryChanged();

      invalidatePromptCache(user.id);
      res.json({ message: '个人 MCP Server 已删除' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/**
 * 获取用户可用的完整 MCP 服务器列表（企业级 + 个人级）
 * 企业级：全员可用（enabled=true，scope='enterprise'）
 * 个人级：仅自己创建的（scope='personal'，ownerId=userId）
 * 若 agentMcpFilter 非 null，则按 name/id 过滤
 */
export async function getMergedMCPServers(
  prisma: AppPrismaClient,
  userId: string,
  agentMcpFilter: string[] | null = null,
) {
  const servers = await prisma.mCPServer.findMany({
    where: {
      enabled: true,
      OR: [
        { scope: 'enterprise' },
        { scope: 'personal', ownerId: userId },
      ],
    },
  });

  if (agentMcpFilter !== null) {
    return servers.filter((s: any) => agentMcpFilter.includes(s.name) || agentMcpFilter.includes(s.id));
  }

  return servers;
}
