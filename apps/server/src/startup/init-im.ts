/**
 * init-im.ts — IM 服务启动
 * 飞书、微信等 IM 适配器初始化
 */

import * as path from 'path';
import { AuthService } from '@octopus/auth';
import { WorkspaceManager } from '@octopus/workspace';
import { AuditLogger } from '@octopus/audit';
import { EngineAdapter } from '../services/EngineAdapter';
import { TenantEngineAdapter } from '../services/TenantEngineAdapter';
import { IMService } from '../services/im';
import { getRuntimeConfig } from '../config';
import type { AppPrismaClient } from '../types/prisma';
import type { loadConfig } from '../config';

type AppConfig = ReturnType<typeof loadConfig>;

export async function initIM(params: {
  bridge: EngineAdapter;
  prismaClient: AppPrismaClient;
  authService: AuthService;
  workspaceManager: WorkspaceManager;
  auditLogger: AuditLogger;
  config: AppConfig;
}): Promise<IMService> {
  const { bridge, prismaClient, authService, workspaceManager, auditLogger, config } = params;

  const imService = new IMService({
    prisma: prismaClient,
    bridge,
    authService,
    dataRoot: config.workspace.dataRoot,
    workspaceManager,
    auditLogger,
    ensureAgent: async (userId: string, agentName: string) => {
      const nativeAgentId = TenantEngineAdapter.forUser(bridge, userId).agentId(agentName);
      const workspacePath = agentName === 'default'
        ? path.join(config.workspace.dataRoot, 'users', userId, 'workspace')
        : path.join(config.workspace.dataRoot, 'users', userId, 'agents', agentName, 'workspace');
      try {
        await bridge.call('agents.create', { name: nativeAgentId, workspace: workspacePath });
        // 原生 gateway 异步初始化 workspace，等待就绪
        await new Promise(r => setTimeout(r, getRuntimeConfig().engine.agentInitTimeoutMs));
      } catch { /* 已存在则忽略 */ }
    },
  });

  await imService.start();
  return imService;
}
