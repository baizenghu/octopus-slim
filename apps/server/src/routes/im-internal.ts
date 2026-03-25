/**
 * 内部 IM 发送 API
 *
 * 供 native gateway plugin（enterprise-mcp）通过 localhost HTTP 调用，
 * 向用户绑定的所有 IM 渠道发送消息。
 *
 * 认证：INTERNAL_API_TOKEN（环境变量），仅接受 localhost 请求。
 * 通用设计：IM 适配层在企业 gateway 统一管理，plugin 侧零改动即可支持新渠道。
 */

import { Router } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import type { IMService } from '../services/im';
import type { WorkspaceManager } from '@octopus/workspace';

export function createImInternalRouter(imService: IMService, workspaceManager?: WorkspaceManager): Router {
  const router = Router();
  const token = process.env['INTERNAL_API_TOKEN'];
  if (!token) {
    console.error('[im-internal] INTERNAL_API_TOKEN 未设置，内部 IM API 已禁用');
    router.use((_req, res) => {
      res.status(503).json({ error: 'Internal IM API disabled: INTERNAL_API_TOKEN not configured' });
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
   * POST /api/_internal/im/send
   *
   * Body: { userId: string, message: string }
   * Response: { sent: number } — 成功发送的渠道数
   */
  router.post('/send', async (req, res) => {
    const { userId, message } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message is required' });
    }

    try {
      const sent = await imService.sendToUser(userId, message);
      res.json({ sent });
    } catch (err: any) {
      console.error(`[im-internal] send failed for ${userId}:`, err.message);
      res.status(500).json({ error: 'Internal send error' });
    }
  });

  /**
   * POST /api/_internal/im/send-file
   *
   * Body: { userId: string, fileName: string }
   * 后端根据 userId 自动解析 outputs/ 目录的宿主机路径（沙箱容器路径不可直接使用）
   * Response: { sent: number }
   */
  router.post('/send-file', async (req, res) => {
    const { userId, fileName } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!fileName || typeof fileName !== 'string') {
      return res.status(400).json({ error: 'fileName is required' });
    }

    // 防止路径穿越
    const safeName = path.basename(fileName);
    if (safeName !== fileName || fileName.includes('..')) {
      return res.status(400).json({ error: 'Invalid fileName' });
    }

    // 解析宿主机上的 outputs 目录路径
    let outputsDir: string;
    if (workspaceManager) {
      outputsDir = workspaceManager.getSubPath(userId, 'OUTPUTS');
    } else {
      const dataRoot = process.env.DATA_ROOT || './data';
      outputsDir = path.join(dataRoot, 'users', userId, 'workspace', 'outputs');
    }

    const filePath = path.join(outputsDir, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: `文件不存在: ${safeName}` });
    }

    try {
      const sent = await imService.sendFileToUser(userId, filePath, safeName);
      res.json({ sent });
    } catch (err: any) {
      console.error(`[im-internal] send-file failed for ${userId}:`, err.message);
      res.status(500).json({ error: 'Internal send error' });
    }
  });

  return router;
}
