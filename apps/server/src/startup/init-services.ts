/**
 * init-services.ts — 服务初始化
 * Redis、AuthService、WorkspaceManager、Prisma、AuditLogger、FileCleanup、EngineAdapter、MCP
 */

import * as fs from 'fs';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { AuthService } from '@octopus/auth';
import { WorkspaceManager } from '@octopus/workspace';
import { AuditLogger } from '@octopus/audit';
import { MCPRegistry, MCPExecutor } from '@octopus/mcp';
import { EngineAdapter } from '../services/EngineAdapter';
import { TenantEngineAdapter } from '../services/TenantEngineAdapter';
import { ensureAgentTemplates } from '../services/SoulTemplate';
import { initRuntimeConfig } from '../config';
import type { AppPrismaClient } from '../types/prisma';
import type { loadConfig } from '../config';
import { createLogger } from '../utils/logger';

const logger = createLogger('startup');

type AppConfig = ReturnType<typeof loadConfig>;

export interface Services {
  redisClient?: Redis;
  authService: AuthService;
  workspaceManager: WorkspaceManager;
  prismaClient?: AppPrismaClient;
  auditLogger: AuditLogger;
  bridge?: EngineAdapter;
  mcpRegistry: MCPRegistry;
  mcpExecutor: MCPExecutor;
}

export async function initServices(config: AppConfig): Promise<Services> {
  // ── Redis ──
  let redisClient: Redis | undefined;
  if (process.env.REDIS_URL) {
    try {
      redisClient = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 2000)),
      });
      await redisClient.connect();
      logger.info('Redis: connected (auth)');
    } catch (err: any) {
      logger.warn('Redis: unavailable for auth, using in-memory fallback');
      redisClient = undefined;
    }
  }

  // ── Auth + Workspace ──
  const authService = new AuthService({
    ldap: config.ldap,
    jwt: config.jwt,
    mockLdap: config.mockLdap,
  }, redisClient);

  const workspaceManager = new WorkspaceManager({
    dataRoot: config.workspace.dataRoot,
    defaultStorageQuota: config.workspace.defaultStorageQuota,
  });

  // ── Prisma ──
  let prismaClient: AppPrismaClient | undefined = undefined;
  try {
    const { getPrismaClient } = await import('@octopus/database');
    prismaClient = getPrismaClient();
    logger.info('Database: connected');

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
          logger.info(`Password migration: upgraded ${migrated} plaintext passwords to bcrypt`);
        }
      } catch (migrateErr: any) {
        logger.warn('Password migration warning', { error: migrateErr.message });
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
          logger.info(`MockLDAP: synced ${synced}/${dbUsers.length} users from database${failed.length > 0 ? ` (${failed.length} failed: ${failed.join(', ')})` : ''}`);
        }
      } catch (syncErr: any) {
        logger.warn('MockLDAP sync warning', { error: syncErr.message });
      }
    }
  } catch (err) {
    logger.warn('Database: unavailable (admin features will be limited)');
  }

  // ── AuditLogger ──
  const auditLogger = new AuditLogger({
    logDir: config.audit.logDir,
    retentionDays: config.audit.retentionDays,
    enableDatabase: config.audit.enableDatabase && !!prismaClient,
    prisma: prismaClient,
  });

  auditLogger.cleanup().then((n: number) => {
    if (n > 0) logger.info(`Cleaned up ${n} expired export files`);
  }).catch(err => logger.warn('审计日志过期文件清理失败', { error: (err as Error)?.message || String(err) }));

  // ── FileCleanupService ──
  if (prismaClient) {
    const { FileCleanupService } = await import('../services/FileCleanupService');
    const fileCleanup = new FileCleanupService({
      dataRoot: config.workspace.dataRoot,
      cleanup: config.cleanup,
      prisma: prismaClient,
    });
    fileCleanup.start();
  }

  // ── EngineAdapter ──
  let bridge: EngineAdapter | undefined;
  if (config.nativeGateway.token) {
    bridge = new EngineAdapter();
    try {
      await bridge.initialize(19791);
      logger.info('Engine: initialized (single-process)');

      // 从独立的 enterprise.json 读取运行时配置（不放 octopus.json 避免引擎校验失败）
      try {
        const stateDir = process.env.OCTOPUS_STATE_DIR!;
        const raw = await fsPromises.readFile(path.join(stateDir, 'enterprise.json'), 'utf-8');
        initRuntimeConfig(JSON.parse(raw));
        logger.info('Loaded from enterprise.json');
      } catch (err) {
        logger.warn('enterprise.json not found, using defaults');
        initRuntimeConfig();
      }

      // 启动时将数据库中所有已启用的 Agent 并发同步到原生 Gateway
      if (prismaClient) {
        try {
          const agents = await prismaClient.agent.findMany({ where: { enabled: true } });
          const createResults = await Promise.allSettled(
            agents.map(async (agent) => {
              const nativeId = TenantEngineAdapter.forUser(bridge!, agent.ownerId).agentId(agent.name);
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
              logger.error('Agent create failed', { reason: r.reason });
            }
          }
          if (agents.length > 0) {
            const successCount = agents.length - failCount;
            logger.info(`Native Gateway: synced ${successCount}/${agents.length} agents (concurrent)`);
          }
        } catch (syncErr: any) {
          logger.warn('Native Gateway agent sync warning', { error: syncErr.message });
        }
      }
    } catch (err: any) {
      logger.warn('Native Gateway: connection failed', { error: err.message });
      logger.warn('Chat will not work until native gateway is available');
    }
  } else {
    logger.warn('Native Gateway: OCTOPUS_GATEWAY_TOKEN not set, bridge disabled');
  }

  // ── MCP + Agent 模板 ──
  const mcpRegistry = new MCPRegistry(prismaClient);
  const mcpExecutor = new MCPExecutor();

  ensureAgentTemplates(config.workspace.dataRoot);

  const enterpriseMcpDir = path.join(config.workspace.dataRoot, 'mcp-servers');
  if (!fs.existsSync(enterpriseMcpDir)) {
    fs.mkdirSync(enterpriseMcpDir, { recursive: true });
    logger.info(`MCP: created enterprise directory ${enterpriseMcpDir}`);
  }

  return {
    redisClient,
    authService,
    workspaceManager,
    prismaClient,
    auditLogger,
    bridge,
    mcpRegistry,
    mcpExecutor,
  };
}
