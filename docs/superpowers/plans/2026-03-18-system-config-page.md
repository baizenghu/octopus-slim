# SystemConfigPage 系统配置管理页面 — 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员通过 Web UI 管理 octopus.json 核心配置（模型、插件、工具安全），替代手动编辑文件

**Architecture:** 后端新增 `system-config.ts` 路由（admin only），通过 `EngineAdapter.configGetParsed()` 读取配置、`configApplyFull()` 写回（read-modify-write + 乐观锁重试）。前端新增 `SystemConfigPage.tsx` 容器页面 + 3 个 Tab 子组件，注册到 SettingsPage 管理员菜单。

**Tech Stack:** Express Router, EngineAdapter RPC, React, shadcn/ui (Tabs/Card/Table/Dialog/Switch/Select/Input), sonner toast

---

## File Structure

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| Create | `apps/server/src/routes/system-config.ts` | 后端 API：GET 读配置、PUT 写模型/插件/工具配置 |
| Create | `apps/console/src/pages/SystemConfigPage.tsx` | 前端容器：3 个 Tab + 加载/保存状态管理 |
| Create | `apps/console/src/pages/SystemConfigModels.tsx` | Tab 1：Provider CRUD + 默认模型选择 |
| Create | `apps/console/src/pages/SystemConfigPlugins.tsx` | Tab 2：插件启用/禁用 + 参数编辑 |
| Create | `apps/console/src/pages/SystemConfigTools.tsx` | Tab 3：Loop detection + 沙箱配置 |
| Modify | `apps/console/src/api.ts` | 新增 4 个 API 方法 |
| Modify | `apps/console/src/pages/SettingsPage.tsx` | 新增管理员菜单入口 |
| Modify | `apps/server/src/index.ts:432` | 注册 system-config 路由 |

---

## Task 1: 后端 API 路由 — system-config.ts

**Files:**
- Create: `apps/server/src/routes/system-config.ts`
- Modify: `apps/server/src/index.ts:432`

- [ ] **Step 1: 创建 system-config.ts 路由文件**

