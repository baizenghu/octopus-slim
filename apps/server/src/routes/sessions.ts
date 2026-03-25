/**
 * 会话管理路由 — 从 chat.ts 提取
 *
 * GET  /models                       - 获取可用模型列表
 * GET  /sessions                     - 列出用户会话
 * GET  /history/:sessionId           - 获取完整会话历史
 * DELETE /history/:sessionId         - 清除会话
 * PUT  /sessions/:sessionId/title    - 重命名会话
 * POST /sessions/:sessionId/generate-title  - 自动生成标题
 * GET  /sessions/:sessionId/status   - 轻量级会话状态检查（委派轮询优化）
 * GET  /sessions/:sessionId/usage    - 获取会话 Token 用量
 * POST /sessions/:sessionId/compact  - 压缩长会话历史
 * POST /sessions/:sessionId/abort    - 终止正在进行的对话
 * GET  /tools                        - 获取可用工具目录
 * GET  /search                       - 搜索历史消息
 * GET  /export/:sessionId            - 导出会话
 */

import { Router } from 'express';
import type { AuthService } from '@octopus/auth';
import type { WorkspaceManager } from '@octopus/workspace';
import type { AuditLogger } from '@octopus/audit';
import type { GatewayConfig } from '../config';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { EngineAdapter } from '../services/EngineAdapter';
import { validateSessionOwnership } from '../utils/ownership';
import { sanitizeUserContent, sanitizeAssistantContent, isInternalMessage } from '../utils/ContentSanitizer';
import { createLogger } from '../utils/logger';
import type { AppPrismaClient } from '../types/prisma';
import type {
  EngineSessionItem,
  EngineSessionsListResponse,
  EngineContentBlock,
  EngineMessage,
  EngineChatHistoryResponse,
  EngineModelItem,
  EngineModelsListResponse,
  EngineConfig,
  EngineProviderConfig,
} from '../types/engine';

const logger = createLogger('sessions');

/**
 * 自动生成会话标题（从首条用户消息截断）
 *
 * 非闭包版本，接受 bridge 参数，供 chat.ts 和本文件共用。
 */
export async function autoGenerateTitle(bridge: EngineAdapter, sessionId: string): Promise<string | null> {
  if (!bridge?.isConnected) return null;
  try {
    // 1. 检查是否已经有标题（label）
    // 从 sessionKey 解析 agentId 用于服务端过滤
    const agentIdMatch = sessionId.match(/^agent:([^:]+):session:/);
    const titleAgentId = agentIdMatch ? agentIdMatch[1] : undefined;
    const result = await bridge.sessionsList(titleAgentId) as EngineSessionsListResponse;
    const sessions: EngineSessionItem[] = result?.sessions ?? [];
    const session = sessions.find((s) => (s.key || s.sessionKey) === sessionId);

    // 如果已经有自定义标题，跳过
    if (session?.label && session.label !== '新对话') {
      return session.label;
    }

    // 2. 获取历史记录取首条消息
    const history = await bridge.chatHistory(sessionId) as EngineChatHistoryResponse;
    const messages: EngineMessage[] = history?.messages ?? history?.history ?? [];

    const firstUser = messages.find((m) => m.role === 'user');
    if (!firstUser) return null;

    let content: string;
    if (Array.isArray(firstUser.content)) {
      content = firstUser.content.map((c: EngineContentBlock) => c.text || c.content || '').join('');
    } else {
      content = String(firstUser.content || '');
    }

    // 剥离记忆系统注入的标签、时间戳前缀和附件前缀（与 history 路由相同的净化逻辑）
    content = sanitizeUserContent(content);

    if (!content) return null;

    const trimmed = content.replace(/\s+/g, ' ');
    const title = trimmed.length > 24 ? trimmed.slice(0, 24) + '…' : trimmed;
    logger.info('generated title', { title });

    if (title && title !== '新对话') {
      // 尝试 patch 标题，遇到 label 重复时加时间戳后缀重试（最多 2 次）
      let finalTitle = title;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await bridge.sessionsPatch(sessionId, { label: finalTitle });
          return finalTitle;
        } catch (patchErr: unknown) {
          const msg = patchErr instanceof Error ? patchErr.message : String(patchErr ?? '');
          if (msg.includes('label already in use')) {
            const now = new Date();
            const suffix = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
            finalTitle = `${title} (${suffix}${attempt > 0 ? `-${attempt}` : ''})`;
            logger.warn('label 重复，重试', { finalTitle });
            continue;
          }
          // 非 label 重复错误，直接抛出
          throw patchErr;
        }
      }
      // 重试耗尽，静默放弃（不抛出，防止调用方再重试）
      logger.warn('label 重复重试耗尽，放弃', { finalTitle });
      return null;
    }
  } catch (err) {
    logger.error('autoGenerateTitle failed', { sessionId, error: err });
  }
  return null;
}

