/**
 * 内部 Chat 注入 API
 *
 * 供外部脚本（如 dispatch notify.sh）通过 localhost HTTP 调用，
 * 向用户 agent 的活跃会话注入消息，触发 agent 回复。
 *
 * 认证：INTERNAL_API_TOKEN + localhost 限制（与 im-internal 一致）。
 */

import { Router } from 'express';
import type { EngineAdapter } from '../services/EngineAdapter';
import { TenantEngineAdapter } from '../services/TenantEngineAdapter';
import type { WorkspaceManager } from '@octopus/workspace';
import { ensureAndSyncNativeAgent } from '../services/AgentConfigSync';
import { createLogger } from '../utils/logger';

const logger = createLogger('chat-internal');

export function createChatInternalRouter(
  bridge: EngineAdapter,
  workspaceManager: WorkspaceManager,
  dataRoot: string,
): Router {
  const router = Router();
  const token = process.env['INTERNAL_API_TOKEN'];
  if (!token) {
    logger.error('[chat-internal] INTERNAL_API_TOKEN 未设置，内部 Chat API 已禁用');
    router.use((_req, res) => {
      res.status(503).json({ error: 'Internal Chat API disabled' });
    });
    return router;
  }

  // 内部认证中间件：localhost + token
  router.use((req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocal) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (req.headers['x-internal-token'] !== token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });

  /**
   * POST /api/_internal/chat/inject
   *
   * Body: { userId: string, agentName?: string, message: string }
   * Response: { success: true, sessionKey: string }
   *
   * 找到用户最近活跃的 session 并注入消息，触发 agent 回复。
   * 如果没有活跃 session，创建新 session。
   */
  router.post('/inject', async (req, res) => {
    const { userId, agentName = 'default', message } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    if (!bridge.isConnected) {
      return res.status(503).json({ error: 'Native gateway not connected' });
    }

    try {
      const tenant = TenantEngineAdapter.forUser(bridge, userId);
      const nativeAgentId = tenant.agentId(agentName);

      // 确保 agent 存在
      await ensureAndSyncNativeAgent(bridge, workspaceManager, userId, agentName, {
        useCache: true,
        dataRoot,
      });

      // 查找最近活跃的 session
      const result = await bridge.sessionsList(nativeAgentId);
      const sessions = (result?.sessions || [])
        .filter((s) => (s.key || s.sessionKey || '').startsWith(`agent:${nativeAgentId}:session:`))
        .sort((a, b) => {
          const ta = new Date(a.updatedAt || 0).getTime();
          const tb = new Date(b.updatedAt || 0).getTime();
          return tb - ta; // 最新的在前
        });

      let sessionKey: string;
      if (sessions.length > 0) {
        sessionKey = sessions[0].key || sessions[0].sessionKey;
      } else {
        // 无活跃 session，创建新的
        const sid = `inject-${Date.now().toString(36)}`;
        sessionKey = tenant.sessionKey(agentName, sid);
      }

      // 注入消息（fire-and-forget，不等 agent 回复完成）
      bridge.callAgent(
        {
          message,
          agentId: nativeAgentId,
          sessionKey,
          deliver: false,
        },
        () => {}, // 不处理流式事件
      ).catch((err: unknown) => {
        logger.error(`[chat-internal] callAgent failed for ${userId}:`, { error: err instanceof Error ? err.message : String(err) });
      });

      logger.info(`[chat-internal] injected message to ${sessionKey} for ${userId}`);
      res.json({ success: true, sessionKey });
    } catch (err: unknown) {
      logger.error(`[chat-internal] inject failed for ${userId}:`, { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: 'Inject failed' });
    }
  });

  return router;
}
