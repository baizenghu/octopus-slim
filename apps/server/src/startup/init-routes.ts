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

    const redisStatus = redisClient ? 'connected' : 'not configured';
    const nativeGatewayStatus = bridge?.isConnected ? 'running' : 'stopped';
    const pluginStatus = (_name: string) => {
      return bridge?.isConnected ? 'loaded' as const : 'not loaded' as const;
    };
    const overallStatus = (nativeGatewayStatus === 'stopped' || dbStatus === 'error')
      ? 'degraded' : 'ok';

    res.json({
      // 向后兼容字段
      status: overallStatus,
      nativeGateway: nativeGatewayStatus,
      // 新增结构化字段
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      services: {
        nativeGateway: nativeGatewayStatus,
        database: dbStatus,
        redis: redisStatus,
        mockLdap: config.mockLdap,
      },
      plugins: {
        'enterprise-audit': pluginStatus('enterprise-audit'),
        'enterprise-mcp': pluginStatus('enterprise-mcp'),
        'memory-lancedb-pro': pluginStatus('memory-lancedb-pro'),
      },
      model: 'configured in octopus.json',
    });
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

  // Fail-fast: DB 连接失败时直接退出，避免路由运行时 TypeError
  if (!prismaClient) {
    logger.error('数据库连接失败，Gateway 无法启动');
    process.exit(1);
  }

  // ── API 路由 ──
  app.use('/api/auth', createAuthRouter(authService, workspaceManager, prismaClient, config.workspace.dataRoot));
  app.use('/api/chat', createChatRouter(config, authService, workspaceManager, bridge, prismaClient, auditLogger));
  app.use('/api/chat', createSessionsRouter(config, authService, workspaceManager, bridge, prismaClient, auditLogger));
  app.use('/api/audit', createAuditRouter(authService, auditLogger, prismaClient));
  app.use('/api/admin', createAdminRouter(authService, auditLogger, prismaClient!, workspaceManager, bridge));
  if (bridge) {
    app.use('/api/admin/config', createSystemConfigRouter(authService, bridge, prismaClient));
  }
  app.use('/api/files', createFilesRouter(config, authService, workspaceManager, prismaClient));
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
  } catch (e: any) {
    logger.warn('Orphan cleanup failed', { error: e.message });
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
