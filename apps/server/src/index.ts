/**
 * Octopus Enterprise Gateway
 * 
 * 企业级 API 网关入口
 * 
 * 功能：
 * - REST API（Express）：认证 + 对话 + 审计
 * - SSE 流式响应
 * - 集成 enterprise-auth, enterprise-workspace, enterprise-audit
 * - 通过 OpenAI 兼容接口代理到 DeepSeek API
 */

// 加载项目根 .env，确保不依赖外部 shell 注入环境变量
import dotenv from 'dotenv';
import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

// 引擎 state 目录指向项目内（确保不读 ~/.octopus/）
const projectRoot = path.resolve(__dirname, '..', '..', '..');
if (!process.env.OCTOPUS_HOME) {
  process.env.OCTOPUS_HOME = path.join(projectRoot, '.octopus-state');
}
if (!process.env.OCTOPUS_STATE_DIR) {
  process.env.OCTOPUS_STATE_DIR = path.join(projectRoot, '.octopus-state');
}

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { AuthService } from '@octopus/auth';
import { WorkspaceManager } from '@octopus/workspace';
import { AuditLogger, createAuditMiddleware } from '@octopus/audit';
import { loadConfig, initRuntimeConfig, getRuntimeConfig } from './config';
import { createAuthRouter } from './routes/auth';
import { createChatRouter } from './routes/chat';
import { createSessionsRouter } from './routes/sessions';
import { createAuditRouter } from './routes/audit';
import { createAdminRouter } from './routes/admin';
import { createFilesRouter } from './routes/files';
import { createMcpRouter } from './routes/mcp';
import { createSkillsRouter } from './routes/skills';
import { createAgentsRouter } from './routes/agents';
import { createSchedulerRouter } from './routes/scheduler';
import { createDbConnectionsRouter } from './routes/db-connections';
import { createImInternalRouter } from './routes/im-internal';
import { createChatInternalRouter } from './routes/chat-internal';
import { createWeixinRoutes } from './routes/weixin';
import { createSystemConfigRouter } from './routes/system-config';
import { MCPRegistry, MCPExecutor } from '@octopus/mcp';
import { EngineAdapter } from './services/EngineAdapter';
import { ensureAgentTemplates } from './services/SoulTemplate';
import { IMService } from './services/im';
import { globalErrorHandler } from './middleware/error-handler';
import { securityMonitor } from './services/SecurityMonitor';
import type { AppPrismaClient } from './types/prisma';
import Redis from 'ioredis';

