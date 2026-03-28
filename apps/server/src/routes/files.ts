/**
 * 文件管理路由
 *
 * POST   /api/files/upload              - 上传文件到 workspace/files/
 * GET    /api/files/list?dir=files       - 列出文件（files/ 或 outputs/）
 * GET    /api/files/download/:path       - 下载文件
 * DELETE /api/files/:path               - 删除文件
 * GET    /api/files/info/:path          - 获取文件信息
 *
 * 安全策略：
 * - 文件类型白名单
 * - 单文件大小限制（默认 20MB）
 * - 路径验证（防穿越）
 */

import { Router, NextFunction } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { randomBytes } from 'crypto';
import type { GatewayConfig } from '../config';
import { getRuntimeConfig } from '../config';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import type { AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import type { AppPrismaClient } from '../types/prisma';
import { createLogger } from '../utils/logger';

const logger = createLogger('files');

// 一次性下载 token 存储（替代 URL 中传递 JWT）
const downloadTokens = new Map<string, { userId: string; filePath: string; expires: number }>();

// 定期清理过期 token（每分钟）
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of downloadTokens) {
    if (now > val.expires) downloadTokens.delete(key);
  }
}, 60 * 1000);

// ========== 安全配置 ==========

/** 允许上传的文件扩展名白名单 */
const ALLOWED_EXTENSIONS = new Set([
  // 文档
  '.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.toml',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  // 代码
  '.py', '.js', '.ts', '.html', '.css', '.sql', '.sh',
  // 数据
  '.log', '.jsonl',
  // 图片
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.webp',
  // 压缩
  '.zip', '.tar', '.gz',
]);

