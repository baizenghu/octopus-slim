/**
 * 系统配置管理 API（Admin Only）
 *
 * GET  /api/admin/config          — 读取完整 octopus.json 配置（直接读文件，含明文 apiKey）
 * PUT  /api/admin/config/models   — 更新模型 Provider + 默认模型
 * PUT  /api/admin/config/plugins  — 更新插件启用/配置
 * PUT  /api/admin/config/tools    — 更新工具安全策略
 */

import { Router } from 'express';
import { promises as fsPromises } from 'fs';
import path from 'path';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import type { EngineAdapter } from '../services/EngineAdapter';

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * 直接读取 octopus.json 文件（绕过引擎 config.get 的 apiKey 脱敏）
 */
async function readConfigFromFile(): Promise<Record<string, any>> {
  const stateDir = process.env.OCTOPUS_STATE_DIR || path.join(projectRoot, '.octopus-state');
  const configPath = path.join(stateDir, 'octopus.json');
  const raw = await fsPromises.readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

export function createSystemConfigRouter(
  authService: AuthService,
  bridge: EngineAdapter,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService);

  const adminOnly = (req: AuthenticatedRequest, res: any, next: any) => {
    const user = req.user;
    if (!user || !(user.roles as string[])?.some(r => r.toLowerCase() === 'admin')) {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }
    next();
  };

  /**
   * GET /api/admin/config
   * 直接读取 octopus.json 文件，返回含明文 apiKey 的完整配置
   * （引擎 config.get RPC 会脱敏 apiKey 为 __OCTOPUS_REDACTED__，不适合管理页面）
   */
  router.get('/', authMiddleware, adminOnly, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const config = await readConfigFromFile();
      res.json({ config });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/admin/config/models
   * Body: { providers: Record<string, ProviderConfig>, defaults?: { model: { primary, fallbacks } } }
   */
  router.put('/models', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { providers, defaults } = req.body;
      if (!providers || typeof providers !== 'object') {
        res.status(400).json({ error: 'providers is required' });
        return;
      }

      const c = await readConfigFromFile();

      if (!c.models) c.models = {};
      c.models.providers = providers;

      if (defaults?.model) {
        if (!c.agents) c.agents = {};
        if (!c.agents.defaults) c.agents.defaults = {};
        c.agents.defaults.model = defaults.model;
      }

      await bridge.configApplyFull(c);
      console.log(`[system-config] Models updated by ${req.user!.username}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/admin/config/plugins
   * Body: { allow?: string[], entries?: Record<string, { enabled, config }> }
   */
  router.put('/plugins', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { allow, entries } = req.body;

      const c = await readConfigFromFile();

      if (!c.plugins) c.plugins = {};

      if (Array.isArray(allow)) {
        c.plugins.allow = allow;
      }
      if (entries && typeof entries === 'object') {
        c.plugins.entries = entries;
      }

      await bridge.configApplyFull(c);
      console.log(`[system-config] Plugins updated by ${req.user!.username}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/admin/config/tools
   * Body: { loopDetection?, exec?, fs?, agentsDefaults?: { sandbox } }
   */
  router.put('/tools', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { loopDetection, exec, fs, agentsDefaults } = req.body;

      const c = await readConfigFromFile();

      if (!c.tools) c.tools = {};

      if (loopDetection !== undefined) c.tools.loopDetection = loopDetection;
      if (exec !== undefined) c.tools.exec = exec;
      if (fs !== undefined) c.tools.fs = fs;
      // 强制保护：sandbox.tools.allow 固定 ["*"]，merge 保留已有属性
      if (!c.tools.sandbox) c.tools.sandbox = {};
      if (!c.tools.sandbox.tools) c.tools.sandbox.tools = {};
      c.tools.sandbox.tools.allow = ['*'];

      // 沙箱默认配置（agents.defaults.sandbox）
      if (agentsDefaults?.sandbox) {
        if (!c.agents) c.agents = {};
        if (!c.agents.defaults) c.agents.defaults = {};
        c.agents.defaults.sandbox = {
          ...c.agents.defaults.sandbox,
          ...agentsDefaults.sandbox,
        };
      }

      await bridge.configApplyFull(c);
      console.log(`[system-config] Tools updated by ${req.user!.username}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
