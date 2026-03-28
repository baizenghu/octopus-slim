/**
 * Agent 管理路由（个人级多 Agent）
 *
 * GET    /api/agents              - 列出当前用户的 agents
 * POST   /api/agents              - 创建 agent
 * PUT    /api/agents/:id          - 更新 agent
 * DELETE /api/agents/:id          - 删除 agent
 * GET    /api/agents/:id/config   - 获取 agent 所有配置文件列表及内容
 * PUT    /api/agents/:id/config   - 更新 agent 指定配置文件
 * POST   /api/agents/:id/default  - 设为默认 agent
 */

import { Router } from 'express';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { EngineAdapter } from '../services/EngineAdapter';
import { TenantEngineAdapter } from '../services/TenantEngineAdapter';
import { syncAgentToEngine, ensureAndSyncNativeAgent, computeToolsUpdate } from '../services/AgentConfigSync';
import { invalidatePromptCache } from '../services/SystemPromptBuilder';
import { createAvatarUpload, mimeToExt } from '../utils/avatar';
import { createLogger } from '../utils/logger';
import { readToolsCacheAsync } from '../utils/tools-cache';
import { skillMdName } from '../utils/skill-naming';

import type { AppPrismaClient } from '../types/prisma';
import type { EngineAgentFileResponse } from '../types/engine';

const logger = createLogger('agents');

/** 过滤 skillsFilter：只保留 DB 中 enabled=true 的 skill，返回引擎可识别的 skillMdName */
async function filterEnabledSkills(prisma: AppPrismaClient, skillsFilter: string[]): Promise<string[]> {
  if (!skillsFilter.length) return [];
  const skills = await prisma.toolSource.findMany({
    where: { type: 'skill', enabled: true, name: { in: skillsFilter } },
    select: { name: true, scope: true, ownerId: true },
  });
  return skills.map((s: { name: string; scope: string; ownerId: string | null }) =>
    skillMdName(s.scope, s.name, s.ownerId),
  );
}
import { rm } from 'fs/promises';

/** Agent workspace 中允许读写的配置文件白名单 */
const AGENT_CONFIG_FILES = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'TOOLS.md', 'USER.md'];

