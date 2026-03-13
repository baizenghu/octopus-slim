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
import type { AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import type { EngineAdapter } from '../services/EngineAdapter';
import { getSoulTemplate, getMemoryTemplate } from '../services/SoulTemplate';

import type { AppPrismaClient } from '../types/prisma';
import { resolve as pathResolve } from 'path';
import { readFile } from 'fs/promises';

/** Agent workspace 中允许读写的配置文件白名单 */
const AGENT_CONFIG_FILES = ['IDENTITY.md', 'SOUL.md', 'AGENTS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'TOOLS.md', 'USER.md'];

/** tools-cache.json 路径 */
const TOOLS_CACHE_PATH = pathResolve(__dirname, '..', '..', '..', '..', 'plugins', 'enterprise-mcp', 'tools-cache.json');

export function createAgentsRouter(
  authService: AuthService,
  prisma: AppPrismaClient,
  workspaceManager?: WorkspaceManager,
  bridge?: EngineAdapter,
  dataRoot?: string,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);

  /**
   * 更新 default agent 的 subagents.allowAgents，使其可以 spawn 专业 agent
   * 同时配置专业 agent 可以回调 default agent
   */
  /**
   * 同步 default agent 的 subagents.allowAgents 配置。
   *
   * ⚠️ config.apply 对数组是整体替换（不是合并），因此必须先读取完整的 agents.list，
   * 修改需要更新的 agent 的 subagents 字段，然后发送完整的 agents.list。
   * 不能走 configApplyBatched，因为多个用户的 syncAllowAgents 合并会导致数组覆盖。
   */
  async function syncAllowAgents(userId: string) {
    if (!bridge?.isConnected) return;
    const { EngineAdapter: OCB } = await import('../services/EngineAdapter');
    try {
      // 查询该用户的所有 agent
      const agents = await prisma.agent.findMany({
        where: { ownerId: userId, enabled: true },
        select: { name: true },
      });
      const defaultAgentId = OCB.userAgentId(userId, 'default');
      const specialistIds = agents
        .filter((a: { name: string }) => a.name !== 'default')
        .map((a: { name: string }) => OCB.userAgentId(userId, a.name));

      // 读取当前完整配置（config.apply 是全量替换，必须发送完整配置）
      const { config } = await bridge.configGetParsed();
      const currentList: any[] = (config as any)?.agents?.list || [];

      // 更新 default agent 的 allowAgents，但仅在实际变化时才调用 configApplyFull
      let found = false;
      let changed = false;
      for (const item of currentList) {
        if (item.id === defaultAgentId) {
          const newAllow = specialistIds.length > 0 ? specialistIds : undefined;
          const oldAllow = item.subagents?.allowAgents;
          if (JSON.stringify(newAllow) !== JSON.stringify(oldAllow)) {
            changed = true;
          }
          item.subagents = { ...item.subagents, allowAgents: newAllow };
          found = true;
        } else if (specialistIds.includes(item.id)) {
          const oldAllow = item.subagents?.allowAgents;
          if (JSON.stringify(oldAllow) !== JSON.stringify([])) {
            changed = true;
          }
          item.subagents = { ...item.subagents, allowAgents: [] };
        }
      }

      if (!found) {
        console.warn(`[agents] default agent ${defaultAgentId} not found in native config, skipping syncAllowAgents`);
        return;
      }

      if (!changed) {
        console.log('[agents] syncAllowAgents skipped: allowAgents unchanged for', userId);
        return;
      }

      // config.apply 是全量替换，发送完整配置（只修改了 agents.list 部分）
      (config as any).agents.list = currentList;
      await bridge.configApplyFull(config);
      console.log('[agents] syncAllowAgents success for', userId, 'specialists:', specialistIds);
    } catch (e: any) {
      console.error('[agents] syncAllowAgents failed:', e.message);
      // 限流时延迟重试
      if (e.message?.includes('rate limit')) {
        const delaySec = parseInt(e.message.match(/retry after (\d+)s/)?.[1] || '60', 10);
        console.log(`[agents] syncAllowAgents will retry in ${delaySec}s`);
        setTimeout(() => syncAllowAgents(userId), delaySec * 1000);
      }
    }
  }

  /**
   * 同步 agent 到原生 gateway，并自动配置 memory scope 隔离 + 独立工作空间
   * @param isUpdate 是否为更新操作（更新时不覆盖 MEMORY.md，保留已有记忆 #19 修复）
   */
  async function syncToNative(userId: string, agentName: string, systemPrompt?: string | null, identity?: any, isUpdate = false) {
    if (!bridge?.isConnected || !workspaceManager) return;
    const { EngineAdapter: OCB } = await import('../services/EngineAdapter');
    const nativeAgentId = OCB.userAgentId(userId, agentName);

    // 专业 agent 使用独立工作空间，default agent 使用用户主 workspace
    const workspacePath = await workspaceManager.initAgentWorkspace(userId, agentName);
    try {
      await bridge.agentsCreate({ name: nativeAgentId, workspace: workspacePath });
    } catch {
      // 已存在时更新 workspace 路径（防止 ensureNativeAgent 用错默认路径）
      try {
        await bridge.agentsUpdate({ agentId: nativeAgentId, workspace: workspacePath });
      } catch { /* ignore */ }
    }

    // agentFilesSet 带重试：原生 gateway 创建 agent 后异步初始化 workspace，立即调用会 "unknown agent id"
    const setFileWithRetry = async (fileName: string, content: string) => {
      try {
        await bridge.agentFilesSet(nativeAgentId, fileName, content);
      } catch (e: any) {
        console.warn(`[agents] agentFilesSet ${fileName} failed for ${nativeAgentId}, retrying in 1.5s:`, e.message);
        await new Promise(r => setTimeout(r, 1500));
        await bridge.agentFilesSet(nativeAgentId, fileName, content);
      }
    };

    if (identity?.name || identity?.emoji) {
      const parts = [identity.name ? `name: ${identity.name}` : '', identity.emoji ? `emoji: ${identity.emoji}` : ''].filter(Boolean);
      await setFileWithRetry('IDENTITY.md', parts.join('\n')).catch((e: any) => {
        console.error(`[agents] agentFilesSet IDENTITY.md ultimately failed for ${nativeAgentId}:`, e.message);
      });
    }
    await setFileWithRetry('SOUL.md', systemPrompt || getSoulTemplate(dataRoot || '', agentName)).catch((e: any) => {
      console.error(`[agents] agentFilesSet SOUL.md ultimately failed for ${nativeAgentId}:`, e.message);
    });
    // MEMORY.md 仅在创建时写入，更新时保留已有记忆（#19 修复）
    if (!isUpdate) {
      const memDisplayName = identity?.name || agentName;
      await setFileWithRetry('MEMORY.md', getMemoryTemplate(dataRoot || '', memDisplayName)).catch((e: any) => {
        console.error(`[agents] agentFilesSet MEMORY.md ultimately failed for ${nativeAgentId}:`, e.message);
      });
    }
    // memory-lancedb-pro 默认行为已提供 scope 隔离（agent:<id> + global），无需显式注册
  }

  /** 原生工具描述映射 */
  const NATIVE_TOOL_DESCRIPTIONS: Record<string, string> = {
    list_files: '列出工作空间中的文件和目录',
    read_file: '读取文件内容',
    write_file: '写入或创建文件',
    execute_command: '在沙箱中执行 Shell 命令（bash）',
    search_files: '按文件名模式搜索文件',
  };

  /**
   * 根据 agent 的 toolsFilter + mcpFilter 生成 TOOLS.md 并写入 agent workspace
   * 权限变化时调用，保持 TOOLS.md 与配置实时同步
   */
  async function syncToolsMd(userId: string, agentName: string, mcpFilter: string[], toolsFilter?: string[]) {
    if (!bridge?.isConnected) return;
    const { EngineAdapter: OCB } = await import('../services/EngineAdapter');
    const nativeAgentId = OCB.userAgentId(userId, agentName);

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
      let cachedTools: Array<{ serverId: string; serverName: string; toolName: string; description: string }> = [];
      try {
        const raw = await readFile(TOOLS_CACHE_PATH, 'utf8');
        cachedTools = JSON.parse(raw);
      } catch {
        console.warn('[agents] tools-cache.json not found, skipping cached tools');
      }

      // 3. 从 DB 获取该用户的 personal MCP 工具名
      const personalServers = await prisma.mCPServer.findMany({
        where: { scope: 'personal', ownerId: userId, enabled: true },
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
        await bridge.agentFilesSet(nativeAgentId, 'TOOLS.md', '# 可用工具\n\n当前未配置任何工具。\n');
        console.log(`[agents] TOOLS.md cleared for ${nativeAgentId} (no tools)`);
        return;
      }

      await bridge.agentFilesSet(nativeAgentId, 'TOOLS.md', lines.join('\n'));
      console.log(`[agents] TOOLS.md synced for ${nativeAgentId} (native: ${nativeCount}, mcp: ${mcpToolCount})`);
    } catch (e: any) {
      console.error(`[agents] syncToolsMd failed for ${agentName}:`, e.message);
    }
  }

  /**
   * 确保用户有一个 default agent（主 agent）记录
   * 首次查询时自动创建，保证主 agent 始终出现在列表中
   */
  async function ensureDefaultAgent(userId: string) {
    const existing = await prisma.agent.findFirst({
      where: { ownerId: userId, name: 'default' },
    });
    if (existing) return;

    // 默认 agent 权限全部开启：查询所有已启用的 MCP/Skills/Connections
    const [mcpServers, skills, connections] = await Promise.all([
      prisma.mCPServer.findMany({ where: { enabled: true }, select: { id: true } }),
      prisma.skill.findMany({ where: { enabled: true }, select: { name: true } }),
      prisma.databaseConnection.findMany({ where: { userId, enabled: true }, select: { name: true } }),
    ]);

    const defaultMcpFilter = mcpServers.map((s: { id: string }) => s.id);
    await prisma.agent.create({
      data: {
        id: randomUUID().replace(/-/g, '').slice(0, 16),
        name: 'default',
        description: '主助手，处理各种通用任务',
        ownerId: userId,
        enabled: true,
        isDefault: true,
        identity: { name: 'Octopus AI', emoji: '🐙' },
        toolsFilter: ['list_files', 'read_file', 'write_file'],
        skillsFilter: skills.map((s: { name: string }) => s.name),
        mcpFilter: defaultMcpFilter,
        allowedConnections: connections.map((c: { name: string }) => c.name),
      },
    });

    // 首次创建 default agent 时同步 TOOLS.md（包含原生工具 + MCP 工具）
    const defaultToolsFilter = ['list_files', 'read_file', 'write_file'];
    syncToolsMd(userId, 'default', defaultMcpFilter, defaultToolsFilter).catch((e: any) =>
      console.error('[agents] syncToolsMd for new default agent failed:', e.message),
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
      const { name, model, identity, skillsFilter, mcpFilter, toolsFilter, allowedConnections } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const agent = await prisma.agent.create({
        data: {
          id: randomUUID().replace(/-/g, '').slice(0, 16),
          name: name.trim(),
          description: null,
          ownerId: user.id,
          model: model?.trim() || null,
          systemPrompt: null,
          identity: identity || null,
          skillsFilter: skillsFilter ?? [],
          mcpFilter: mcpFilter ?? [],
          toolsFilter: toolsFilter ?? [],
          allowedConnections: allowedConnections ?? [],
          enabled: true,
          isDefault: false,
        },
      });

      // 同步到原生 Gateway（await 确保同步完成后再响应，#20 修复）
      try {
        await syncToNative(user.id, agent.name, null, agent.identity, false);
        await syncAllowAgents(user.id);
        // 创建时同步 TOOLS.md（原生工具 + MCP 工具）
        await syncToolsMd(user.id, agent.name, mcpFilter || [], toolsFilter || []);
      } catch (e: any) {
        console.error('[agents] Native sync failed:', e.message);
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

      const { name, model, identity, skillsFilter, mcpFilter, toolsFilter, allowedConnections, enabled } = req.body;

      const data: Record<string, any> = {};
      // Agent ID（name）创建后不可修改，修改会导致 native agent ID 变更、历史 session 丢失
      if (name !== undefined && name.trim() !== existing.name) {
        res.status(400).json({ error: 'Agent ID 创建后不可修改' });
        return;
      }
      if (model !== undefined) data.model = model?.trim() || null;
      if (identity !== undefined) data.identity = identity;
      if (skillsFilter !== undefined) data.skillsFilter = skillsFilter;
      if (mcpFilter !== undefined) data.mcpFilter = mcpFilter;
      if (toolsFilter !== undefined) data.toolsFilter = toolsFilter;
      if (allowedConnections !== undefined) data.allowedConnections = allowedConnections;
      if (enabled !== undefined) data.enabled = Boolean(enabled);

      const agent = await prisma.agent.update({
        where: { id },
        data,
      });

      // 仅在影响原生 gateway 的字段实际变化时同步，避免不必要的 config.apply 导致 native gateway 重启
      const identityChanged = identity !== undefined &&
        JSON.stringify(identity) !== JSON.stringify(existing.identity);
      const enabledChanged = enabled !== undefined && enabled !== existing.enabled;
      if (identityChanged || enabledChanged) {
        try {
          await syncToNative(user.id, agent.name, null, agent.identity, true);
          if (enabledChanged) {
            await syncAllowAgents(user.id);
          }
        } catch (e: any) {
          console.error('[agents] Native sync failed:', e.message);
        }
      }

      // mcpFilter 或 toolsFilter 变化时同步 TOOLS.md（增删工具实时写入）
      const mcpFilterChanged = mcpFilter !== undefined &&
        JSON.stringify(mcpFilter) !== JSON.stringify(existing.mcpFilter);
      const toolsFilterChanged = toolsFilter !== undefined &&
        JSON.stringify(toolsFilter) !== JSON.stringify(existing.toolsFilter);
      if (mcpFilterChanged || toolsFilterChanged) {
        const finalMcpFilter = mcpFilter ?? (existing.mcpFilter as string[]) ?? [];
        const finalToolsFilter = toolsFilter ?? (existing.toolsFilter as string[]) ?? [];
        syncToolsMd(user.id, agent.name, finalMcpFilter, finalToolsFilter).catch((e: any) =>
          console.error('[agents] syncToolsMd failed:', e.message),
        );
      }

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
        const { EngineAdapter: OCB } = await import('../services/EngineAdapter');
        const nativeAgentId = OCB.userAgentId(user.id, existing.name);
        await bridge.agentsDelete(nativeAgentId).catch(() => { });
        // 清理残留的 state 目录（原生 gateway deleteFiles 清内容但可能留空目录/sessions）
        const path = await import('path');
        const fs = await import('fs/promises');
        // process.cwd() 是 apps/gateway/，需要向上两级到项目根目录
        const projectRoot = path.resolve(process.cwd(), '..', '..');
        const stateDir = path.resolve(process.env.OCTOPUS_STATE_DIR || path.join(projectRoot, '.octopus-state'), 'agents', nativeAgentId);
        // 延迟 2 秒，等原生 gateway 异步清理完再删目录
        setTimeout(async () => {
          try {
            await fs.rm(stateDir, { recursive: true, force: true });
            console.log(`[agents] Cleaned state dir: ${stateDir}`);
          } catch (e: any) {
            console.error(`[agents] Failed to clean state dir ${stateDir}:`, e.message);
          }
        }, 2000);
        // memory scope 无需清理：memory-lancedb-pro 默认行为不依赖 agentAccess 配置
      }
      // 清理专业 agent 的独立工作空间
      if (workspaceManager && existing.name !== 'default') {
        workspaceManager.deleteAgentWorkspace(user.id, existing.name).catch((e) =>
          console.error('[agents] Workspace cleanup failed:', e.message),
        );
      }
      // 更新 allowAgents 配置（移除已删除的 agent）
      syncAllowAgents(user.id).catch((e) =>
        console.error('[agents] syncAllowAgents after delete failed:', e.message),
      );

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

      const { EngineAdapter: OCB } = await import('../services/EngineAdapter');
      const nativeAgentId = OCB.userAgentId(user.id, existing.name);

      // 并行读取所有配置文件，单个文件失败时 content 返回空字符串
      const files = await Promise.all(
        AGENT_CONFIG_FILES.map(async (fileName) => {
          try {
            const result = await bridge.agentFilesGet(nativeAgentId, fileName) as any;
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
          } catch (e: any) {
            console.warn(`[agents] agentFilesGet ${fileName} failed:`, e.message);
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

      const { EngineAdapter: OCB } = await import('../services/EngineAdapter');
      const nativeAgentId = OCB.userAgentId(user.id, existing.name);
      await bridge.agentFilesSet(nativeAgentId, fileName, content);

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

  return router;
}
