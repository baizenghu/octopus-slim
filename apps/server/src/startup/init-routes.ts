/**
 * init-routes.ts — Express 应用创建、中间件、路由挂载
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import express, { type Express } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AuthService } from '@octopus/auth';
import { WorkspaceManager } from '@octopus/workspace';
import { AuditLogger, createAuditMiddleware } from '@octopus/audit';
import { MCPRegistry, MCPExecutor } from '@octopus/mcp';
import { EngineAdapter } from '../services/EngineAdapter';
import { IMService } from '../services/im';
import { createAuthRouter } from '../routes/auth';
import { createChatRouter } from '../routes/chat';
import { createSessionsRouter } from '../routes/sessions';
import { createAuditRouter } from '../routes/audit';
import { createAdminRouter } from '../routes/admin';
import { createFilesRouter } from '../routes/files';
import { createToolSourcesRouter } from '../routes/tool-sources';
import { createAgentsRouter } from '../routes/agents';
import { createSchedulerRouter } from '../routes/scheduler';
import { createDbConnectionsRouter } from '../routes/db-connections';
import { createImInternalRouter } from '../routes/im-internal';
import { createChatInternalRouter } from '../routes/chat-internal';
import { createWeixinRoutes } from '../routes/weixin';
import { createSystemConfigRouter } from '../routes/system-config';
import { globalErrorHandler } from '../middleware/error-handler';
import { register, metricsMiddleware } from '../middleware/metrics';
import { securityMonitor } from '../services/SecurityMonitor';
import { loadConfig, getRuntimeConfig } from '../config';
import type { AppPrismaClient } from '../types/prisma';
import type Redis from 'ioredis';
import { createLogger } from '../utils/logger';

const logger = createLogger('startup');

type AppConfig = ReturnType<typeof loadConfig>;

export async function initRoutes(params: {
  config: AppConfig;
  authService: AuthService;
  workspaceManager: WorkspaceManager;
  prismaClient?: AppPrismaClient;
  auditLogger: AuditLogger;
  bridge?: EngineAdapter;
  mcpRegistry: MCPRegistry;
  mcpExecutor: MCPExecutor;
  imService?: IMService;
  redisClient?: Redis;
}): Promise<{ app: Express; server: http.Server }> {
  const {
    config, authService, workspaceManager, prismaClient,
    auditLogger, bridge, mcpRegistry, mcpExecutor, imService, redisClient,
  } = params;

  // ── Express 应用 ──
  const app = express();

  // 信任本地反向代理（frp），确保 req.ip 返回真实客户端 IP
  app.set('trust proxy', ['loopback', 'uniquelocal']);

  app.use(cors({ origin: config.corsOrigins, credentials: true }));

  // 安全 HTTP Headers
  app.use(helmet({
    contentSecurityPolicy: false, // 不影响 SSE 推送
    crossOriginEmbedderPolicy: false,
  }));

  app.use(express.json({ limit: '10mb' }));

  // 审计中间件（自动记录路由级审计日志）
  app.use(createAuditMiddleware(auditLogger));

  // 安全监控中间件（检测异常 API 调用频率）
  app.use((req, _res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    securityMonitor.recordApiCall(ip, req.path);
    next();
  });

  // metrics 中间件（在路由注册前，安全中间件之后）
  app.use(metricsMiddleware);

  // ── 健康检查 ──
  const startTime = Date.now();
  app.get('/health', async (_req, res) => {
    let dbStatus: 'connected' | 'error' = 'error';
    if (prismaClient) {
      try {
        await prismaClient.$queryRaw`SELECT 1`;
        dbStatus = 'connected';
      } catch {
        dbStatus = 'error';
      }
    }

    let redisStatus: 'connected' | 'error' | 'not configured' = 'not configured';
    if (redisClient) {
      try {
        await redisClient.ping();
        redisStatus = 'connected';
      } catch {
        redisStatus = 'error';
      }
    }
    // 引擎存活检查：不仅检查连接对象，还实际调用 RPC 确认引擎响应
    let nativeGatewayStatus: 'running' | 'stopped' = 'stopped';
    if (bridge?.isConnected) {
      try {
        await bridge.call('health', {});
        nativeGatewayStatus = 'running';
      } catch {
        nativeGatewayStatus = 'stopped';
      }
    }
    const overallStatus = (nativeGatewayStatus === 'stopped' || dbStatus === 'error')
      ? 'degraded' : 'ok';
    const httpStatus = overallStatus === 'ok' ? 200 : 503;

    res.status(httpStatus).json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      services: {
        nativeGateway: nativeGatewayStatus,
        database: dbStatus,
        redis: redisStatus,
      },
    });
  });

  // ── Prometheus metrics ──
  app.get('/metrics', async (req, res) => {
    const remoteIp = req.socket.remoteAddress;
    if (remoteIp !== '127.0.0.1' && remoteIp !== '::1' && remoteIp !== '::ffff:127.0.0.1') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  });

  // ── 登录/刷新接口频率限制 ──
  const authLimiter = rateLimit({
    windowMs: getRuntimeConfig().security.rateLimitWindowMs,
    max: getRuntimeConfig().security.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/refresh', authLimiter);

  // ── Chat API 频率限制（防 LLM 配额滥用）──
  const chatLimiter = rateLimit({
    windowMs: 60_000, // 1 分钟窗口
    max: 30,          // 每用户每分钟最多 30 条消息
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as any).user?.id || req.ip || 'anonymous',
    message: { error: '消息发送过于频繁，请稍后再试' },
  });
  app.use('/api/chat', chatLimiter);

  // ── 管理接口频率限制（防止资源耗尽）──
  const adminLimiter = rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req as any).user?.id || req.ip || 'anonymous',
    message: { error: '操作过于频繁，请稍后再试' },
  });
  app.use('/api/admin', adminLimiter);
  app.use('/api/tool-sources', adminLimiter);

  // Fail-fast: DB 连接失败时直接退出，避免路由运行时 TypeError
  if (!prismaClient) {
    logger.error('数据库连接失败，Gateway 无法启动');
    process.exit(1);
  }

  // ── API 路由 ──
  app.use('/api/auth', createAuthRouter(authService, workspaceManager, prismaClient, config.workspace.dataRoot));
  app.use('/api/chat', createChatRouter(config, authService, workspaceManager, bridge, prismaClient, auditLogger));
  app.use('/api/chat', createSessionsRouter(authService, bridge, prismaClient));
  app.use('/api/audit', createAuditRouter(authService, auditLogger, prismaClient));
  app.use('/api/admin', createAdminRouter(authService, prismaClient!, workspaceManager, bridge));
  if (bridge) {
    app.use('/api/admin/config', createSystemConfigRouter(authService, bridge, prismaClient));
  }
  app.use('/api/files', createFilesRouter(authService, workspaceManager, prismaClient));
  const toolSourcesRouter = createToolSourcesRouter(authService, prismaClient!, mcpRegistry, mcpExecutor, config.workspace.dataRoot, bridge);
  app.use('/api/tool-sources', toolSourcesRouter);
  app.use('/api/skills', toolSourcesRouter);  // 前端兼容别名
  app.use('/api/agents', createAgentsRouter(authService, prismaClient!, workspaceManager, bridge, config.workspace.dataRoot));
  app.use('/api/scheduler', createSchedulerRouter(authService, prismaClient!, bridge, imService));
  app.use('/api/user/db-connections', createDbConnectionsRouter(authService, prismaClient));
  if (imService?.weixinManager) {
    app.use('/api/user/weixin', createWeixinRoutes({ authService, prisma: prismaClient, weixinManager: imService.weixinManager }));
  }
  if (imService) {
    app.use('/api/_internal/im', createImInternalRouter(imService, workspaceManager));
  }
  if (bridge) {
    app.use('/api/_internal/chat', createChatInternalRouter(bridge, workspaceManager, config.workspace.dataRoot));
  }

  // 全局错误处理（5xx 不泄漏内部信息，4xx 保留业务消息）
  app.use(globalErrorHandler);

  // ── 确保 MCP 项目统一目录存在 ──
  const mcpServersDir = path.resolve(config.workspace.dataRoot, 'mcp-servers');
  if (!fs.existsSync(mcpServersDir)) {
    fs.mkdirSync(mcpServersDir, { recursive: true });
  }

  // ── 启动时清理孤儿 Skill 目录 ──
  const enterpriseSkillsDir = path.resolve(config.workspace.dataRoot, 'skills');
  try {
    const entries = fs.readdirSync(enterpriseSkillsDir, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('skill-'));
    if (skillDirs.length > 0) {
      const dbSkills = await prismaClient.toolSource.findMany({
        where: { type: 'skill', scope: 'enterprise' },
        select: { id: true },
      });
      const dbIds = new Set(dbSkills.map(s => s.id));
      let cleaned = 0;
      for (const dir of skillDirs) {
        if (!dbIds.has(dir.name)) {
          fs.rmSync(path.join(enterpriseSkillsDir, dir.name), { recursive: true, force: true });
          cleaned++;
          logger.info(`Cleaned orphan skill directory: ${dir.name}`);
        }
      }
      if (cleaned > 0) {
        logger.info(`Cleaned ${cleaned} orphan skill director${cleaned > 1 ? 'ies' : 'y'}`);
      }
    }
  } catch (e: unknown) {
    logger.warn('Orphan cleanup failed', { error: e instanceof Error ? e.message : String(e) });
  }

  // ── 启动服务器 ──
  const bindHost = process.env.BIND_HOST || '127.0.0.1';
  logger.info(`Attempting to listen on ${bindHost}:${config.port} (PID: ${process.pid})`);
  const server = app.listen(config.port, bindHost, () => {
    logger.info(`✅ Gateway started on http://${bindHost}:${config.port}`);
    logger.info(`Health: http://localhost:${config.port}/health`);
    logger.info('Model: configured in octopus.json (unified)');
    logger.info(`LDAP: ${config.mockLdap ? 'Mock (dev)' : config.ldap.url}`);
    logger.info(`Data: ${config.workspace.dataRoot}`);
    logger.info(`Audit: ${config.audit.logDir} (${config.audit.retentionDays}d retention)`);
  });

  return { app, server };
}