export function createAgentsRouter(
  authService: AuthService,
  prisma: AppPrismaClient,
  workspaceManager?: WorkspaceManager,
  bridge?: EngineAdapter,
  dataRoot?: string,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma, bridge);

  /**
   * 同步 agent 到原生 gateway，并自动配置 memory scope 隔离 + 独立工作空间
   * @param isUpdate 是否为更新操作（更新时不覆盖 MEMORY.md，保留已有记忆 #19 修复）
   */
  async function syncToNative(userId: string, agentName: string, systemPrompt?: string | null, identity?: { name?: string; emoji?: string; vibe?: string } | null, isUpdate = false, description?: string | null) {
    if (!bridge?.isConnected || !workspaceManager) return;
    await ensureAndSyncNativeAgent(bridge, workspaceManager, userId, agentName, {
      useCache: false,
      initWorkspace: true,
      identity,
      systemPrompt,
      description,
      isUpdate,
      dataRoot: dataRoot || '',
    });
  }

  /** 原生工具描述映射（用于 TOOLS.md 生成，面向 LLM 提示） */
  const NATIVE_TOOL_DESCRIPTIONS: Record<string, string> = {
    read: '读取文件内容、列出目录',
    write: '写入或创建文件',
    exec: '在沙箱中执行 Shell 命令（bash）',
  };

  /**
   * 根据 agent 的 toolsFilter + mcpFilter 生成 TOOLS.md 并写入 agent workspace
   * 权限变化时调用，保持 TOOLS.md 与配置实时同步
   */
  async function syncToolsMd(userId: string, agentName: string, mcpFilter: string[], toolsFilter?: string[]) {
    if (!bridge?.isConnected) return;
    const nativeAgentId = TenantEngineAdapter.forUser(bridge!, userId).agentId(agentName);

    try {
      const lines = ['# 可用工具', '', '以下是你当前被授权使用的所有工具，请在需要时主动使用：', ''];

      // 1. 原生工具（toolsFilter）
      if (Array.isArray(toolsFilter) && toolsFilter.length > 0) {
        lines.push('## 原生工具');
        lines.push('');
        for (const tool of toolsFilter) {
          const desc = NATIVE_TOOL_DESCRIPTIONS[tool] || '';
          lines.push(`- **${tool}**${desc ? ` — ${desc}` : ''}`);
        }
        lines.push('');
      }

      // 2. 从 tools-cache.json 读取企业级 MCP 工具
      const cachedTools = await readToolsCacheAsync();

      // 3. 从 DB 获取该用户的 personal MCP 工具名
      const personalServers = await prisma.toolSource.findMany({
        where: { type: 'mcp', scope: 'personal', ownerId: userId, enabled: true },
        select: { id: true, name: true, description: true },
      });

      // 4. 按 mcpFilter 过滤，构建 MCP 工具列表
      const filterSet = new Set(mcpFilter);

      // 企业级工具
      const serverToolMap = new Map<string, { serverName: string; tools: Array<{ name: string; desc: string }> }>();
      for (const tool of cachedTools) {
        if (!filterSet.has(tool.serverId) && !filterSet.has(tool.serverName)) continue;
        if (!serverToolMap.has(tool.serverId)) {
          serverToolMap.set(tool.serverId, { serverName: tool.serverName, tools: [] });
        }
        serverToolMap.get(tool.serverId)!.tools.push({ name: tool.toolName, desc: tool.description || '' });
      }
      let mcpToolCount = 0;
      for (const [, entry] of serverToolMap) {
        lines.push(`## ${entry.serverName}`);
        lines.push('');
        for (const tool of entry.tools) {
          lines.push(`- **${tool.name}**${tool.desc ? ` — ${tool.desc}` : ''}`);
          mcpToolCount++;
        }
        lines.push('');
      }

      // 个人级工具（仅在 cache 中未找到时才作为兜底显示）
      for (const ps of personalServers) {
        if (!filterSet.has(ps.id) && !filterSet.has(ps.name)) continue;
        // 如果 tools-cache 已有该 server 的详细工具，跳过兜底
        if (serverToolMap.has(ps.id)) continue;
        lines.push(`## ${ps.name}`);
        if (ps.description) lines.push(`> ${ps.description}`);
        lines.push('');
        lines.push(`- **（${ps.name} 提供的工具）** — 个人 MCP 工具，详见工具调用列表`);
        lines.push('');
        mcpToolCount++;
      }

      const nativeCount = toolsFilter?.length || 0;
      if (nativeCount === 0 && mcpToolCount === 0) {
        await bridge.call('agents.files.set', { agentId: nativeAgentId, name: 'TOOLS.md', content: '# 可用工具\n\n当前未配置任何工具。\n' });
        logger.info(`[agents] TOOLS.md cleared for ${nativeAgentId} (no tools)`);
        return;
      }

      await bridge.call('agents.files.set', { agentId: nativeAgentId, name: 'TOOLS.md', content: lines.join('\n') });
      logger.info(`[agents] TOOLS.md synced for ${nativeAgentId} (native: ${nativeCount}, mcp: ${mcpToolCount})`);
    } catch (e: unknown) {
      logger.error(`[agents] syncToolsMd failed for ${agentName}:`, { error: e instanceof Error ? e.message : String(e) });
    }
  }

  /**
   * 确保用户有一个 default agent（主 agent）记录
   * 首次查询时自动创建，保证主 agent 始终出现在列表中
   */
  const defaultCheckedUsers = new Set<string>();
  async function ensureDefaultAgent(userId: string) {
    if (defaultCheckedUsers.has(userId)) return;
    // 防止内存无限增长（超限时清空重来，最多导致多查一次 DB）
    if (defaultCheckedUsers.size > 5000) defaultCheckedUsers.clear();
    defaultCheckedUsers.add(userId);
    const existing = await prisma.agent.findFirst({
      where: { ownerId: userId, name: 'default' },
    });
    if (existing) return;

    // 默认 agent 权限全部开启：查询所有已启用的 MCP/Skills/Connections
    const [mcpServers, skills, connections] = await Promise.all([
      prisma.toolSource.findMany({ where: { type: 'mcp', enabled: true }, select: { id: true } }),
      prisma.toolSource.findMany({ where: { type: 'skill', enabled: true }, select: { name: true } }),
      prisma.databaseConnection.findMany({ where: { userId, enabled: true }, select: { name: true } }),
    ]);

    const defaultMcpFilter = mcpServers.map((s: { id: string }) => s.id);
    const defaultToolsFilter = ['read', 'write', 'exec'];
    const defaultSkillsFilter = skills.map((s: { name: string }) => s.name);
    // 计算 tools deny/profile 写入 DB（引擎通过 AgentStore 从 DB 读取）
    const defaultTools = computeToolsUpdate('default', defaultToolsFilter, defaultMcpFilter, defaultSkillsFilter, []);
    await prisma.agent.create({
      data: {
        id: TenantEngineAdapter.forUser(bridge!, userId).agentId('default'),
        name: 'default',
        description: '主助手，处理各种通用任务',
        ownerId: userId,
        enabled: true,
        isDefault: true,
        identity: { name: 'Octopus AI', emoji: '🐙' },
        toolsFilter: defaultToolsFilter,
        skillsFilter: defaultSkillsFilter,
        mcpFilter: defaultMcpFilter,
        allowedConnections: connections.map((c: { name: string }) => c.name),
        toolsProfile: defaultTools.profile,
        toolsDeny: defaultTools.deny ?? [],
        toolsAllow: defaultTools.alsoAllow,
      },
    });

    // 首次创建 default agent 时同步 TOOLS.md（包含原生工具 + MCP 工具）
    syncToolsMd(userId, 'default', defaultMcpFilter, defaultToolsFilter).catch((e: unknown) =>
      logger.error('[agents] syncToolsMd for new default agent failed:', { error: e instanceof Error ? e.message : String(e) }),
    );
  }

  /**
   * 列出当前用户的 agents
   */
  router.get('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      // 确保 default agent（主 agent）始终存在
      await ensureDefaultAgent(user.id);
      const agents = await prisma.agent.findMany({
        where: { ownerId: user.id },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      res.json({ agents });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 创建 agent
   */
  router.post('/', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { name, description, model, identity, skillsFilter, mcpFilter, toolsFilter, allowedConnections } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const trimmedName = name.trim();
      if (trimmedName.length > 50) {
        res.status(400).json({ error: 'Agent 名称不能超过 50 个字符' });
        return;
      }
      if (!/^[\w\u4e00-\u9fa5-]+$/.test(trimmedName)) {
        res.status(400).json({ error: 'Agent 名称只能包含字母、数字、中文、下划线和连字符' });
        return;
      }
      if (['default', 'system', 'admin'].includes(trimmedName.toLowerCase())) {
        res.status(400).json({ error: '不能使用保留名称' });
        return;
      }

      // 计算 tools deny/profile/alsoAllow 写入 DB（引擎通过 AgentStore 从 DB 读取）
      const computedTools = computeToolsUpdate(name.trim(), toolsFilter ?? [], mcpFilter ?? [], skillsFilter ?? [], []);

      // 使用引擎格式的 agentId（ent_{userId}_{agentName}），
      // 确保 DB 中的 id 与引擎运行时查询的 id 一致
      const nativeAgentId = TenantEngineAdapter.forUser(bridge!, user.id).agentId(name.trim());
      const agent = await prisma.agent.create({
        data: {
          id: nativeAgentId,
          name: name.trim(),
          description: description?.trim() || null,
          ownerId: user.id,
          model: model?.trim() || null,
          systemPrompt: null,
          identity: identity || null,
          skillsFilter: skillsFilter ?? [],
          mcpFilter: mcpFilter ?? [],
          toolsFilter: toolsFilter ?? [],
          allowedConnections: allowedConnections ?? [],
          toolsProfile: computedTools.profile,
          toolsDeny: computedTools.deny ?? [],
          toolsAllow: computedTools.alsoAllow,
          enabled: true,
          isDefault: false,
        },
      });

      // 同步到原生 Gateway（await 确保同步完成后再响应，#20 修复）
      try {
        await syncToNative(user.id, agent.name, null, agent.identity as { name?: string; emoji?: string; vibe?: string } | null, false, agent.description);
        // 统一同步 allowAgents + model + tools 到 native agents.list（单次 config read/write）
        const enabledAgents = await prisma.agent.findMany({ where: { ownerId: user.id, enabled: true }, select: { name: true } });
        await syncAgentToEngine(bridge!, user.id, {
          agentName: agent.name,
          model: model?.trim() || null,
          toolsFilter: toolsFilter ?? [],
          skillsFilter: await filterEnabledSkills(prisma, skillsFilter ?? []),
          mcpFilter: mcpFilter ?? [],
          enabledAgentNames: enabledAgents.map(a => a.name),
        });
        // 创建时同步 TOOLS.md（原生工具 + MCP 工具）
        await syncToolsMd(user.id, agent.name, mcpFilter || [], toolsFilter || []);
      } catch (e: unknown) {
        logger.error('[agents] Native sync failed:', { error: e instanceof Error ? e.message : String(e) });
        // 同步失败不阻塞响应（DB 已写入）
      }

      res.json({ agent });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 更新 agent
   */
  router.put('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      // 验证归属
      const existing = await prisma.agent.findFirst({
        where: { id, ownerId: user.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      const { name, description, model, identity, skillsFilter, mcpFilter, toolsFilter, allowedConnections, enabled } = req.body;

      const data: Record<string, any> = {};
      // Agent ID（name）创建后不可修改，修改会导致 native agent ID 变更、历史 session 丢失
      if (name !== undefined && name.trim() !== existing.name) {
        res.status(400).json({ error: 'Agent ID 创建后不可修改' });
        return;
      }
      if (description !== undefined) data.description = description?.trim() || null;
      if (model !== undefined) data.model = model?.trim() || null;
      if (identity !== undefined) data.identity = identity;
      if (skillsFilter !== undefined) data.skillsFilter = skillsFilter;
      if (mcpFilter !== undefined) data.mcpFilter = mcpFilter;
      if (toolsFilter !== undefined) data.toolsFilter = toolsFilter;
      if (allowedConnections !== undefined) data.allowedConnections = allowedConnections;
      if (enabled !== undefined) data.enabled = Boolean(enabled);

      // 重新计算 tools deny/profile（引擎通过 AgentStore 从 DB 读取）
      if (toolsFilter !== undefined || mcpFilter !== undefined || skillsFilter !== undefined) {
        const finalToolsFilter = toolsFilter ?? existing.toolsFilter as string[] ?? [];
        const finalMcpFilter = mcpFilter ?? existing.mcpFilter as string[] ?? [];
        const finalSkillsFilter = skillsFilter ?? existing.skillsFilter as string[] ?? [];
        const computed = computeToolsUpdate(existing.name, finalToolsFilter, finalMcpFilter, finalSkillsFilter, []);
        data.toolsProfile = computed.profile;
        data.toolsDeny = computed.deny ?? [];
        data.toolsAllow = computed.alsoAllow;
      }

      const agent = await prisma.agent.update({
        where: { id },
        data,
      });

      // 仅在影响原生 gateway 的字段实际变化时同步，避免不必要的 config.apply 导致 native gateway 重启
      const identityChanged = identity !== undefined &&
        JSON.stringify(identity) !== JSON.stringify(existing.identity);
      const descriptionChanged = description !== undefined &&
        (description?.trim() || null) !== (existing.description || null);
      const enabledChanged = enabled !== undefined && enabled !== existing.enabled;
      if (identityChanged || descriptionChanged || enabledChanged) {
        try {
          await syncToNative(user.id, agent.name, null, agent.identity as { name?: string; emoji?: string; vibe?: string } | null, true, agent.description);
        } catch (e: unknown) {
          logger.error('[agents] Native sync failed:', { error: e instanceof Error ? e.message : String(e) });
        }
      }

      // model / toolsFilter / skillsFilter / enabled 变化时统一同步到 native agents.list
      const modelChanged = model !== undefined &&
        (model?.trim() || null) !== (existing.model || null);
      const toolsFilterChanged = toolsFilter !== undefined &&
        JSON.stringify(toolsFilter) !== JSON.stringify(existing.toolsFilter);
      const skillsFilterChanged = skillsFilter !== undefined &&
        JSON.stringify(skillsFilter) !== JSON.stringify(existing.skillsFilter);
      const mcpFilterChanged = mcpFilter !== undefined &&
        JSON.stringify(mcpFilter) !== JSON.stringify(existing.mcpFilter);
      if (modelChanged || toolsFilterChanged || skillsFilterChanged || mcpFilterChanged || enabledChanged) {
        const syncOpts: Parameters<typeof syncAgentToEngine>[2] = {};
        if (modelChanged || toolsFilterChanged || skillsFilterChanged || mcpFilterChanged) {
          syncOpts.agentName = agent.name;
          if (modelChanged) syncOpts.model = model?.trim() || null;
          if (toolsFilterChanged) syncOpts.toolsFilter = toolsFilter ?? [];
          if (skillsFilterChanged) syncOpts.skillsFilter = await filterEnabledSkills(prisma, skillsFilter ?? []);
          if (mcpFilterChanged) syncOpts.mcpFilter = mcpFilter ?? [];
        }
        if (enabledChanged) {
          const enabledAgents = await prisma.agent.findMany({ where: { ownerId: user.id, enabled: true }, select: { name: true } });
          syncOpts.enabledAgentNames = enabledAgents.map(a => a.name);
        }
        syncAgentToEngine(bridge!, user.id, syncOpts).catch((e: unknown) =>
          logger.error('[agents] syncAgentToEngine failed:', { error: e instanceof Error ? e.message : String(e) }),
        );
      }

      // mcpFilter 或 toolsFilter 变化时同步 TOOLS.md（增删工具实时写入）
      if (mcpFilterChanged || toolsFilterChanged) {
        const finalMcpFilter = mcpFilter ?? (existing.mcpFilter as string[]) ?? [];
        const finalToolsFilter = toolsFilter ?? (existing.toolsFilter as string[]) ?? [];
        syncToolsMd(user.id, agent.name, finalMcpFilter, finalToolsFilter).catch((e: unknown) =>
          logger.error('[agents] syncToolsMd failed:', { error: e instanceof Error ? e.message : String(e) }),
        );
      }

      // Agent 配置变更后清除 prompt 缓存，下次对话重新构建
      invalidatePromptCache(user.id);

      res.json({ agent });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 删除 agent
   */
  router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const existing = await prisma.agent.findFirst({
        where: { id, ownerId: user.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // 主 agent（default）不可删除
      if (existing.name === 'default') {
        res.status(400).json({ error: '主助手不可删除' });
        return;
      }

      await prisma.agent.delete({ where: { id } });

      // 从原生 Gateway 删除（deleteFiles: true 清理 sessions 等 state 数据），清理 memory scope 配置 + 工作空间
      if (bridge?.isConnected) {
        const nativeAgentId = req.tenantBridge!.agentId(existing.name);
        await bridge.call('agents.delete', { agentId: nativeAgentId, deleteFiles: true }).catch(() => { });
        // 清理残留的 state 目录（原生 gateway deleteFiles 清内容但可能留空目录/sessions）
        // process.cwd() 是 apps/gateway/，需要向上两级到项目根目录
        const projectRoot = path.resolve(process.cwd(), '..', '..');
        const stateDir = path.resolve(process.env.OCTOPUS_STATE_DIR || path.join(projectRoot, '.octopus-state'), 'agents', nativeAgentId);
        // 延迟 2 秒，等原生 gateway 异步清理完再删目录
        setTimeout(async () => {
          try {
            await rm(stateDir, { recursive: true, force: true });
            logger.info(`[agents] Cleaned state dir: ${stateDir}`);
          } catch (e: unknown) {
            logger.error(`[agents] Failed to clean state dir ${stateDir}:`, { error: e instanceof Error ? e.message : String(e) });
          }
        }, 2000);
        // memory scope 无需清理：memory-lancedb-pro 默认行为不依赖 agentAccess 配置
      }
      // 清理专业 agent 的独立工作空间
      if (workspaceManager && existing.name !== 'default') {
        workspaceManager.deleteAgentWorkspace(user.id, existing.name).catch((e: unknown) =>
          logger.error('[agents] Workspace cleanup failed:', { error: e instanceof Error ? e.message : String(e) }),
        );
      }
      // 清理 octopus.json 中 agents.list 的残留 entry + 更新 allowAgents（单次 config read/write）
      if (bridge?.isConnected) {
        try {
          const enabledAgents = await prisma.agent.findMany({ where: { ownerId: user.id, enabled: true }, select: { name: true } });
          await syncAgentToEngine(bridge!, user.id, {
            deleteAgentName: existing.name,
            enabledAgentNames: enabledAgents.map(a => a.name),
          });
          logger.info(`[agents] Synced agent deletion to engine: ${existing.name}`);
        } catch (e: unknown) {
          logger.error('[agents] syncAgentToEngine after delete failed:', { error: e instanceof Error ? e.message : String(e) });
        }
      } else {
        logger.warn(`[agents] Engine not connected, agent '${existing.name}' may remain in octopus.json until next restart`);
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 获取 agent 所有配置文件列表及内容
   */
  router.get('/:id/config', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      // 验证 agent 归属
      const existing = await prisma.agent.findFirst({
        where: { id, ownerId: user.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      if (!bridge?.isConnected) {
        res.status(500).json({ error: 'Native gateway not connected' });
        return;
      }

      const nativeAgentId = req.tenantBridge!.agentId(existing.name);

      // 支持 ?file=SOUL.md 按需加载单个文件
      const requestedFile = req.query.file as string | undefined;
      const filesToLoad = requestedFile
        ? AGENT_CONFIG_FILES.filter(f => f === requestedFile)
        : AGENT_CONFIG_FILES;

      // 并行读取配置文件，单个文件失败时 content 返回空字符串
      const files = await Promise.all(
        filesToLoad.map(async (fileName) => {
          try {
            const result = await bridge.call('agents.files.get', { agentId: nativeAgentId, name: fileName }) as EngineAgentFileResponse;
            // RPC 返回 { agentId, workspace, file: { name, path, content, ... } }
            let text = '';
            if (typeof result === 'string') {
              text = result;
            } else if (result?.file) {
              text = typeof result.file === 'string' ? result.file : (result.file?.content ?? '');
            } else {
              text = result?.content ?? '';
            }
            return { name: fileName, content: text || '' };
          } catch (e: unknown) {
            logger.warn(`[agents] agentFilesGet ${fileName} failed:`, { error: e instanceof Error ? e.message : String(e) });
            return { name: fileName, content: '' };
          }
        }),
      );

      res.json({ files });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 更新 agent 指定配置文件
   */
  router.put('/:id/config', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;
      const { fileName, content } = req.body;

      // 白名单校验
      if (!fileName || !AGENT_CONFIG_FILES.includes(fileName)) {
        res.status(400).json({ error: `fileName must be one of: ${AGENT_CONFIG_FILES.join(', ')}` });
        return;
      }
      if (content === undefined || content === null || typeof content !== 'string') {
        res.status(400).json({ error: 'content is required and must be a string' });
        return;
      }

      // 验证 agent 归属
      const existing = await prisma.agent.findFirst({
        where: { id, ownerId: user.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      if (!bridge?.isConnected) {
        res.status(500).json({ error: 'Native gateway not connected' });
        return;
      }

      const nativeAgentId = req.tenantBridge!.agentId(existing.name);
      await bridge.call('agents.files.set', { agentId: nativeAgentId, name: fileName, content });

      // SOUL.md 同步更新 DB 中的 systemPrompt 字段（保持一致性）
      if (fileName === 'SOUL.md') {
        await prisma.agent.update({
          where: { id },
          data: { systemPrompt: content.trim() },
        });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 设为默认 agent
   */
  router.post('/:id/default', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const existing = await prisma.agent.findFirst({
        where: { id, ownerId: user.id },
      });
      if (!existing) {
        res.status(404).json({ error: 'Agent not found' });
        return;
      }

      // 事务保证原子性：取消旧默认 + 设置新默认
      const agent = await prisma.$transaction(async (tx: any) => {
        await tx.agent.updateMany({
          where: { ownerId: user.id, isDefault: true },
          data: { isDefault: false },
        });
        return tx.agent.update({
          where: { id },
          data: { isDefault: true },
        });
      });

      res.json({ agent });
    } catch (err) {
      next(err);
    }
  });

  // ─── Agent 头像 ───

  /**
   * 上传 Agent 头像
   */
  router.post('/:id/avatar', authMiddleware, (req, res, next) => {
    const { id } = req.params;

    // 路径穿越防护：仅允许安全字符
    if (!/^[\w-]+$/.test(id)) {
      res.status(400).json({ error: 'Invalid agent ID' });
      return;
    }

    createAvatarUpload().single('avatar')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      (async () => {
        try {
          const authReq = req as AuthenticatedRequest;
          const user = authReq.user!;
          const file = (req as { file?: { buffer: Buffer; mimetype: string } }).file;

          if (!file) {
            res.status(400).json({ error: '请选择头像文件' });
            return;
          }

          // 验证 agent 归属
          const existing = await prisma.agent.findFirst({
            where: { id, ownerId: user.id },
          });
          if (!existing) {
            res.status(404).json({ error: 'Agent not found' });
            return;
          }

          const ext = mimeToExt(file.mimetype);
          const avatarDir = path.join(dataRoot || './data', 'avatars', 'agents', id);
          await fs.promises.mkdir(avatarDir, { recursive: true });

          // 删除旧头像（可能是不同扩展名）
          try {
            const files = await fs.promises.readdir(avatarDir);
            for (const f of files) {
              if (f.startsWith('avatar.')) {
                await fs.promises.unlink(path.join(avatarDir, f));
              }
            }
          } catch { /* ignore */ }

          const avatarPath = path.join(avatarDir, `avatar.${ext}`);
          await fs.promises.writeFile(avatarPath, file.buffer);

          // 更新 DB identity JSON 中的 avatar 字段
          const currentIdentity = (existing.identity as Record<string, unknown>) ?? {};
          const avatarUrl = `/api/agents/${id}/avatar`;
          const newIdentity = { ...currentIdentity, avatar: avatarUrl };
          await prisma.agent.update({
            where: { id },
            data: { identity: newIdentity },
          });

          // 同步写入 IDENTITY.md 的 avatar 字段
          if (bridge?.isConnected) {
            try {
              const nativeAgentId = req.tenantBridge!.agentId(existing.name);
              // 读取现有 IDENTITY.md 内容
              let identityContent = '';
              try {
                const result = await bridge.call('agents.files.get', { agentId: nativeAgentId, name: 'IDENTITY.md' }) as EngineAgentFileResponse;
                if (typeof result === 'string') {
                  identityContent = result;
                } else if (result?.file) {
                  identityContent = typeof result.file === 'string' ? result.file : (result.file?.content ?? '');
                } else {
                  identityContent = result?.content ?? '';
                }
              } catch { /* file not found */ }

              // 更新或添加 avatar 行
              const lines = identityContent.split('\n').filter((l: string) => !l.startsWith('avatar:'));
              lines.push(`avatar: ${avatarUrl}`);
              await bridge.call('agents.files.set', { agentId: nativeAgentId, name: 'IDENTITY.md', content: lines.join('\n') });
            } catch (e: unknown) {
              logger.error('[agents] avatar IDENTITY.md sync failed:', { error: e instanceof Error ? e.message : String(e) });
            }
          }

          res.json({ ok: true, avatarUrl });
        } catch (err) {
          next(err);
        }
      })();
    });
  });

  /**
   * 获取 Agent 头像（无需 JWT，用于 img src 直接引用）
   */
  router.get('/:id/avatar', async (req, res) => {
    try {
      const { id } = req.params;

      // 路径穿越防护：仅允许安全字符
      if (!/^[\w-]+$/.test(id)) {
        res.status(400).json({ error: 'Invalid agent ID' });
        return;
      }

      // 在 avatars 目录查找
      const avatarDir = path.join(dataRoot || './data', 'avatars', 'agents', id);
      try {
        const files = await fs.promises.readdir(avatarDir);
        const avatarFile = files.find(f => f.startsWith('avatar.'));
        if (avatarFile) {
          const fullPath = path.join(avatarDir, avatarFile);
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.sendFile(path.resolve(fullPath));
          return;
        }
      } catch { /* directory not found */ }

      res.status(404).json({ error: '头像不存在' });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message || '获取头像失败' });
    }
  });

  return router;
}
