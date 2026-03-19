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
import { createAuthMiddleware, adminOnly, type AuthenticatedRequest } from '../middleware/auth';
import type { EngineAdapter } from '../services/EngineAdapter';

const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * 直接读取 octopus.json 文件（绕过引擎 config.get 的 apiKey 脱敏）
 */
function getConfigPath(): string {
  const stateDir = process.env.OCTOPUS_STATE_DIR || path.join(projectRoot, '.octopus-state');
  return path.join(stateDir, 'octopus.json');
}

async function readConfigFromFile(): Promise<Record<string, any>> {
  const raw = await fsPromises.readFile(getConfigPath(), 'utf-8');
  return JSON.parse(raw);
}

/** 直接写入 octopus.json */
async function writeConfigToFile(config: Record<string, any>): Promise<void> {
  await fsPromises.writeFile(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

/** 企业运行时配置独立文件（不能放 octopus.json，引擎会校验失败） */
function getEnterprisePath(): string {
  const stateDir = process.env.OCTOPUS_STATE_DIR || path.join(projectRoot, '.octopus-state');
  return path.join(stateDir, 'enterprise.json');
}

async function readEnterpriseConfig(): Promise<Record<string, any>> {
  try {
    const raw = await fsPromises.readFile(getEnterprisePath(), 'utf-8');
    return JSON.parse(raw);
  } catch { return {}; }
}

async function writeEnterpriseConfig(config: Record<string, any>): Promise<void> {
  await fsPromises.writeFile(getEnterprisePath(), JSON.stringify(config, null, 2), 'utf-8');
}

export function createSystemConfigRouter(
  authService: AuthService,
  bridge: EngineAdapter,
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService);

  /**
   * GET /api/admin/config
   * 直接读取 octopus.json 文件，返回含明文 apiKey 的完整配置
   * （引擎 config.get RPC 会脱敏 apiKey 为 __OCTOPUS_REDACTED__，不适合管理页面）
   */
  router.get('/', authMiddleware, adminOnly, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const config = await readConfigFromFile();
      // 合并独立的 enterprise.json（前端从 config.enterprise 读取运行参数）
      config.enterprise = await readEnterpriseConfig();
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
        // 保留已有 config，只覆盖前端发送的字段（防止丢失未在 UI 中展示的配置）
        if (!c.plugins.entries) c.plugins.entries = {};
        for (const [name, val] of Object.entries(entries)) {
          c.plugins.entries[name] = {
            ...c.plugins.entries[name],
            ...(val as Record<string, any>),
            config: {
              ...(c.plugins.entries[name]?.config || {}),
              ...((val as any)?.config || {}),
            },
          };
        }
      }

      // 插件变更需要重启才能生效，直接写文件即可（不依赖引擎 RPC）
      await writeConfigToFile(c);
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

  /**
   * PUT /api/admin/config/runtime
   * Body: Partial<RuntimeConfig> — 按类别更新企业运行时配置
   */
  router.put('/runtime', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const runtimeUpdate = req.body;
      if (!runtimeUpdate || typeof runtimeUpdate !== 'object') {
        res.status(400).json({ error: 'runtime config object is required' });
        return;
      }

      const enterprise = await readEnterpriseConfig();

      // 按类别 shallow merge
      for (const key of Object.keys(runtimeUpdate)) {
        if (typeof runtimeUpdate[key] === 'object' && runtimeUpdate[key] !== null) {
          enterprise[key] = { ...enterprise[key], ...runtimeUpdate[key] };
        }
      }

      await writeEnterpriseConfig(enterprise);

      // 热更新内存中的运行时配置
      const { initRuntimeConfig: init } = await import('../config');
      init(enterprise);

      console.log(`[system-config] Runtime config updated by ${req.user!.username}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