export function createFilesRouter(
  _config: GatewayConfig,
  authService: AuthService,
  workspaceManager: WorkspaceManager,
  prismaClient?: AppPrismaClient,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prismaClient);

  /** 最大文件大小（字节），从运行时配置读取 */
  const MAX_FILE_SIZE = getRuntimeConfig().upload.maxFileSizeBytes;

  // multer 配置：使用内存存储（先验证再写入）
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        cb(new Error(`不允许的文件类型: ${ext}`));
        return;
      }
      cb(null, true);
    },
  });

  /**
   * 上传文件
   *
   * POST /api/files/upload
   * Body: multipart/form-data, field name = "file"
   * Optional query: ?subdir=reports (子目录)
   */
  router.post('/upload', authMiddleware, (req: AuthenticatedRequest, res) => {
    upload.single('file')(req, res, async (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            res.status(413).json({ error: `文件大小超过限制 (${MAX_FILE_SIZE / 1024 / 1024}MB)` });
            return;
          }
          res.status(400).json({ error: err.message });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }

      try {
        const user = req.user!;
        const file = (req as { file?: Express.Multer.File }).file;
        if (!file) {
          res.status(400).json({ error: '没有上传文件' });
          return;
        }

        // 确保用户工作空间已初始化
        await workspaceManager.initWorkspace(user.id, user.username || user.id);

        // 配额拦截：超限时拒绝上传
        try {
          await workspaceManager.enforceQuota(user.id);
        } catch (quotaErr: unknown) {
          res.status(413).json({ error: quotaErr instanceof Error ? quotaErr.message : String(quotaErr) });
          return;
        }

        // 确定目标目录
        const subdir = (req.query.subdir as string) || '';

        // 子目录安全检查：禁止 .. 和绝对路径
        if (subdir && (subdir.includes('..') || path.isAbsolute(subdir) || subdir.includes('\0'))) {
          res.status(403).json({ error: '子目录名称不合法' });
          return;
        }

        const filesDir = workspaceManager.getSubPath(user.id, 'FILES');
        const targetDir = subdir ? path.join(filesDir, subdir) : filesDir;

        // 确保目录存在
        await fsp.mkdir(targetDir, { recursive: true });

        // 安全文件名
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._\u4e00-\u9fa5-]/g, '_');
        const targetPath = path.join(targetDir, safeName);

        // 防止覆盖：如果文件已存在，加时间戳
        let finalPath = targetPath;
        if (fs.existsSync(targetPath)) {
          const ext = path.extname(safeName);
          const base = path.basename(safeName, ext);
          finalPath = path.join(targetDir, `${base}_${Date.now()}${ext}`);
        }

        // 写入文件
        await fsp.writeFile(finalPath, file.buffer);

        const relativePath = path.relative(workspaceManager.getWorkspacePath(user.id), finalPath);
        res.json({
          message: '上传成功',
          file: {
            name: path.basename(finalPath),
            path: relativePath,
            size: file.size,
            type: file.mimetype,
          },
        });
      } catch (err: unknown) {
        // Upload handler 内无法使用 next()（multer 回调上下文），保留直接响应但隐藏内部信息
        logger.error('POST /api/files/upload', { error: err instanceof Error ? err.message : String(err) });
        res.status(500).json({ error: '服务器内部错误，请稍后重试' });
      }
    });
  });

  /**
   * 列出文件
   *
   * GET /api/files/list?dir=files|outputs&subdir=reports
   */
  router.get('/list', authMiddleware, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const user = req.user!;
      await workspaceManager.initWorkspace(user.id, user.username || user.id);
      const dirType = (req.query.dir as string) || 'files';
      const subdir = (req.query.subdir as string) || '';

      // 目录类型白名单检查
      if (!['files', 'outputs'].includes(dirType)) {
        res.status(400).json({ error: '目录类型不合法，仅支持 files 或 outputs' });
        return;
      }

      // 子目录安全检查：禁止路径穿越（与上传接口一致）
      if (subdir && (subdir.includes('..') || path.isAbsolute(subdir) || subdir.includes('\0'))) {
        res.status(403).json({ error: '子目录名称不合法' });
        return;
      }

      // 确定根目录
      let rootDir: string;
      if (dirType === 'outputs') {
        rootDir = workspaceManager.getSubPath(user.id, 'OUTPUTS');
      } else {
        rootDir = workspaceManager.getSubPath(user.id, 'FILES');
      }

      const targetDir = subdir ? path.join(rootDir, subdir) : rootDir;

      // 二次防御：resolve 后确认路径仍在 rootDir 内
      const resolvedTarget = path.resolve(targetDir);
      if (!resolvedTarget.startsWith(path.resolve(rootDir))) {
        res.status(403).json({ error: '路径越权访问' });
        return;
      }

      if (!fs.existsSync(targetDir)) {
        res.json({ dir: dirType, subdir, files: [] });
        return;
      }

      const entries = await fsp.readdir(targetDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter(e => !e.name.startsWith('.'))
          .map(async (e) => {
            const fullPath = path.join(targetDir, e.name);
            const stat = await fsp.stat(fullPath);
            return {
              name: e.name,
              isDirectory: e.isDirectory(),
              size: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            };
          }),
      );

      // 目录排前面，其次按修改时间倒序
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
      });

      res.json({ dir: dirType, subdir, files });
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  /**
   * 签发一次性下载 token（5 分钟有效）
   *
   * GET /api/files/download-token?path=files/report.xlsx
   * 返回 { token, expiresIn } — 用于 /download/* 接口的 ?token= 参数
   */
  router.get('/download-token', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ error: '缺少 path 参数' });
      return;
    }

    const user = req.user!;

    // 防止内存无限增长
    if (downloadTokens.size >= 10000) {
      res.status(429).json({ error: '下载令牌数量超限，请稍后重试' });
      return;
    }

    const token = randomBytes(16).toString('hex');
    downloadTokens.set(token, {
      userId: user.id,
      filePath,
      expires: Date.now() + getRuntimeConfig().files.tempLinkExpiryMs,
    });

    res.json({ token, expiresIn: 300 });
  });

  /**
   * 下载文件
   *
   * GET /api/files/download/:filepath
   * filepath 是相对于用户 workspace 的路径（URL encoded）
   * 示例: /api/files/download/files%2Freport.xlsx
   *       /api/files/download/outputs%2Fdashboard.html
   *
   * 认证方式（优先级从高到低）：
   * 1. 一次性下载 token（推荐）：?token=<download-token>
   * 2. Authorization header（标准）
   * 3. JWT URL 参数（已废弃）：?token=<jwt>
   */
  router.get('/download/*', async (req: AuthenticatedRequest, res, next) => {
    const queryToken = req.query.token as string | undefined;

    if (queryToken) {
      // 优先检查一次性下载 token
      const downloadEntry = downloadTokens.get(queryToken);
      if (downloadEntry && Date.now() <= downloadEntry.expires) {
        downloadTokens.delete(queryToken); // 一次性消费
        // 设置 req.user 用于后续逻辑，跳过 authMiddleware
        (req as AuthenticatedRequest).user = { id: downloadEntry.userId } as AuthenticatedRequest['user'];
        return next();
      }

      // 回退：兼容旧的 JWT token（打印 deprecation 警告）
      if (!req.headers.authorization) {
        logger.warn('DEPRECATED: JWT 通过 URL 查询参数传递，请改用 /download-token 接口');
        req.headers.authorization = `Bearer ${queryToken}`;
      }
    }

    // 继续走正常的 auth 中间件
    authMiddleware(req, res, next);
  }, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const user = req.user!;
      const relativePath = req.params[0]; // Express wildcard capture

      if (!relativePath) {
        res.status(400).json({ error: '文件路径不能为空' });
        return;
      }

      const userRoot = workspaceManager.getWorkspacePath(user.id);
      const fullPath = path.join(userRoot, relativePath);

      // 路径安全验证
      const validation = await workspaceManager.validatePath(user.id, fullPath);
      if (!validation.valid) {
        res.status(403).json({ error: `路径不合法: ${validation.reason}` });
        return;
      }

      if (!fs.existsSync(fullPath) || !(await fsp.stat(fullPath)).isFile()) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }

      const filename = path.basename(fullPath);
      const isPreview = req.query.preview === 'true';

      if (isPreview) {
        // 预览模式：inline 展示，根据文件类型设置 Content-Type
        const ext = path.extname(filename).toLowerCase();
        const mimeMap: Record<string, string> = {
          '.txt': 'text/plain; charset=utf-8',
          '.md': 'text/plain; charset=utf-8',
          '.csv': 'text/plain; charset=utf-8',
          '.json': 'application/json; charset=utf-8',
          '.xml': 'text/xml; charset=utf-8',
          '.yaml': 'text/plain; charset=utf-8',
          '.yml': 'text/plain; charset=utf-8',
          '.toml': 'text/plain; charset=utf-8',
          '.py': 'text/plain; charset=utf-8',
          '.js': 'text/plain; charset=utf-8',
          '.ts': 'text/plain; charset=utf-8',
          '.css': 'text/plain; charset=utf-8',
          '.sql': 'text/plain; charset=utf-8',
          '.sh': 'text/plain; charset=utf-8',
          '.log': 'text/plain; charset=utf-8',
          '.jsonl': 'text/plain; charset=utf-8',
          '.html': 'text/html; charset=utf-8',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
          '.webp': 'image/webp',
          '.pdf': 'application/pdf',
        };
        const contentType = mimeMap[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);
        // SVG/HTML 可能含脚本，强制下载不允许 inline 预览
        if (ext === '.svg' || ext === '.html' || ext === '.htm') {
          res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        } else {
          res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
        }
      } else {
        // 下载模式
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      }
      res.sendFile(fullPath);
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  /**
   * 获取文件信息
   *
   * GET /api/files/info/*
   */
  router.get('/info/*', authMiddleware, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const user = req.user!;
      const relativePath = req.params[0];

      const userRoot = workspaceManager.getWorkspacePath(user.id);
      const fullPath = path.join(userRoot, relativePath);

      const validation = await workspaceManager.validatePath(user.id, fullPath);
      if (!validation.valid) {
        res.status(403).json({ error: `路径不合法: ${validation.reason}` });
        return;
      }

      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }

      const stat = await fsp.stat(fullPath);
      res.json({
        name: path.basename(fullPath),
        path: relativePath,
        size: stat.size,
        isDirectory: stat.isDirectory(),
        createdAt: stat.birthtime.toISOString(),
        modifiedAt: stat.mtime.toISOString(),
      });
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  /**
   * 删除文件
   *
   * DELETE /api/files/*
   * 仅允许删除 files/ 目录下的文件（outputs/ 受保护）
   */
  router.delete('/*', authMiddleware, async (req: AuthenticatedRequest, res, next: NextFunction) => {
    try {
      const user = req.user!;
      const relativePath = req.params[0];

      if (!relativePath) {
        res.status(400).json({ error: '文件路径不能为空' });
        return;
      }

      // outputs/ 中的文件允许用户删除（已有文件清理机制兜底）
      // 仅禁止删除 outputs 目录本身
      if (relativePath === 'outputs' || relativePath === 'outputs/') {
        res.status(403).json({ error: '不允许删除 outputs 根目录' });
        return;
      }

      const userRoot = workspaceManager.getWorkspacePath(user.id);
      const fullPath = path.join(userRoot, relativePath);

      const validation = await workspaceManager.validatePath(user.id, fullPath);
      if (!validation.valid) {
        res.status(403).json({ error: `路径不合法: ${validation.reason}` });
        return;
      }

      if (!fs.existsSync(fullPath)) {
        res.status(404).json({ error: '文件不存在' });
        return;
      }

      const stat = await fsp.stat(fullPath);
      if (stat.isDirectory()) {
        await fsp.rm(fullPath, { recursive: true });
      } else {
        await fsp.unlink(fullPath);
      }

      // 如果删除的是 outputs 下的文件，同步更新 DB 状态
      if (relativePath.startsWith('outputs/') && prismaClient) {
        try {
          await prismaClient.generatedFile.updateMany({
            where: { userId: user.id, filePath: relativePath, status: 'active' },
            data: { status: 'deleted' },
          });
        } catch { /* DB 同步失败不阻断删除响应 */ }
      }

      res.json({ message: '删除成功', path: relativePath });
    } catch (err: unknown) {
      next(err instanceof Error ? err : new Error(String(err)));
    }
  });

  return router;
}