async function main() {
  console.log('🚀 Starting Octopus AI Gateway...');

  // 1. 加载配置
  const config = loadConfig();

  // 初始化 Redis（供认证锁定和 Token 黑名单使用）
  let redisClient: Redis | undefined;
  if (process.env.REDIS_URL) {
    try {
      redisClient = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      });
      await redisClient.connect();
      console.log('   Redis: connected (auth)');
    } catch (err: any) {
      console.warn('   Redis: unavailable for auth, using in-memory fallback');
      redisClient = undefined;
    }
  }

  // 2. 初始化企业模块
  const authService = new AuthService({
    ldap: config.ldap,
    jwt: config.jwt,
    mockLdap: config.mockLdap,
  }, redisClient);

  const workspaceManager = new WorkspaceManager({
    dataRoot: config.workspace.dataRoot,
    defaultStorageQuota: config.workspace.defaultStorageQuota,
  });

  // 初始化数据库（Admin 路由 + 审计日志共用）
  let prismaClient: AppPrismaClient | undefined = undefined;
  try {
    const { getPrismaClient } = await import('@octopus/database');
    prismaClient = getPrismaClient();
    console.log('   Database: connected');

    // 迁移明文密码为 bcrypt 哈希（兼容旧数据，只执行一次）
    if (prismaClient && !(globalThis as any).__passwordMigrationDone) {
      (globalThis as any).__passwordMigrationDone = true;
      try {
        const bcryptMigrate = await import('bcryptjs');
        const usersToMigrate = await prismaClient.user.findMany({
          select: { userId: true, passwordHash: true },
        });
        let migrated = 0;
        for (const u of usersToMigrate) {
          if (u.passwordHash && !u.passwordHash.startsWith('$2a$') && !u.passwordHash.startsWith('$2b$')) {
            const hashed = bcryptMigrate.hashSync(u.passwordHash, 12);
            await prismaClient.user.update({
              where: { userId: u.userId },
              data: { passwordHash: hashed },
            });
            migrated++;
          }
        }
        if (migrated > 0) {
          console.log(`   Password migration: upgraded ${migrated} plaintext passwords to bcrypt`);
        }
      } catch (migrateErr: any) {
        console.warn('   Password migration warning:', migrateErr.message);
      }
    }

    // 从数据库批量同步用户到 MockLDAP（使 Admin Console 创建的用户在重启后仍可登录）
    if (config.mockLdap && prismaClient) {
      try {
        const dbUsers = await prismaClient.user.findMany({
          select: { username: true, email: true, displayName: true, department: true, passwordHash: true },
        });
        let synced = 0;
        const failed: string[] = [];
        for (const u of dbUsers) {
          try {
            const ok = authService.registerMockUser(
              {
                username: u.username,
                email: u.email || '',
                displayName: u.displayName || u.username,
                department: u.department || '',
              },
              u.passwordHash || undefined,
            );
            if (ok) synced++;
          } catch {
            failed.push(u.username);
          }
        }
        if (synced > 0 || failed.length > 0) {
          console.log(`   MockLDAP: synced ${synced}/${dbUsers.length} users from database${failed.length > 0 ? ` (${failed.length} failed: ${failed.join(', ')})` : ''}`);
        }
      } catch (syncErr: any) {
        console.warn('   MockLDAP sync warning:', syncErr.message);
      }
    }
  } catch (err) {
    console.warn('   Database: unavailable (admin features will be limited)');
  }

  const auditLogger = new AuditLogger({
    logDir: config.audit.logDir,
    retentionDays: config.audit.retentionDays,
    enableDatabase: config.audit.enableDatabase && !!prismaClient,
    prisma: prismaClient,
  });

  // 启动时清理过期审计导出文件（24 小时前）
  auditLogger.cleanup().then((n: number) => {
    if (n > 0) console.log(`[audit] Cleaned up ${n} expired export files`);
  }).catch(() => {});

  // 启动文件清理服务
  if (prismaClient) {
    const { FileCleanupService } = await import('./services/FileCleanupService');
    const fileCleanup = new FileCleanupService({
      dataRoot: config.workspace.dataRoot,
      cleanup: config.cleanup,
      prisma: prismaClient,
    });
    fileCleanup.start();
  }

  // 初始化 Native Gateway Bridge
  let bridge: EngineAdapter | undefined;
  let imService: IMService | undefined;
  if (config.nativeGateway.token) {
    bridge = new EngineAdapter();
    try {
      await bridge.initialize(19791);
      console.log('   Engine: initialized (single-process)');

      // 初始化运行时配置（从独立的 enterprise.json 读取，不放 octopus.json 避免引擎校验失败）
      try {
        const stateDir = process.env.OCTOPUS_STATE_DIR || path.join(projectRoot, '.octopus-state');
        const raw = await fsPromises.readFile(path.join(stateDir, 'enterprise.json'), 'utf-8');
        initRuntimeConfig(JSON.parse(raw));
        console.log('[runtime-config] Loaded from enterprise.json');
      } catch (err) {
        console.warn('[runtime-config] enterprise.json not found, using defaults');
        initRuntimeConfig();
      }

      // 启动时将数据库中所有已启用的 Agent 并发同步到原生 Gateway
      if (prismaClient) {
        try {
          const agents = await prismaClient.agent.findMany({ where: { enabled: true } });
          const createResults = await Promise.allSettled(
            agents.map(async (agent) => {
              const nativeId = EngineAdapter.userAgentId(agent.ownerId, agent.name);
              const workspacePath = workspaceManager.getAgentWorkspacePath(agent.ownerId, agent.name);
              try {
                await bridge!.agentsCreate({ name: nativeId, workspace: workspacePath });
              } catch { /* 已存在则忽略 */ }
              return { agent, nativeId };
            })
          );
          let failCount = 0;
          for (const r of createResults) {
            if (r.status === 'rejected') {
              failCount++;
              console.error('[startup] Agent create failed:', r.reason);
            }
          }
          if (agents.length > 0) {
            const successCount = agents.length - failCount;
            console.log(`   Native Gateway: synced ${successCount}/${agents.length} agents (concurrent)`);
          }
        } catch (syncErr: any) {
          console.warn('   Native Gateway agent sync warning:', syncErr.message);
        }
      }

      // 监听 native cron 事件（仅用于调试/日志；提醒通过 chat 路由的 setTimeout 处理）
      bridge.on('cron', (payload: any) => {
        if (payload?.action === 'started' || payload?.action === 'finished') {
          console.log(`[cron] job ${payload.jobId} ${payload.action}`);
        }
      });

      // 启动 IM 服务（飞书等）
      if (prismaClient && bridge) {
        const imBridge = bridge; // 局部变量避免 TypeScript 闭包 narrowing 问题
        imService = new IMService({
          prisma: prismaClient,
          bridge: imBridge,
          authService,
          dataRoot: config.workspace.dataRoot,
          workspaceManager,
          auditLogger,
          ensureAgent: async (userId: string, agentName: string) => {
            const nativeAgentId = EngineAdapter.userAgentId(userId, agentName);
            const workspacePath = agentName === 'default'
              ? path.join(config.workspace.dataRoot, 'users', userId, 'workspace')
              : path.join(config.workspace.dataRoot, 'users', userId, 'agents', agentName, 'workspace');
            try {
              await imBridge.agentsCreate({ name: nativeAgentId, workspace: workspacePath });
              // 原生 gateway 异步初始化 workspace，等待就绪
              await new Promise(r => setTimeout(r, getRuntimeConfig().engine.agentInitTimeoutMs));
            } catch { /* 已存在则忽略 */ }
          },
        });
        await imService.start();

        // 监听引擎心跳事件 — 异常时自动推送 IM 告警
        // 事件字段：status(completed/skipped), reason(target-none等), preview(回复摘要), agentId, durationMs
        const heartbeatImService = imService;
        bridge.on('heartbeat', (evt: any) => {
          const content = evt.preview || evt.reply || '';
          const isAlert = content && !content.includes('HEARTBEAT_OK');
          console.log(`[heartbeat] event: status=${evt.status}, reason=${evt.reason || 'n/a'}, alert=${isAlert}, agent=${evt.agentId || 'default'}`);

          // 推送条件：有内容且不含 HEARTBEAT_OK
          if (isAlert) {
            // 从 agentId 提取 userId（ent_{userId}_{agentName}）
            const match = evt.agentId?.match(/^ent_(.+?)_[^_]+$/);
            let userIds: string[] = [];
            if (match?.[1]) {
              userIds = [`user-${match[1]}`];
            } else {
              // agentId 为 default 或无法解析 — 查 DB 找有心跳任务的所有用户
              prismaClient!.scheduledTask.findMany({
                where: { taskType: 'heartbeat', enabled: true },
                select: { userId: true },
              }).then((hbTasks: any[]) => {
                const uids = [...new Set(hbTasks.map((t: any) => t.userId))];
                const alert = `🚨 心跳巡检告警\n时间: ${new Date().toLocaleString('zh-CN')}\n\n${content.slice(0, 2000)}`;
                for (const uid of uids) {
                  heartbeatImService.sendToUser(uid, alert).then(sent => {
                    if (sent > 0) console.log(`[heartbeat] Alert pushed to ${uid} via IM`);
                  }).catch((e2: any) => console.warn(`[heartbeat] IM push to ${uid} failed: ${e2.message}`));
                }
              }).catch(() => { /* DB 查询失败不阻塞 */ });
              return; // 异步处理，提前返回
            }
            const alertText = `🚨 心跳巡检告警\n时间: ${new Date().toLocaleString('zh-CN')}\n\n${content.slice(0, 2000)}`;
            for (const uid of userIds) {
              heartbeatImService.sendToUser(uid, alertText).then(sent => {
                if (sent > 0) console.log(`[heartbeat] Alert pushed to ${uid} via IM`);
              }).catch((e: any) => console.warn(`[heartbeat] IM push to ${uid} failed: ${e.message}`));
            }
          }
        });
      }
    } catch (err: any) {
      console.warn('   Native Gateway: connection failed -', err.message);
      console.warn('   Chat will not work until native gateway is available');
    }
  } else {
    console.warn('   Native Gateway: OCTOPUS_GATEWAY_TOKEN not set, bridge disabled');
  }

  // 初始化 MCP 模块（MCPRegistry 纯运行时缓存，DB 操作由路由层负责）
  // 注意：构造函数参数保持向后兼容，但 MCPRegistry 不再操作 DB
  const mcpRegistry = new MCPRegistry(prismaClient);
  const mcpExecutor = new MCPExecutor();

  // 确保 Agent 模板文件存在（首次运行时自动生成默认模板）
  ensureAgentTemplates(config.workspace.dataRoot);

  // 确保企业级 MCP 脚本目录存在
  const enterpriseMcpDir = path.join(config.workspace.dataRoot, 'mcp-servers');
  if (!fs.existsSync(enterpriseMcpDir)) {
    fs.mkdirSync(enterpriseMcpDir, { recursive: true });
    console.log(`   MCP: created enterprise directory ${enterpriseMcpDir}`);
  }

  // 3. 创建 Express 应用
  const app = express();

  // 信任本地反向代理（frp），确保 req.ip 返回真实客户端 IP
  app.set('trust proxy', ['loopback', 'uniquelocal']);

  // 中间件
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

  // 健康检查
  const startTime = Date.now();
  app.get('/health', async (_req, res) => {
    // Database 状态检测：尝试轻量查询
    let dbStatus: 'connected' | 'error' = 'error';
    if (prismaClient) {
      try {
        await prismaClient.$queryRaw`SELECT 1`;
        dbStatus = 'connected';
      } catch {
        dbStatus = 'error';
      }
    }

    // Redis 状态
    const redisStatus = redisClient ? 'connected' : 'not configured';

    // Native Gateway 状态
    const nativeGatewayStatus = bridge?.isConnected ? 'running' : 'stopped';

    // Plugin 状态：通过检查 native gateway 日志获取太重，用简单的内存标记
    // 当前通过 bridge 是否连接来推断 plugin 是否已加载（plugin 由 native gateway 加载）
    const pluginStatus = (_name: string) => {
      // 如果 native gateway 连接正常，plugin 应已加载
      // 后续可通过 RPC 查询精确状态
      return bridge?.isConnected ? 'loaded' as const : 'not loaded' as const;
    };

    // 整体状态：任一核心服务异常则 degraded
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

  // 登录/刷新接口频率限制
  const authLimiter = rateLimit({
    windowMs: getRuntimeConfig().security.rateLimitWindowMs,
    max: getRuntimeConfig().security.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后再试' },
  });
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/refresh', authLimiter);

  // API 路由
  // Fail-fast: DB 连接失败时直接退出，避免路由运行时 TypeError
  if (!prismaClient) {
    console.error('❌ 数据库连接失败，Gateway 无法启动');
    process.exit(1);
  }
  app.use('/api/auth', createAuthRouter(authService, workspaceManager, prismaClient, config.workspace.dataRoot));
  app.use('/api/chat', createChatRouter(config, authService, workspaceManager, bridge, prismaClient, auditLogger));
  app.use('/api/chat', createSessionsRouter(config, authService, workspaceManager, bridge, prismaClient, auditLogger));
  app.use('/api/audit', createAuditRouter(authService, auditLogger));
  app.use('/api/admin', createAdminRouter(authService, auditLogger, prismaClient!, workspaceManager, bridge));
  if (bridge) {
    app.use('/api/admin/config', createSystemConfigRouter(authService, bridge));
  }
  app.use('/api/files', createFilesRouter(config, authService, workspaceManager, prismaClient));
  if (prismaClient) {
    app.use('/api/mcp', createMcpRouter(authService, prismaClient, mcpRegistry, mcpExecutor, config.workspace.dataRoot));
  }
  app.use('/api/skills', createSkillsRouter(authService, prismaClient!, config.workspace.dataRoot, bridge));
  app.use('/api/agents', createAgentsRouter(authService, prismaClient!, workspaceManager, bridge, config.workspace.dataRoot));
  app.use('/api/scheduler', createSchedulerRouter(authService, prismaClient!, bridge, imService));
  app.use('/api/user/db-connections', createDbConnectionsRouter(authService, prismaClient));
  if (imService?.weixinManager) {
    app.use('/api/user/weixin', createWeixinRoutes({ authService, prisma: prismaClient, weixinManager: imService.weixinManager }));
  }
  if (imService) {
    app.use('/api/_internal/im', createImInternalRouter(imService));
  }
  if (bridge) {
    app.use('/api/_internal/chat', createChatInternalRouter(bridge, workspaceManager, config.workspace.dataRoot));
  }

  // 全局错误处理（5xx 不泄漏内部信息，4xx 保留业务消息）
  app.use(globalErrorHandler);

  // ── 启动时清理孤儿 Skill 目录 ──
  // 引擎通过 skills.load.extraDirs 自动发现 data/skills/ 下的目录并注册为工具，
  // 但如果 DB 中没有对应记录（手动放入或删除后残留），会导致不一致。
  // 这里扫描目录，删除没有 DB 记录的孤儿 skill。
  if (prismaClient) {
    const enterpriseSkillsDir = path.resolve(config.workspace.dataRoot, 'skills');
    try {
      const entries = fs.readdirSync(enterpriseSkillsDir, { withFileTypes: true });
      const skillDirs = entries.filter(e => e.isDirectory() && e.name.startsWith('skill-'));
      if (skillDirs.length > 0) {
        const dbSkills = await prismaClient.skill.findMany({
          where: { scope: 'enterprise' },
          select: { id: true },
        });
        const dbIds = new Set(dbSkills.map(s => s.id));
        let cleaned = 0;
        for (const dir of skillDirs) {
          if (!dbIds.has(dir.name)) {
            fs.rmSync(path.join(enterpriseSkillsDir, dir.name), { recursive: true, force: true });
            cleaned++;
            console.log(`[skills] Cleaned orphan skill directory: ${dir.name}`);
          }
        }
        if (cleaned > 0) {
          console.log(`[skills] Cleaned ${cleaned} orphan skill director${cleaned > 1 ? 'ies' : 'y'}`);
        }
      }
    } catch (e: any) {
      console.warn('[skills] Orphan cleanup failed:', e.message);
    }
  }

  // 4. 启动服务器
  const bindHost = process.env.BIND_HOST || '127.0.0.1';
  console.log(`[gateway] Attempting to listen on ${bindHost}:${config.port} (PID: ${process.pid})...`);
  const server = app.listen(config.port, bindHost, () => {
    console.log(`✅ Gateway started on http://${bindHost}:${config.port}`);
    console.log(`   Health: http://localhost:${config.port}/health`);
    console.log('   Model: configured in octopus.json (unified)');
    console.log(`   LDAP: ${config.mockLdap ? 'Mock (dev)' : config.ldap.url}`);
    console.log(`   Data: ${config.workspace.dataRoot}`);
    console.log(`   Audit: ${config.audit.logDir} (${config.audit.retentionDays}d retention)`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    server.close();
    bridge?.shutdown();
    await prismaClient?.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('❌ Gateway failed to start:', err);
  process.exit(1);
});
