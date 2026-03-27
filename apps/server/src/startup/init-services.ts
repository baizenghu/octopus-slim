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
import { syncAgentToEngine } from '../services/AgentConfigSync';
import { ensureAgentTemplates } from '../services/SoulTemplate';
import { buildHeartbeatRunPrompt, parseEveryToMs } from '../routes/scheduler';
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

      // ── 注册 PrismaAgentStore（agent 配置存 DB，不再双写 octopus.json）──
      if (prismaClient) {
        const { PrismaAgentStore } = await import('../services/PrismaAgentStore');
        const { registerAgentStore } = await import('@octopus/engine/plugin-sdk');
        const prismaStore = new PrismaAgentStore(prismaClient);
        registerAgentStore('prisma', prismaStore);
        logger.info('AgentStore: PrismaAgentStore registered (DB-backed)');
      }

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
          // 按 ownerId 分组，计算每个用户的 enabledAgentNames
          const enabledByOwner = new Map<string, string[]>();
          for (const agent of agents) {
            const list = enabledByOwner.get(agent.ownerId) ?? [];
            list.push(agent.name);
            enabledByOwner.set(agent.ownerId, list);
          }

          // 并发创建 native agents
          await Promise.allSettled(
            agents.map(async (agent) => {
              const nativeId = TenantEngineAdapter.forUser(bridge!, agent.ownerId).agentId(agent.name);
              const workspacePath = workspaceManager.getAgentWorkspacePath(agent.ownerId, agent.name);
              try {
                await bridge!.call('agents.create', { name: nativeId, workspace: workspacePath });
              } catch { /* 已存在则忽略 */ }
            })
          );

          // 串行同步配置（使用 configTransaction 保证原子性）
          let syncOk = 0;
          for (const agent of agents) {
            try {
              await syncAgentToEngine(bridge!, agent.ownerId, {
                agentName: agent.name,
                model: agent.model as string | null,
                toolsFilter: agent.toolsFilter as string[] | null,
                skillsFilter: agent.skillsFilter as string[] ?? [],
                mcpFilter: agent.mcpFilter as string[] | null,
                enabledAgentNames: enabledByOwner.get(agent.ownerId) ?? [],
              });
              syncOk++;
            } catch (configErr: unknown) {
              logger.warn('Agent config sync warning', { agent: agent.name, error: (configErr as Error).message });
            }
          }
          if (agents.length > 0) {
            logger.info(`Native Gateway: synced ${syncOk}/${agents.length} agents`);
          }

          // 清理 octopus.json 中的孤儿 agent（DB 已删除但 config 残留）
          try {
            const validIds = new Set(agents.map(a => TenantEngineAdapter.forUser(bridge!, a.ownerId).agentId(a.name)));
            const engineCfg = await bridge!.call('config.get', {});
            const engineAgents: { name?: string; id?: string }[] = (engineCfg as any)?.agents?.list ?? [];
            const orphans = engineAgents.filter(a => {
              const id = a.name || a.id || '';
              return id.startsWith('ent_') && !validIds.has(id);
            });
            if (orphans.length > 0) {
              for (const orphan of orphans) {
                const orphanId = orphan.name || orphan.id || '';
                const nameMatch = orphanId.match(/^ent_(user-[^_]+)_(.+)$/);
                if (nameMatch) {
                  await syncAgentToEngine(bridge!, nameMatch[1], {
                    deleteAgentName: nameMatch[2],
                    enabledAgentNames: agents.filter(a => a.ownerId === nameMatch[1]).map(a => a.name),
                  }).catch(() => {});
                }
              }
              logger.info(`Orphan cleanup: removed ${orphans.length} stale agent(s) from octopus.json`);
            }
          } catch (cleanupErr: any) {
            logger.warn('Orphan agent cleanup warning', { error: cleanupErr.message });
          }

          // 恢复心跳 cron job（重启后引擎 cron 是空的，需要从 DB 重新注册）
          try {
            const heartbeatTasks = await prismaClient.scheduledTask.findMany({
              where: { taskType: 'heartbeat', enabled: true },
            });
            let restored = 0;
            for (const task of heartbeatTasks) {
              try {
                const cfg = task.taskConfig as { agentId?: string; every?: string; content?: string; cronJobId?: string };
                if (!cfg.agentId || !cfg.every || !cfg.content) continue;

                // 查 agent 获取 nativeAgentId
                const agent = agents.find(a => a.id === cfg.agentId);
                if (!agent) continue;
                const nativeAgentId = TenantEngineAdapter.forUser(bridge!, agent.ownerId).agentId(agent.name);

                const prompt = buildHeartbeatRunPrompt(cfg.content);
                const cronJob = await bridge!.call<{ id?: string }>('cron.add', { job: {
                  name: `heartbeat:${task.name}`,
                  agentId: nativeAgentId,
                  schedule: { kind: 'every' as const, everyMs: parseEveryToMs(cfg.every) },
                  sessionTarget: 'isolated',
                  payload: { kind: 'agentTurn', message: prompt },
                } });

                // 更新 DB 中的 cronJobId
                if (cronJob?.id && cronJob.id !== cfg.cronJobId) {
                  await prismaClient.scheduledTask.update({
                    where: { id: task.id },
                    data: { taskConfig: { ...cfg, cronJobId: cronJob.id } },
                  });
                }
                restored++;
              } catch (hbErr: unknown) {
                logger.warn(`Heartbeat restore failed: ${task.name}`, { error: (hbErr as Error).message });
              }
            }
            if (restored > 0) {
              logger.info(`Heartbeat: restored ${restored}/${heartbeatTasks.length} cron job(s)`);
            }
          } catch (hbSyncErr: any) {
            logger.warn('Heartbeat restore warning', { error: hbSyncErr.message });
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