/** 加载用户的 Agent 配置（纯函数，供 chat.ts / sessions.ts 共享） */
export async function loadAgentFromDb(
  prisma: AppPrismaClient | null,
  userId: string,
  agentId?: string,
) {
  if (!prisma) return null;
  try {
    if (agentId) {
      return await prisma.agent.findFirst({ where: { id: agentId, ownerId: userId, enabled: true } });
    }
    return await prisma.agent.findFirst({ where: { ownerId: userId, isDefault: true, enabled: true } });
  } catch {
    return null;
  }
}

export function createSessionsRouter(
  _config: GatewayConfig,
  authService: AuthService,
  _workspaceManager: WorkspaceManager,
  bridge: EngineAdapter | undefined,
  prisma?: AppPrismaClient,
  _auditLogger?: AuditLogger,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma, bridge);

  // loadAgent 已提取为顶层 loadAgentFromDb

  /**
   * 获取可用模型
   */
  router.get('/models', authMiddleware, async (_req: AuthenticatedRequest, res) => {
    if (!bridge?.isConnected) {
      res.json({ models: [] });
      return;
    }
    try {
      const result = await bridge.modelsList() as EngineModelsListResponse;
      const allModels: EngineModelItem[] = result?.models ?? [];

      // 从 octopus.json 读取已配置的 providers，只返回这些 provider 的模型
      const { config: octopusCfgRaw } = await bridge.configGetParsed();
      const octopusCfg = octopusCfgRaw as EngineConfig;
      const configuredProviders = new Set<string>();
      // models.providers 中显式配置的
      const providers = octopusCfg.models?.providers;
      if (providers && typeof providers === 'object') {
        for (const key of Object.keys(providers)) {
          configuredProviders.add(key);
        }
      }
      // agents.defaults.model 中引用的 provider
      const defaultModel = octopusCfg.agents?.defaults?.model;
      const primaryStr = typeof defaultModel === 'string' ? defaultModel : defaultModel?.primary;
      if (primaryStr && primaryStr.includes('/')) {
        configuredProviders.add(primaryStr.split('/')[0]);
      }
      const fallbacks: string[] = (typeof defaultModel === 'object' && defaultModel !== null
        ? defaultModel.fallbacks ?? []
        : []);
      for (const fb of fallbacks) {
        if (fb && fb.includes('/')) configuredProviders.add(fb.split('/')[0]);
      }

      // 过滤：只保留已配置 provider 的模型
      const filtered: EngineModelItem[] = configuredProviders.size > 0
        ? allModels.filter((m) => {
            const provider = m.provider || (m.id?.includes('/') ? m.id.split('/')[0] : '');
            return configuredProviders.has(provider);
          })
        : [...allModels];

      // 补充：octopus.json 中自定义 provider 的模型可能不在引擎列表中，手动添加
      const existingIds = new Set(filtered.map((m) => `${m.provider}/${m.id}`));
      if (providers && typeof providers === 'object') {
        for (const [providerKey, providerCfg] of Object.entries(providers)) {
          const cfg = providerCfg as EngineProviderConfig;
          const modelEntries = cfg?.models ?? [];
          for (const entry of modelEntries) {
            const modelId = typeof entry === 'string' ? entry : entry?.id;
            const modelName = typeof entry === 'string' ? entry : (entry?.name ?? entry?.id);
            if (modelId && !existingIds.has(`${providerKey}/${modelId}`)) {
              filtered.push({ id: modelId, name: modelName, provider: providerKey });
            }
          }
        }
      }

      res.json({ models: filtered });
    } catch {
      res.json({ models: [] });
    }
  });

  /**
   * 列出用户的会话（按 agentId 过滤）
   */
  router.get('/sessions', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      // 确定过滤前缀：若传了 agentId 则精确匹配该 agent，否则取默认 agent
      let agentPrefix: string;
      let nativeAgentId: string | undefined;
      const reqAgentId = req.query.agentId as string | undefined;
      if (prisma) {
        const agent = reqAgentId
          ? await prisma.agent.findFirst({ where: { id: reqAgentId, ownerId: user.id } })
          : await prisma.agent.findFirst({ where: { ownerId: user.id, isDefault: true } });
        const agentName = agent?.name || 'default';
        nativeAgentId = req.tenantBridge!.agentId(agentName);
        agentPrefix = `agent:${nativeAgentId}:session:`;
      } else {
        // 无 DB 时退回到用户级别过滤
        agentPrefix = `agent:ent_${user.id}_`;
      }

      // 传入 agentId 让 Native Gateway 服务端过滤，减少全量数据暴露
      const result = await bridge.sessionsList(nativeAgentId) as EngineSessionsListResponse;
      // 保留客户端 filter 作为二次防御
      const rawSessions: EngineSessionItem[] = (result?.sessions ?? [])
        .filter((s) => {
          const key = s.key || s.sessionKey || '';
          if (!key.startsWith(agentPrefix)) return false;
          // 排除心跳隔离会话
          const sessionId = key.slice(agentPrefix.length);
          if (sessionId.startsWith('heartbeat-')) return false;
          return true;
        });

      // P1-12: 异步补标题（fire-and-forget），不阻塞列表返回
      // 标题会在后台生成，前端下次刷新时看到
      const needsTitle = (s: EngineSessionItem) => {
        const lbl = s.label || s.title || '';
        return !lbl || lbl === '新对话' || lbl.includes('<relevant-memories') || lbl.includes('[UNTRUSTED DATA');
      };
      const sessionsNeedingTitle = rawSessions.filter(needsTitle).slice(0, 5);
      if (sessionsNeedingTitle.length > 0) {
        // fire-and-forget: 不 await，后台异步执行
        Promise.allSettled(
          sessionsNeedingTitle.map((s) =>
            autoGenerateTitle(bridge!, s.key || s.sessionKey).catch(() => null)
          )
        ).catch(err => logger.error('background title generation error', { error: err }));
      }

      const sessions = rawSessions.map((s) => ({
        sessionId: s.key || s.sessionKey,
        title: (s.label || s.title || '新对话')
          .replace(/^\[请(?:使用|严格按照|优先使用)\s+[^\]]*(?:\]|\S*…)\s*/m, '')
          .replace(/^\/lesson\s+/m, '')
          .trim() || '新对话',
        agentId: s.agentId,
        lastActiveAt: new Date(s.updatedAt || s.lastActiveAt || Date.now()).toISOString(),
        messageCount: s.messageCount || 0,
      }));
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 获取会话历史
   */
  router.get('/history/:sessionId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    let sessionId = req.params.sessionId;
    // 短 ID 兜底：如果传来的不是完整 session key，根据 agentId 构造完整 key
    if (!sessionId.startsWith('agent:')) {
      const reqAgentId = req.query.agentId as string | undefined;
      const agent = await loadAgentFromDb(prisma, user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      sessionId = req.tenantBridge!.sessionKey(agentName, sessionId);
    }
    // 用户归属校验：确保 session 属于当前用户
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const history = await bridge.chatHistory(sessionId) as EngineChatHistoryResponse;
      // native gateway 的 content 字段是 [{type:'text', text:'...'}] 数组，转成字符串
      type ToolCallInfo = { name: string; toolCallId?: string; args?: string; result?: string };
      type HistoryMsg = { role: 'user' | 'assistant'; content: string; thinking?: string; ts?: string; toolCalls?: ToolCallInfo[] };

      const rawMessages = (history?.messages ?? history?.history ?? [])
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m: EngineMessage) => {
          // map 内部可能返回 null（subagent 内部消息），后面 filter 掉
          let content: string;
          let toolCalls: ToolCallInfo[] | undefined;
          if (Array.isArray(m.content)) {
            // 只提取 type=text 的内容块，跳过 tool_use 等非文本块（与引擎 WebUI extractRawText 一致）
            content = m.content
              .filter((c: EngineContentBlock) => c.type === 'text' && typeof c.text === 'string')
              .map((c: EngineContentBlock) => c.text)
              .join('\n');
            // 提取工具调用块（引擎用 toolCall，标准 API 用 tool_use）
            const toolUseBlocks = m.content.filter((c: EngineContentBlock) => (c.type === 'toolCall' || c.type === 'tool_use') && c.name);
            if (toolUseBlocks.length > 0) {
              toolCalls = toolUseBlocks.map((c: EngineContentBlock) => ({
                name: c.name!,
                toolCallId: c.id || undefined,
                args: c.args ? (typeof c.args === 'string' ? c.args : JSON.stringify(c.args)) :
                      c.arguments ? (typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments)) :
                      c.input ? (typeof c.input === 'string' ? c.input : JSON.stringify(c.input)) : undefined,
              }));
            }
          } else if (typeof m.content === 'string') {
            content = m.content;
          } else {
            content = String(m.content ?? '');
          }

          // 用户消息：剥离系统注入的内部上下文
          let thinking: string | undefined;
          if (m.role === 'user') {
            if (isInternalMessage(content)) return null;
            content = sanitizeUserContent(content);
          }

          // 助手消息：剥离 enterprise-reminder 标签 + 分离 thinking
          if (m.role === 'assistant') {
            const sanitized = sanitizeAssistantContent(content);
            content = sanitized.content;
            thinking = sanitized.thinking;
          }

          return {
            role: m.role as 'user' | 'assistant',
            content,
            ...(thinking ? { thinking } : {}),
            ...(toolCalls ? { toolCalls } : {}),
            ts: m.timestamp ? new Date(m.timestamp).toISOString() : undefined,
          };
        })
        .filter(Boolean) as HistoryMsg[];

      // 合并相邻的 assistant 消息（工具调用会将助手回复拆成多段，刷新后应显示为一个气泡）
      const messages: HistoryMsg[] = [];
      for (const msg of rawMessages) {
        const last = messages[messages.length - 1];
        if (last && last.role === 'assistant' && msg.role === 'assistant') {
          last.content = (last.content + (last.content && msg.content ? '\n\n' : '') + msg.content).trim();
          if (msg.thinking) {
            last.thinking = (last.thinking ? last.thinking + '\n' : '') + msg.thinking;
          }
          if (msg.toolCalls) {
            last.toolCalls = [...(last.toolCalls || []), ...msg.toolCalls];
          }
        } else {
          messages.push({ ...msg });
        }
      }

      res.json({ sessionId, messages });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 清除会话
   */
  router.delete('/history/:sessionId', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    let sessionId = req.params.sessionId;
    // 短 ID 兜底：构造完整 session key
    if (!sessionId.startsWith('agent:')) {
      const reqAgentId = req.query.agentId as string | undefined;
      const agent = await loadAgentFromDb(prisma, user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      sessionId = req.tenantBridge!.sessionKey(agentName, sessionId);
    }
    // 用户归属校验：确保 session 属于当前用户
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      await bridge.sessionsDelete(sessionId);
      res.json({ message: 'Session deleted' });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 重命名会话
   */
  router.put('/sessions/:sessionId/title', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    // 用户归属校验：确保 session 属于当前用户
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    const { title } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      await bridge.sessionsPatch(sessionId, { label: title.trim() });
      res.json({ message: 'Session renamed', sessionId, title: title.trim() });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 自动生成会话标题：取第一条用户消息截断作为标题
   */
  router.post('/sessions/:sessionId/generate-title', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    let { sessionId } = req.params;

    // 支持短 ID：若不是完整 session key，自动拼接
    if (!sessionId.startsWith('agent:')) {
      const { agentId: reqAgentId } = req.body || {};
      const agent = await loadAgentFromDb(prisma, user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      sessionId = req.tenantBridge!.sessionKey(agentName, sessionId);
    }

    // 权限校验：session key 必须包含当前用户 ID
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const title = await autoGenerateTitle(bridge!, sessionId);
    res.json({ sessionId, title });
  });

  /**
   * 轻量级会话状态检查（委派轮询优化）
   * 只返回 completed + messageCount，避免每次轮询都拉全量历史
   */
  router.get('/sessions/:sessionId/status', authMiddleware, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    let sessionId = req.params.sessionId;
    if (!sessionId.startsWith('agent:')) {
      const reqAgentId = req.query.agentId as string | undefined;
      const agent = await loadAgentFromDb(prisma, user.id, reqAgentId);
      const agentName = agent?.name || 'default';
      sessionId = req.tenantBridge!.sessionKey(agentName, sessionId);
    }
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const history = await bridge.chatHistory(sessionId) as EngineChatHistoryResponse;
      const messages: EngineMessage[] = history?.messages ?? history?.history ?? [];
      const userAssistantMsgs = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
      const lastMsg = userAssistantMsgs[userAssistantMsgs.length - 1];
      const completed = !lastMsg || lastMsg.role === 'assistant';
      res.json({ completed, messageCount: userAssistantMsgs.length });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /**
   * 获取会话 Token 用量
   */
  router.get('/sessions/:sessionId/usage', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const usage = await bridge.sessionsUsage({ key: sessionId });
      res.json(usage);
    } catch (err) {
      next(err);
    }
  });

  /**
   * 压缩长会话历史
   */
  router.post('/sessions/:sessionId/compact', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    if (!validateSessionOwnership(sessionId, user.id)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const result = await bridge.sessionsCompact(sessionId, req.body.maxLines);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  /**
   * 终止正在进行的对话
   */
  router.post('/sessions/:sessionId/abort', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    const sessionId = req.params.sessionId;
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      let sessionKey = sessionId;
      if (!sessionId.startsWith('agent:')) {
        // agentId 可能是 DB id，需要查出 name
        const reqAgentId = req.query.agentId as string | undefined;
        const agent = await loadAgentFromDb(prisma, user.id, reqAgentId);
        const agentName = agent?.name || 'default';
        sessionKey = req.tenantBridge!.sessionKey(agentName, sessionId);
      } else if (!validateSessionOwnership(sessionId, user.id)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      logger.info('abort request', { sessionId, sessionKey });
      const result = await bridge.chatAbort(sessionKey);
      logger.info('abort result', { result });
      res.json({ success: true, result });
    } catch (err) {
      next(err);
    }
  });

  /**
   * 获取可用工具目录（原生 catalog + 企业 MCP 工具合并）
   */
  router.get('/tools', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
    const user = req.user!;
    if (!bridge?.isConnected) {
      res.status(503).json({ error: 'Native gateway not connected' });
      return;
    }
    try {
      const agentName = (req.query.agentName as string) || 'default';
      const nativeAgentId = req.tenantBridge!.agentId(agentName);
      const catalog = await bridge.toolsCatalog(nativeAgentId);
      res.json(catalog);
    } catch (err) {
      next(err);
    }
  });

  /**
   * 搜索历史消息（原生 bridge 暂不支持，返回空结果）
   */
  router.get('/search', authMiddleware, async (req: AuthenticatedRequest, res) => {
    res.json({ query: req.query.q || '', count: 0, results: [] });
  });

  /**
   * 导出会话（原生 bridge 暂不支持）
   */
  router.get('/export/:sessionId', authMiddleware, async (_req: AuthenticatedRequest, res) => {
    res.status(501).json({ error: 'Export not yet supported with native bridge' });
  });

  return router;
}
