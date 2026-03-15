# 模型配置统一收口 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将散落在 5 处的模型配置统一收口到 `octopus.json`，启用自动 Fallback，前端 agent 编辑增加模型下拉选择。

**Architecture:** 引擎已原生支持 `{primary, fallbacks}` 对象格式的模型配置和自动 Fallback 链。本次改造只需：(1) 修改 `octopus.json` 配置格式启用 fallback；(2) 清理后端散落的模型引用（`.env`、`config.ts`、`scheduler.ts`、`index.ts`）；(3) 前端 agent 编辑页增加模型下拉辅助选择。

**Tech Stack:** TypeScript, React, Express, Octopus Engine (octopus.json config)

**Spec:** `docs/superpowers/specs/2026-03-15-model-config-unification-design.md`

---

## Chunk 1: 后端配置统一

### Task 1: 修改 `octopus.json` — 启用 Fallback 链

**Files:**
- Modify: `.octopus-state/octopus.json:17-23`

- [ ] **Step 1: 读取当前 octopus.json 确认现状**

确认 `agents.defaults.model` 当前为字符串 `"openai-codex/gpt-5.2"`，无 `models.providers` 节。

- [ ] **Step 2: 修改配置**

将 `agents.defaults.model` 从字符串改为对象格式，新增 `models.providers.deepseek`：

```json
{
  "models": {
    "providers": {
      "deepseek": {
        "name": "deepseek",
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "<从当前 .env 的 OPENAI_API_KEY 值复制>",
        "models": ["deepseek-chat"]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "openai-codex/gpt-5.2",
        "fallbacks": ["deepseek/deepseek-chat"]
      }
    }
  }
}
```

注意：保留文件中其他所有配置不变（`list`、`plugins`、`commands` 等），只修改/新增上述两处。

- [ ] **Step 3: 验证引擎热加载**

重启系统后，发一条对话消息确认能正常响应。检查日志中模型标识是否正确。

---

### Task 2: 删除 `config.ts` 中 `ai` 配置块

**Files:**
- Modify: `apps/server/src/config.ts:34-39` (类型定义)
- Modify: `apps/server/src/config.ts:100-104` (实现)

- [ ] **Step 1: 删除 GatewayConfig 接口中的 ai 字段**

```typescript
// 删除以下 4 行（行 34-39）
  /** AI 模型配置 */
  ai: {
    apiBase: string;
    apiKey: string;
    model: string;
  };
```

- [ ] **Step 2: 删除 loadConfig() 中的 ai 配置**

```typescript
// 删除以下 5 行（行 100-104）
    ai: {
      apiBase: process.env.OPENAI_API_BASE || '',
      apiKey: process.env.OPENAI_API_KEY || '',
      model: process.env.OPENAI_MODEL || 'deepseek-chat',
    },
```

- [ ] **Step 3: 类型检查**

Run: `cd apps/server && npx tsc --noEmit`

预期：报 `config.ai` 引用错误（index.ts 两处），下一个 Task 修复。

---

### Task 3: 清理 `index.ts` 中的 `config.ai` 引用

**Files:**
- Modify: `apps/server/src/index.ts:355`
- Modify: `apps/server/src/index.ts:403`

- [ ] **Step 1: 修改 /health 端点**

行 355，将：
```typescript
model: config.ai.model,
```
改为：
```typescript
model: 'configured in octopus.json',
```

- [ ] **Step 2: 修改启动日志**

行 403，将：
```typescript
console.log(`   Model: ${config.ai.model} @ ${config.ai.apiBase}`);
```
改为：
```typescript
console.log(`   Model: configured in octopus.json (unified)`);
```

- [ ] **Step 3: 类型检查通过**

Run: `cd apps/server && npx tsc --noEmit`

预期：无 `config.ai` 相关错误。

---

### Task 4: 删除 `chat.ts` 中 `_config` 的 `GatewayConfig` 类型依赖

**Files:**
- Modify: `apps/server/src/routes/chat.ts:22,50`

- [ ] **Step 1: grep 确认 chat.ts 无 config.ai 引用**

Run: `grep -n 'config\.ai' apps/server/src/routes/chat.ts`

预期：无匹配。`_config` 仅用到 `_config.workspace.dataRoot`（行 186, 404），不使用 `_config.ai`。`GatewayConfig` 删除 `ai` 后类型自然更新，无需额外改动。

- [ ] **Step 2: 类型检查确认**

Run: `cd apps/server && npx tsc --noEmit`

预期：chat.ts 无报错（`_config.workspace.dataRoot` 仍存在于 `GatewayConfig` 中）。

---

### Task 5: `scheduler.ts` 心跳模型去硬编码