```typescript
/**
 * 系统配置管理 API（Admin Only）
 *
 * GET  /api/admin/config          — 读取完整 octopus.json 配置
 * PUT  /api/admin/config/models   — 更新模型 Provider + 默认模型
 * PUT  /api/admin/config/plugins  — 更新插件启用/配置
 * PUT  /api/admin/config/tools    — 更新工具安全策略
 */

import { Router } from 'express';
import type { AuthService } from '@octopus/auth';
import { createAuthMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import type { EngineAdapter } from '../services/EngineAdapter';

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
   * 返回完整 octopus.json 配置（明文，含 apiKey）
   */
  router.get('/', authMiddleware, adminOnly, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const { config } = await bridge.configGetParsed();
      res.json({ config });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/admin/config/models
   * Body: { providers: Record<string, ProviderConfig>, defaults: { model: { primary, fallbacks } } }
   */
  router.put('/models', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { providers, defaults } = req.body;
      if (!providers || typeof providers !== 'object') {
        res.status(400).json({ error: 'providers is required' });
        return;
      }

      const { config } = await bridge.configGetParsed();
      const c = config as Record<string, any>;

      // 更新 models.providers
      if (!c.models) c.models = {};
      c.models.providers = providers;

      // 更新 agents.defaults.model
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
   * Body: { allow: string[], entries: Record<string, { enabled, config }> }
   */
  router.put('/plugins', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { allow, entries } = req.body;

      const { config } = await bridge.configGetParsed();
      const c = config as Record<string, any>;

      if (!c.plugins) c.plugins = {};

      if (Array.isArray(allow)) {
        c.plugins.allow = allow;
      }
      if (entries && typeof entries === 'object') {
        c.plugins.entries = entries;
      }
      // 保护 load/slots 不被覆盖（前端不传这些字段）

      await bridge.configApplyFull(c);
      console.log(`[system-config] Plugins updated by ${req.user!.username}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  /**
   * PUT /api/admin/config/tools
   * Body: { loopDetection, exec, fs }
   */
  router.put('/tools', authMiddleware, adminOnly, async (req: AuthenticatedRequest, res, next) => {
    try {
      const { loopDetection, exec, fs } = req.body;

      const { config } = await bridge.configGetParsed();
      const c = config as Record<string, any>;

      if (!c.tools) c.tools = {};

      if (loopDetection) c.tools.loopDetection = loopDetection;
      if (exec) c.tools.exec = exec;
      if (fs) c.tools.fs = fs;
      // 强制保护：sandbox.tools.allow 固定 ["*"]
      c.tools.sandbox = { tools: { allow: ['*'] } };

      await bridge.configApplyFull(c);
      console.log(`[system-config] Tools updated by ${req.user!.username}`);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
```

- [ ] **Step 2: 在 index.ts 注册路由**

在 `apps/server/src/index.ts` 中，在其他 `app.use('/api/...')` 行附近添加：

```typescript
// 顶部 import
import { createSystemConfigRouter } from './routes/system-config';

// 路由注册（在 app.use('/api/admin', ...) 行之后）
if (bridge) {
  app.use('/api/admin/config', createSystemConfigRouter(authService, bridge));
}
```

- [ ] **Step 3: TypeScript 编译验证**

Run: `cd apps/server && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 手动测试 API**

```bash
# 获取配置
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:18790/api/admin/config | jq '.config.models.providers | keys'
# Expected: ["deepseek", "openai-codex"]
```

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/routes/system-config.ts apps/server/src/index.ts
git commit -m "feat: add system-config admin API route"
```

---

## Task 2: 前端 API 方法 + 菜单入口

**Files:**
- Modify: `apps/console/src/api.ts`
- Modify: `apps/console/src/pages/SettingsPage.tsx`

- [ ] **Step 1: 在 api.ts 末尾（`export const adminApi` 之前）添加 API 方法**

在 `AdminApi` class 内添加：

```typescript
  // ─── System Config (Admin) ───

  async getSystemConfig() {
    return this.request<{ config: Record<string, any> }>('/admin/config');
  }

  async updateModelsConfig(data: { providers: Record<string, any>; defaults: { model: { primary: string; fallbacks: string[] } } }) {
    return this.request<{ ok: boolean }>('/admin/config/models', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updatePluginsConfig(data: { allow: string[]; entries: Record<string, any> }) {
    return this.request<{ ok: boolean }>('/admin/config/plugins', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateToolsConfig(data: { loopDetection: any; exec: any; fs: any }) {
    return this.request<{ ok: boolean }>('/admin/config/tools', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }
```

- [ ] **Step 2: 在 SettingsPage.tsx 注册菜单和组件**

```typescript
// 顶部 import 新增
import { Sliders } from 'lucide-react';
import SystemConfigPage from './SystemConfigPage';

// adminMenuItems 数组新增一项（放在 '系统信息' 之后）
{ key: 'system-config', icon: Sliders, label: '系统配置' },

// sectionComponents 对象新增
'system-config': SystemConfigPage,
```

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/api.ts apps/console/src/pages/SettingsPage.tsx
git commit -m "feat: add system-config API methods and menu entry"
```

---

## Task 3: 前端容器 — SystemConfigPage.tsx

**Files:**
- Create: `apps/console/src/pages/SystemConfigPage.tsx`

- [ ] **Step 1: 创建容器组件**

```tsx
/**
 * 系统配置管理页面（Admin Only）
 * 3 个 Tab：模型管理 / 插件配置 / 安全与工具
 */
import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { adminApi } from '../api';
import SystemConfigModels from './SystemConfigModels';
import SystemConfigPlugins from './SystemConfigPlugins';
import SystemConfigTools from './SystemConfigTools';

export default function SystemConfigPage() {
  const [config, setConfig] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const { config: c } = await adminApi.getSystemConfig();
      setConfig(c);
    } catch (err: any) {
      toast.error('加载配置失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  if (loading || !config) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">系统配置</h2>
        <Card><CardContent className="pt-6 space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">系统配置</h2>
      <Tabs defaultValue="models">
        <TabsList>
          <TabsTrigger value="models">模型管理</TabsTrigger>
          <TabsTrigger value="plugins">插件配置</TabsTrigger>
          <TabsTrigger value="tools">安全与工具</TabsTrigger>
        </TabsList>
        <TabsContent value="models">
          <SystemConfigModels config={config} onSaved={loadConfig} />
        </TabsContent>
        <TabsContent value="plugins">
          <SystemConfigPlugins config={config} onSaved={loadConfig} />
        </TabsContent>
        <TabsContent value="tools">
          <SystemConfigTools config={config} onSaved={loadConfig} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/pages/SystemConfigPage.tsx
git commit -m "feat: add SystemConfigPage container with 3 tabs"
```

---

## Task 4: Tab 1 — 模型管理 (SystemConfigModels.tsx)

**Files:**
- Create: `apps/console/src/pages/SystemConfigModels.tsx`

- [ ] **Step 1: 创建模型管理组件**

```tsx
/**
 * 系统配置 Tab 1：模型管理
 * - Provider 表格：CRUD
 * - 默认模型选择（primary + fallbacks）
 */
import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../api';

interface Props {
  config: Record<string, any>;
  onSaved: () => void;
}

interface ModelEntry {
  id: string;
  name: string;
  [key: string]: unknown;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  api: string;
  models: ModelEntry[];
  compat?: Record<string, unknown>;
}

export default function SystemConfigModels({ config, onSaved }: Props) {
  const providers = (config.models?.providers || {}) as Record<string, ProviderConfig>;
  const defaultModel = config.agents?.defaults?.model || { primary: '', fallbacks: [] };

  // Provider 编辑状态
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null); // null = 新增
  const [formProviderId, setFormProviderId] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formApi, setFormApi] = useState('openai-completions');
  const [formModels, setFormModels] = useState<ModelEntry[]>([]);

  // 默认模型
  const [primary, setPrimary] = useState(defaultModel.primary || '');
  const [fallbacks, setFallbacks] = useState<string[]>(defaultModel.fallbacks || []);

  // 展开行（显示模型列表）
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // 所有可用模型的 flat list（provider/modelId 格式）
  const allModels = useMemo(() => {
    const result: { value: string; label: string }[] = [];
    for (const [pid, p] of Object.entries(providers)) {
      for (const m of (p.models || [])) {
        result.push({ value: `${pid}/${m.id}`, label: `${pid}/${m.name || m.id}` });
      }
    }
    return result;
  }, [providers]);

  const openCreate = () => {
    setEditId(null);
    setFormProviderId('');
    setFormBaseUrl('');
    setFormApiKey('');
    setFormApi('openai-completions');
    setFormModels([{ id: '', name: '' }]);
    setEditOpen(true);
  };

  const openEdit = (id: string) => {
    const p = providers[id];
    if (!p) return;
    setEditId(id);
    setFormProviderId(id);
    setFormBaseUrl(p.baseUrl || '');
    setFormApiKey(p.apiKey || '');
    setFormApi(p.api || 'openai-completions');
    setFormModels(p.models?.length ? [...p.models] : [{ id: '', name: '' }]);
    setEditOpen(true);
  };

  const handleSaveProvider = async () => {
    if (!formProviderId.trim()) {
      toast.error('Provider ID 不能为空');
      return;
    }
    if (!formBaseUrl.trim()) {
      toast.error('Base URL 不能为空');
      return;
    }
    // 过滤空模型
    const models = formModels.filter(m => m.id.trim());
    if (models.length === 0) {
      toast.error('至少需要一个模型');
      return;
    }

    setSaving(true);
    try {
      const newProviders = { ...providers };

      // 若修改了 Provider ID，删除旧 key
      if (editId && editId !== formProviderId) {
        delete newProviders[editId];
      }

      newProviders[formProviderId] = {
        baseUrl: formBaseUrl.trim(),
        apiKey: formApiKey.trim() || undefined,
        api: formApi,
        models,
        // 保留已有 compat
        ...(editId && providers[editId]?.compat ? { compat: providers[editId].compat } : {}),
      };

      await adminApi.updateModelsConfig({
        providers: newProviders,
        defaults: { model: { primary, fallbacks } },
      });
      toast.success('模型配置已保存');
      setEditOpen(false);
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!confirm(`确定删除 Provider "${id}"？`)) return;
    setSaving(true);
    try {
      const newProviders = { ...providers };
      delete newProviders[id];
      await adminApi.updateModelsConfig({
        providers: newProviders,
        defaults: { model: { primary, fallbacks } },
      });
      toast.success(`Provider "${id}" 已删除`);
      onSaved();
    } catch (err: any) {
      toast.error('删除失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDefaults = async () => {
    if (!primary) {
      toast.error('请选择主模型');
      return;
    }
    setSaving(true);
    try {
      await adminApi.updateModelsConfig({
        providers,
        defaults: { model: { primary, fallbacks: fallbacks.filter(Boolean) } },
      });
      toast.success('默认模型已保存');
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const addModelRow = () => setFormModels([...formModels, { id: '', name: '' }]);
  const removeModelRow = (idx: number) => setFormModels(formModels.filter((_, i) => i !== idx));
  const updateModelRow = (idx: number, field: 'id' | 'name', value: string) => {
    const updated = [...formModels];
    updated[idx] = { ...updated[idx], [field]: value };
    setFormModels(updated);
  };

  return (
    <div className="space-y-6 mt-4">
      {/* Provider 列表 */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">模型 Provider</CardTitle>
            <Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" />添加 Provider</Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Provider ID</TableHead>
                <TableHead>API 类型</TableHead>
                <TableHead>Base URL</TableHead>
                <TableHead>API Key</TableHead>
                <TableHead>模型数</TableHead>
                <TableHead className="w-24">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(providers).map(([id, p]) => (
                <>
                  <TableRow key={id} className="cursor-pointer" onClick={() => setExpandedProvider(expandedProvider === id ? null : id)}>
                    <TableCell>
                      {expandedProvider === id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell className="font-medium">{id}</TableCell>
                    <TableCell><Badge variant="outline">{p.api}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{p.baseUrl}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate">{p.apiKey || '-'}</TableCell>
                    <TableCell>{p.models?.length || 0}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEdit(id); }}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleDeleteProvider(id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                  {expandedProvider === id && (
                    <TableRow key={`${id}-models`}>
                      <TableCell colSpan={7} className="bg-muted/30 p-4">
                        <div className="text-sm font-medium mb-2">模型列表</div>
                        <div className="space-y-1">
                          {p.models?.map((m) => (
                            <div key={m.id} className="flex gap-4 text-sm">
                              <span className="font-mono">{m.id}</span>
                              <span className="text-muted-foreground">{m.name}</span>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))}
              {Object.keys(providers).length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无 Provider</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 默认模型 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">全局默认模型</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">主模型 (Primary)</label>
              <Select value={primary} onValueChange={setPrimary}>
                <SelectTrigger><SelectValue placeholder="选择主模型" /></SelectTrigger>
                <SelectContent>
                  {allModels.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">备用模型 (Fallbacks)</label>
              <Select value={fallbacks[0] || ''} onValueChange={(v) => setFallbacks(v ? [v] : [])}>
                <SelectTrigger><SelectValue placeholder="选择备用模型（可选）" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">无</SelectItem>
                  {allModels.filter(m => m.value !== primary).map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSaveDefaults} disabled={saving}>保存默认模型</Button>
          </div>
        </CardContent>
      </Card>

      {/* Provider 编辑 Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editId ? `编辑 Provider: ${editId}` : '添加 Provider'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">Provider ID</label>
              <Input value={formProviderId} onChange={(e) => setFormProviderId(e.target.value)} placeholder="如 deepseek, openai-codex" disabled={!!editId} />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">API 类型</label>
              <Select value={formApi} onValueChange={setFormApi}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-completions">openai-completions</SelectItem>
                  <SelectItem value="openai-codex-responses">openai-codex-responses</SelectItem>
                  <SelectItem value="anthropic">anthropic</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Base URL</label>
              <Input value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">API Key</label>
              <Input value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder="sk-..." />
            </div>
            <Separator />
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium">模型列表</label>
                <Button variant="outline" size="sm" onClick={addModelRow}><Plus className="h-3 w-3 mr-1" />添加模型</Button>
              </div>
              <div className="space-y-2">
                {formModels.map((m, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input className="flex-1" value={m.id} onChange={(e) => updateModelRow(idx, 'id', e.target.value)} placeholder="模型 ID (如 deepseek-chat)" />
                    <Input className="flex-1" value={m.name} onChange={(e) => updateModelRow(idx, 'name', e.target.value)} placeholder="显示名称" />
                    {formModels.length > 1 && (
                      <Button variant="ghost" size="icon" onClick={() => removeModelRow(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>取消</Button>
            <Button onClick={handleSaveProvider} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/pages/SystemConfigModels.tsx
git commit -m "feat: add SystemConfigModels tab - provider CRUD + default model"
```

---

## Task 5: Tab 2 — 插件配置 (SystemConfigPlugins.tsx)

**Files:**
- Create: `apps/console/src/pages/SystemConfigPlugins.tsx`

- [ ] **Step 1: 创建插件配置组件**

每个插件一张 Card，顶部 Switch 控制 enabled，展开显示具体参数表单。

```tsx
/**
 * 系统配置 Tab 2：插件配置
 * 3 张 Card：memory-lancedb-pro / enterprise-audit / enterprise-mcp
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { adminApi } from '../api';

interface Props {
  config: Record<string, any>;
  onSaved: () => void;
}

// 辅助组件：标签+输入
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium mb-1 block">{label}</label>
      {children}
    </div>
  );
}

export default function SystemConfigPlugins({ config, onSaved }: Props) {
  const plugins = config.plugins || {};
  const allow: string[] = plugins.allow || [];
  const entries: Record<string, any> = plugins.entries || {};

  // 深拷贝 entries 用于编辑
  const [editEntries, setEditEntries] = useState<Record<string, any>>(() => JSON.parse(JSON.stringify(entries)));
  const [editAllow, setEditAllow] = useState<string[]>([...allow]);
  const [saving, setSaving] = useState(false);

  const toggleAllow = (name: string, enabled: boolean) => {
    if (enabled && !editAllow.includes(name)) {
      setEditAllow([...editAllow, name]);
    } else if (!enabled) {
      setEditAllow(editAllow.filter(a => a !== name));
    }
    // 同步 entries enabled
    setEditEntries({
      ...editEntries,
      [name]: { ...editEntries[name], enabled },
    });
  };

  const updateEntry = (pluginName: string, path: string, value: any) => {
    const updated = JSON.parse(JSON.stringify(editEntries));
    const parts = path.split('.');
    let obj = updated[pluginName].config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    setEditEntries(updated);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminApi.updatePluginsConfig({
        allow: editAllow,
        entries: editEntries,
      });
      toast.success('插件配置已保存');
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const getEntry = (name: string) => editEntries[name] || { enabled: false, config: {} };
  const getConfig = (name: string) => getEntry(name).config || {};

  return (
    <div className="space-y-6 mt-4">
      {/* memory-lancedb-pro */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">memory-lancedb-pro</CardTitle>
              <Badge variant="outline">记忆引擎</Badge>
            </div>
            <Switch
              checked={getEntry('memory-lancedb-pro').enabled}
              onCheckedChange={(v) => toggleAllow('memory-lancedb-pro', v)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Embedding 配置 */}
          <div className="text-sm font-medium text-muted-foreground">Embedding 嵌入服务</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="API Key">
              <Input value={getConfig('memory-lancedb-pro').embedding?.apiKey || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.apiKey', e.target.value)} />
            </Field>
            <Field label="模型">
              <Input value={getConfig('memory-lancedb-pro').embedding?.model || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.model', e.target.value)} />
            </Field>
            <Field label="Base URL">
              <Input value={getConfig('memory-lancedb-pro').embedding?.baseURL || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.baseURL', e.target.value)} />
            </Field>
            <Field label="向量维度">
              <Input type="number" value={getConfig('memory-lancedb-pro').embedding?.dimensions || 1024} onChange={(e) => updateEntry('memory-lancedb-pro', 'embedding.dimensions', parseInt(e.target.value) || 1024)} />
            </Field>
          </div>

          <Separator />

          {/* LLM 配置（智能提取） */}
          <div className="text-sm font-medium text-muted-foreground">LLM 智能提取</div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="API Key">
              <Input value={getConfig('memory-lancedb-pro').llm?.apiKey || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'llm.apiKey', e.target.value)} />
            </Field>
            <Field label="模型">
              <Input value={getConfig('memory-lancedb-pro').llm?.model || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'llm.model', e.target.value)} />
            </Field>
            <Field label="Base URL">
              <Input value={getConfig('memory-lancedb-pro').llm?.baseURL || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'llm.baseURL', e.target.value)} />
            </Field>
          </div>

          <Separator />

          {/* 检索配置 */}
          <div className="text-sm font-medium text-muted-foreground">检索策略</div>
          <div className="grid grid-cols-3 gap-4">
            <Field label="检索模式">
              <Select value={getConfig('memory-lancedb-pro').retrieval?.mode || 'hybrid'} onValueChange={(v) => updateEntry('memory-lancedb-pro', 'retrieval.mode', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hybrid">混合检索 (hybrid)</SelectItem>
                  <SelectItem value="vector">向量检索 (vector)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="重排策略">
              <Select value={getConfig('memory-lancedb-pro').retrieval?.rerank || 'cross-encoder'} onValueChange={(v) => updateEntry('memory-lancedb-pro', 'retrieval.rerank', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cross-encoder">cross-encoder</SelectItem>
                  <SelectItem value="lightweight">lightweight</SelectItem>
                  <SelectItem value="none">none</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="重排服务商">
              <Input value={getConfig('memory-lancedb-pro').retrieval?.rerankProvider || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.rerankProvider', e.target.value)} />
            </Field>
          </div>

          <Separator />

          {/* 自动化开关 */}
          <div className="text-sm font-medium text-muted-foreground">自动化</div>
          <div className="flex gap-8">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={getConfig('memory-lancedb-pro').autoCapture !== false}
                onCheckedChange={(v) => updateEntry('memory-lancedb-pro', 'autoCapture', v)}
              />
              自动捕获记忆
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={getConfig('memory-lancedb-pro').autoRecall !== false}
                onCheckedChange={(v) => updateEntry('memory-lancedb-pro', 'autoRecall', v)}
              />
              自动回忆
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={getConfig('memory-lancedb-pro').smartExtraction !== false}
                onCheckedChange={(v) => updateEntry('memory-lancedb-pro', 'smartExtraction', v)}
              />
              智能提取
            </label>
          </div>

          {/* 高级参数折叠 */}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                <ChevronDown className="h-4 w-4" />高级参数
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <Field label="向量权重">
                  <Input type="number" step="0.1" min="0" max="1" value={getConfig('memory-lancedb-pro').retrieval?.vectorWeight ?? 0.7} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.vectorWeight', parseFloat(e.target.value))} />
                </Field>
                <Field label="BM25 权重">
                  <Input type="number" step="0.1" min="0" max="1" value={getConfig('memory-lancedb-pro').retrieval?.bm25Weight ?? 0.3} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.bm25Weight', parseFloat(e.target.value))} />
                </Field>
                <Field label="最低分数阈值">
                  <Input type="number" step="0.05" min="0" max="1" value={getConfig('memory-lancedb-pro').retrieval?.hardMinScore ?? 0.3} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.hardMinScore', parseFloat(e.target.value))} />
                </Field>
                <Field label="候选池大小">
                  <Input type="number" min="10" max="100" value={getConfig('memory-lancedb-pro').retrieval?.candidatePoolSize ?? 20} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.candidatePoolSize', parseInt(e.target.value))} />
                </Field>
                <Field label="时间衰减半衰期 (天)">
                  <Input type="number" min="1" max="365" value={getConfig('memory-lancedb-pro').retrieval?.recencyHalfLifeDays ?? 14} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.recencyHalfLifeDays', parseInt(e.target.value))} />
                </Field>
                <Field label="时间衰减权重">
                  <Input type="number" step="0.05" min="0" max="0.5" value={getConfig('memory-lancedb-pro').retrieval?.recencyWeight ?? 0.1} onChange={(e) => updateEntry('memory-lancedb-pro', 'retrieval.recencyWeight', parseFloat(e.target.value))} />
                </Field>
                <Field label="回忆 TopK">
                  <Input type="number" min="1" max="20" value={getConfig('memory-lancedb-pro').autoRecallTopK ?? 3} onChange={(e) => updateEntry('memory-lancedb-pro', 'autoRecallTopK', parseInt(e.target.value))} />
                </Field>
                <Field label="DB 路径">
                  <Input value={getConfig('memory-lancedb-pro').dbPath || ''} onChange={(e) => updateEntry('memory-lancedb-pro', 'dbPath', e.target.value)} />
                </Field>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* enterprise-audit */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">enterprise-audit</CardTitle>
              <Badge variant="outline">审计日志</Badge>
            </div>
            <Switch
              checked={getEntry('enterprise-audit').enabled}
              onCheckedChange={(v) => toggleAllow('enterprise-audit', v)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <Field label="数据库连接">
              <Input value={getConfig('enterprise-audit').databaseUrl || ''} onChange={(e) => updateEntry('enterprise-audit', 'databaseUrl', e.target.value)} />
            </Field>
            <Field label="日志目录">
              <Input value={getConfig('enterprise-audit').logDir || ''} onChange={(e) => updateEntry('enterprise-audit', 'logDir', e.target.value)} />
            </Field>
            <Field label="保留天数">
              <Input type="number" min="1" max="365" value={getConfig('enterprise-audit').retentionDays || 30} onChange={(e) => updateEntry('enterprise-audit', 'retentionDays', parseInt(e.target.value))} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* enterprise-mcp */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg">enterprise-mcp</CardTitle>
              <Badge variant="outline">工具协议</Badge>
            </div>
            <Switch
              checked={getEntry('enterprise-mcp').enabled}
              onCheckedChange={(v) => toggleAllow('enterprise-mcp', v)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <Field label="数据库连接">
              <Input value={getConfig('enterprise-mcp').databaseUrl || ''} onChange={(e) => updateEntry('enterprise-mcp', 'databaseUrl', e.target.value)} />
            </Field>
            <Field label="数据目录">
              <Input value={getConfig('enterprise-mcp').dataRoot || ''} onChange={(e) => updateEntry('enterprise-mcp', 'dataRoot', e.target.value)} />
            </Field>
          </div>
          <div className="text-sm font-medium text-muted-foreground mt-4 mb-2">沙箱资源限制</div>
          <div className="grid grid-cols-4 gap-4">
            <Field label="MCP 内存">
              <Input value={getConfig('enterprise-mcp').sandbox?.mcp?.memory || '256m'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.mcp.memory', e.target.value)} />
            </Field>
            <Field label="MCP CPU">
              <Input value={getConfig('enterprise-mcp').sandbox?.mcp?.cpus || '0.5'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.mcp.cpus', e.target.value)} />
            </Field>
            <Field label="Skill 内存">
              <Input value={getConfig('enterprise-mcp').sandbox?.skill?.memory || '512m'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.skill.memory', e.target.value)} />
            </Field>
            <Field label="Skill CPU">
              <Input value={getConfig('enterprise-mcp').sandbox?.skill?.cpus || '1'} onChange={(e) => updateEntry('enterprise-mcp', 'sandbox.skill.cpus', e.target.value)} />
            </Field>
          </div>
        </CardContent>
      </Card>

      {/* 保存按钮 */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存插件配置'}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/pages/SystemConfigPlugins.tsx
git commit -m "feat: add SystemConfigPlugins tab - 3 plugin cards with config editing"
```

---

## Task 6: Tab 3 — 安全与工具 (SystemConfigTools.tsx)

**Files:**
- Create: `apps/console/src/pages/SystemConfigTools.tsx`

- [ ] **Step 1: 创建安全与工具组件**

```tsx
/**
 * 系统配置 Tab 3：安全与工具
 * - Loop Detection 阈值
 * - 沙箱配置
 * - 文件系统隔离
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { adminApi } from '../api';

interface Props {
  config: Record<string, any>;
  onSaved: () => void;
}

export default function SystemConfigTools({ config, onSaved }: Props) {
  const tools = config.tools || {};
  const agentDefaults = config.agents?.defaults || {};

  // Loop Detection
  const [loopEnabled, setLoopEnabled] = useState(tools.loopDetection?.enabled !== false);
  const [warningThreshold, setWarningThreshold] = useState(tools.loopDetection?.warningThreshold || 8);
  const [criticalThreshold, setCriticalThreshold] = useState(tools.loopDetection?.criticalThreshold || 15);
  const [globalBreaker, setGlobalBreaker] = useState(tools.loopDetection?.globalCircuitBreakerThreshold || 25);

  // Exec
  const [execHost, setExecHost] = useState(tools.exec?.host || 'sandbox');

  // FS
  const [workspaceOnly, setWorkspaceOnly] = useState(tools.fs?.workspaceOnly !== false);

  // Sandbox defaults
  const [sandboxMode, setSandboxMode] = useState(agentDefaults.sandbox?.mode || 'all');
  const [dockerImage, setDockerImage] = useState(agentDefaults.sandbox?.docker?.image || 'octopus-sandbox:enterprise');

  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    // 验证阈值递增
    if (warningThreshold >= criticalThreshold || criticalThreshold >= globalBreaker) {
      toast.error('阈值必须递增：警告 < 临界 < 熔断');
      return;
    }

    setSaving(true);
    try {
      await adminApi.updateToolsConfig({
        loopDetection: {
          enabled: loopEnabled,
          warningThreshold,
          criticalThreshold,
          globalCircuitBreakerThreshold: globalBreaker,
        },
        exec: { host: execHost },
        fs: { workspaceOnly },
      });

      // 沙箱默认值需要单独更新到 agents.defaults
      // 暂通过 models API 附带（因为 defaults 在同一级别）
      // TODO: 如果需要独立保存，后端增加 PUT /api/admin/config/agents-defaults

      toast.success('工具配置已保存');
      onSaved();
    } catch (err: any) {
      toast.error('保存失败: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 mt-4">
      {/* Loop Detection */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">死循环检测</CardTitle>
              <CardDescription>检测 Agent 工具调用陷入循环的保护机制</CardDescription>
            </div>
            <Switch checked={loopEnabled} onCheckedChange={setLoopEnabled} />
          </div>
        </CardHeader>
        {loopEnabled && (
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">警告阈值</label>
                <Input type="number" min="1" value={warningThreshold} onChange={(e) => setWarningThreshold(parseInt(e.target.value) || 8)} />
                <p className="text-xs text-muted-foreground mt-1">连续失败 N 次后警告</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">临界阈值</label>
                <Input type="number" min="1" value={criticalThreshold} onChange={(e) => setCriticalThreshold(parseInt(e.target.value) || 15)} />
                <p className="text-xs text-muted-foreground mt-1">连续失败 N 次后阻断</p>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">熔断阈值</label>
                <Input type="number" min="1" value={globalBreaker} onChange={(e) => setGlobalBreaker(parseInt(e.target.value) || 25)} />
                <p className="text-xs text-muted-foreground mt-1">连续失败 N 次后终止会话</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 执行隔离 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">执行隔离</CardTitle>
          <CardDescription>Agent 命令执行的隔离策略</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">执行宿主</label>
              <Select value={execHost} onValueChange={setExecHost}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Docker 沙箱 (sandbox)</SelectItem>
                  <SelectItem value="gateway">直接执行 (gateway)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">文件系统隔离</label>
              <div className="flex items-center gap-2 h-10">
                <Switch checked={workspaceOnly} onCheckedChange={setWorkspaceOnly} />
                <span className="text-sm">{workspaceOnly ? '仅工作空间' : '全文件系统'}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 沙箱默认配置 */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">沙箱默认配置</CardTitle>
          <CardDescription>所有 Agent 的默认沙箱参数（可被单个 Agent 覆盖）</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">沙箱模式</label>
              <Select value={sandboxMode} onValueChange={setSandboxMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部沙箱 (all)</SelectItem>
                  <SelectItem value="none">不使用沙箱 (none)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Docker 镜像</label>
              <Input value={dockerImage} onChange={(e) => setDockerImage(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            注：sandbox.tools.allow 固定为 ["*"]（不可更改），确保插件工具正常注册
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存工具配置'}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/pages/SystemConfigTools.tsx
git commit -m "feat: add SystemConfigTools tab - loop detection + sandbox config"
```

---

## Task 7: 集成验证

- [ ] **Step 1: TypeScript 编译验证（前端+后端）**

```bash
cd /home/baizh/octopus/apps/server && npx tsc --noEmit
cd /home/baizh/octopus/apps/console && npx tsc --noEmit
```

Expected: 无错误。若有类型错误，逐个修复。

常见可能的类型问题：
- `EngineAdapter` 上缺少 `configGetParsed` 方法类型 → 检查实际方法签名
- `CardDescription` 未导出 → 从 `@/components/ui/card` 检查是否存在，不存在则删除
- `Collapsible` 组件未安装 → 运行 `npx shadcn@latest add collapsible`

- [ ] **Step 2: 重启服务**

```bash
cd /home/baizh/octopus && ./start.sh stop && ./start.sh start
```

- [ ] **Step 3: 手动测试**

1. 浏览器访问 `http://localhost:18792`，以 admin 登录
2. 进入 设置 → 系统配置
3. **Tab 1 模型管理**：
   - 确认显示 deepseek 和 openai-codex 两个 Provider
   - 展开 Provider 查看模型列表
   - 尝试编辑 Provider（修改 API Key）→ 保存 → 刷新页面确认持久化
   - 修改默认模型 → 保存 → 确认生效
4. **Tab 2 插件配置**：
   - 确认 3 张 Card 显示正确的配置值
   - 修改 enterprise-audit 的 retentionDays → 保存 → 验证
   - 修改 memory-lancedb-pro 的 autoCapture 开关 → 保存 → 验证
5. **Tab 3 安全与工具**：
   - 确认 Loop Detection 阈值显示正确
   - 修改阈值 → 保存 → 验证
   - 验证阈值递增校验（设置不合法值应报错）

- [ ] **Step 4: 最终 Commit**

```bash
# 如果有修复，一并提交
git add -A
git commit -m "feat: SystemConfigPage complete - models/plugins/tools admin UI"
```

---

## 注意事项

1. **configApplyFull 行为**：每次 PUT 都会触发引擎 read-modify-write，`plugins.entries` 变更可能导致引擎重启
2. **Stash 处理**：stash 中的 api.ts/SettingsPage/index.ts 脚手架代码可参考但建议手动集成（stash 含其他无关改动）
3. **沙箱默认配置**：当前 `PUT /tools` 只更新 `tools.*`，不更新 `agents.defaults.sandbox`。如需完整支持，后端需额外合并到 `agents.defaults.sandbox` 字段
4. **shadcn/ui 组件**：如果 `Collapsible`、`CardDescription` 等组件未安装，需先运行 `npx shadcn@latest add <component>`