**Files:**
- Modify: `apps/server/src/routes/scheduler.ts:23,223,225,383,388`

- [ ] **Step 1: 删除 HEARTBEAT_MODEL 常量**

删除行 20-23：
```typescript
// ---- 心跳模型配置 ----

/** 心跳巡检使用的模型标识（native gateway heartbeat.model 字段） */
const HEARTBEAT_MODEL = 'custom-api-deepseek-com/deepseek-chat';
```

- [ ] **Step 2: 修改行 223 — 创建心跳（agent 已存在）**

将：
```typescript
targetAgent.heartbeat = { every, prompt: 'HEARTBEAT.md', model: HEARTBEAT_MODEL };
```
改为：
```typescript
targetAgent.heartbeat = { every, prompt: 'HEARTBEAT.md' };
```

- [ ] **Step 3: 修改行 225 — 创建心跳（agent 不存在）**

将：
```typescript
agentsList.push({ id: nativeAgentId, heartbeat: { every, prompt: 'HEARTBEAT.md', model: HEARTBEAT_MODEL } });
```
改为：
```typescript
agentsList.push({ id: nativeAgentId, heartbeat: { every, prompt: 'HEARTBEAT.md' } });
```

- [ ] **Step 4: 修改行 383 — 更新心跳（已有 agent）**

将：
```typescript
nextTargetAgent.heartbeat = { every: heartbeatEvery, prompt: 'HEARTBEAT.md', model: HEARTBEAT_MODEL };
```
改为：
```typescript
nextTargetAgent.heartbeat = { every: heartbeatEvery, prompt: 'HEARTBEAT.md' };
```

- [ ] **Step 5: 修改行 388 — 更新心跳（新建 agent）**

将：
```typescript
heartbeat: { every: heartbeatEvery, prompt: 'HEARTBEAT.md', model: HEARTBEAT_MODEL },
```
改为：
```typescript
heartbeat: { every: heartbeatEvery, prompt: 'HEARTBEAT.md' },
```

- [ ] **Step 6: 类型检查**

Run: `cd apps/server && npx tsc --noEmit`

预期：无错误。

---

### Task 6: 删除 `.env` 中模型相关变量

**Files:**
- Modify: `.env`

- [ ] **Step 1: 先记录当前 apiKey 值**

读取 `.env` 中 `OPENAI_API_KEY` 的值，确认已复制到 Task 1 中 `octopus.json` 的 `models.providers.deepseek.apiKey`。

- [ ] **Step 2: 删除三个变量**

从 `.env` 中删除：
```
OPENAI_API_BASE=https://api.deepseek.com
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=deepseek-chat
```

- [ ] **Step 3: 全文搜索确认无遗漏**

Run: `grep -r 'OPENAI_API_BASE\|OPENAI_API_KEY\|OPENAI_MODEL' apps/server/src/ --include='*.ts'`

预期：仅 `config.ts` 中有残留引用（已在 Task 2 中删除）；若已执行 Task 2，应无匹配。

---

### Task 7: 后端整体验证 + 提交

- [ ] **Step 1: 完整类型检查**

Run: `cd apps/server && npx tsc --noEmit`

预期：无错误。

- [ ] **Step 2: 单元测试**

Run: `npx vitest run`

预期：全部通过（FileCleanupService 等测试不涉及模型配置）。

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/config.ts apps/server/src/index.ts apps/server/src/routes/scheduler.ts .env .octopus-state/octopus.json
git commit -m "refactor: unify model config into octopus.json with fallback chain

- Change agents.defaults.model from string to {primary, fallbacks} object
- Register deepseek as provider in models.providers
- Remove config.ai block from GatewayConfig
- Remove HEARTBEAT_MODEL hardcoded constant from scheduler
- Remove OPENAI_API_BASE/KEY/MODEL from .env
- Heartbeat now follows global model fallback chain"
```

---

## Chunk 2: 前端模型下拉选择

### Task 8: `api.ts` 新增 getChatModels 方法

**Files:**
- Modify: `apps/console/src/api.ts`

- [ ] **Step 1: 新增方法**

在 `AdminApi` 类中添加：

```typescript
async getChatModels(): Promise<{ models: { id: string; provider?: string; name?: string }[] }> {
  return this.request('/chat/models');
}
```

---

### Task 9: `AgentsPage.tsx` 模型输入改造

**Files:**
- Modify: `apps/console/src/pages/AgentsPage.tsx`

- [ ] **Step 1: 新增 state 和 useEffect 获取模型列表**

在现有 state 区域（约行 114-120）附近添加：

```typescript
const [availableModels, setAvailableModels] = useState<{ id: string; provider?: string }[]>([]);
const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
```

在现有 useEffect（加载 agents 的）附近添加：

```typescript
useEffect(() => {
  adminApi.getChatModels()
    .then(data => setAvailableModels(data.models || []))
    .catch(() => setAvailableModels([]));
}, []);
```

- [ ] **Step 2: 替换模型输入 UI**

将行 530-539 的纯 Input：

```tsx
{/* 模型 */}
<div className="space-y-2">
  <Label htmlFor="agent-model">模型 (留空使用全局默认)</Label>
  <Input
    id="agent-model"
    placeholder="如: deepseek-chat, deepseek-coder"
    value={formModel}
    onChange={(e) => setFormModel(e.target.value)}
  />
</div>
```

替换为 Input + 下拉按钮：

```tsx
{/* 模型 */}
<div className="space-y-2">
  <Label htmlFor="agent-model">模型 (留空跟随全局默认)</Label>
  <div className="relative">
    <Input
      id="agent-model"
      placeholder="留空跟随全局默认"
      value={formModel}
      onChange={(e) => setFormModel(e.target.value)}
      className="pr-10"
    />
    <button
      type="button"
      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
    >
      <ChevronDown className="h-4 w-4" />
    </button>
    {modelDropdownOpen && (
      <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
        <div
          className="cursor-pointer px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
          onClick={() => { setFormModel(''); setModelDropdownOpen(false); }}
        >
          （留空）跟随全局默认
        </div>
        {availableModels.map((m) => (
          <div
            key={m.id}
            className="cursor-pointer px-3 py-2 text-sm hover:bg-accent"
            onClick={() => { setFormModel(m.id); setModelDropdownOpen(false); }}
          >
            {m.id}
          </div>
        ))}
      </div>
    )}
  </div>
</div>
```

- [ ] **Step 3: 确保 ChevronDown 图标已导入**

检查文件顶部 `import { ... } from 'lucide-react'`，确认包含 `ChevronDown`。若没有则添加。

- [ ] **Step 4: 点击外部关闭下拉**

在组件内添加点击外部关闭逻辑：

```typescript
useEffect(() => {
  if (!modelDropdownOpen) return;
  const handler = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest('[data-model-dropdown]')) {
      setModelDropdownOpen(false);
    }
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [modelDropdownOpen]);
```

并在下拉容器 `<div className="relative">` 上添加 `data-model-dropdown` 属性。

- [ ] **Step 5: 类型检查**

Run: `cd apps/console && npx tsc --noEmit`

预期：无错误。

---

### Task 10: 前端整体验证 + 提交

- [ ] **Step 1: 启动前端开发服务器**

Run: `pnpm --filter console dev`

手动验证：
1. 打开 Agent 创建/编辑对话框
2. 模型输入框右侧有下拉箭头
3. 点击箭头展示可用模型列表
4. 选择模型后填入输入框
5. 选择"跟随全局默认"后输入框清空
6. 仍可手动输入任意模型名

- [ ] **Step 2: 提交**

```bash
git add apps/console/src/api.ts apps/console/src/pages/AgentsPage.tsx
git commit -m "feat(console): add model dropdown selector for agent creation

- Fetch available models from GET /api/chat/models
- Show dropdown with available models + 'follow global default' option
- User can still manually type any model name"
```

---

## Chunk 3: 端到端验证

### Task 11: Fallback 链验证

- [ ] **Step 1: 重启系统**

Run: `./start.sh stop && ./start.sh start`

- [ ] **Step 2: 验证正常对话**

发送一条消息，确认使用主模型（openai-codex/gpt-5.2）正常响应。

- [ ] **Step 3: 验证健康检查**

Run: `curl http://localhost:18790/health`

预期：返回 `"model": "configured in octopus.json"`。

- [ ] **Step 4: 验证模型列表 API**

Run: `curl -H "Authorization: Bearer <token>" http://localhost:18790/api/chat/models`

预期：返回包含 `openai-codex` 和 `deepseek` 两个 provider 的模型列表。

- [ ] **Step 5: 验证心跳（如有心跳任务）**

检查已有心跳任务是否正常运行，日志中不再出现 `custom-api-deepseek-com` 字样。

- [ ] **Step 6: 回滚说明（仅在验证失败时执行）**

如果 Fallback 链验证失败：
1. 恢复 `.octopus-state/octopus.json` 中 `agents.defaults.model` 为字符串 `"openai-codex/gpt-5.2"`，删除 `models.providers` 节
2. 恢复 `.env` 中的 `OPENAI_API_BASE` / `OPENAI_API_KEY` / `OPENAI_MODEL`
3. `git checkout -- apps/server/src/config.ts apps/server/src/index.ts apps/server/src/routes/scheduler.ts`
4. 重启：`./start.sh stop && ./start.sh start`
