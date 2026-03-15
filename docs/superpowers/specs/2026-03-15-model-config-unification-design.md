# 模型配置统一收口设计

> 日期: 2026-03-15
> 状态: Draft

## 1. 背景与问题

当前模型配置散落在 5 个位置：

| # | 位置 | 当前值 | 用途 |
|---|------|--------|------|
| 1 | `.octopus-state/octopus.json` | `"model": "openai-codex/gpt-5.2"` (字符串) | 全局默认模型，无 fallback |
| 2 | `.env` | `OPENAI_API_BASE=https://api.deepseek.com` | 企业网关 AI 配置 |
| 3 | `apps/server/src/config.ts:101-103` | `process.env.OPENAI_MODEL \|\| 'deepseek-chat'` | 读 .env 构建 config.ai |
| 4 | `apps/server/src/routes/scheduler.ts:23` | `'custom-api-deepseek-com/deepseek-chat'` 硬编码 | 心跳巡检模型 |
| 5 | `.octopus-state/agents/*/models.json` | 引擎自动生成 | 运行时 provider 注册 |

**核心问题**:
- 主模型（openai-codex）挂了不会自动切换到备用模型（DeepSeek），因为没有配置 fallback 链
- 模型配置散落多处，手动切换后需要重启系统才能生效
- 心跳巡检模型硬编码在代码中，无法通过配置变更

## 2. 设计目标

1. **统一收口**: 所有模型配置归入 `octopus.json` 一处管理
2. **自动 Fallback**: 主模型故障时自动切换备用模型，用户无感知，无需重启
3. **Per-Agent 模型**: 支持不同 agent 使用不同模型
4. **前端可选**: agent 创建/编辑时可从下拉列表选择模型
5. **热加载**: 模型配置变更通过 `config.set` 热加载，不触发 gateway 重启

## 3. 配置结构设计

### 3.1 目标配置（`octopus.json`）

```json
{
  "models": {
    "providers": {
      "deepseek": {
        "name": "deepseek",
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "sk-xxx",
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
    },
    "list": [
      {
        "id": "ent_user-admin_default"
      },
      {
        "id": "ent_user-admin_____",
        "model": "deepseek/deepseek-chat"
      }
    ]
  }
}
```

### 3.2 模型优先级链

```
Agent 自身 model 字段（per-agent 覆盖）
  → agents.defaults.model.primary（全局主模型）
    → agents.defaults.model.fallbacks[0..N]（按序尝试备用）
```

### 3.3 Per-Agent 模型配置

引擎原生支持（`types.agents.ts:67`），`agents.list` 中每个 agent 条目可设 `model` 字段：

- **字符串格式**: `"model": "deepseek/deepseek-chat"` — 固定使用该模型，**fallback 链为空**（`resolveAgentModelFallbackValues()` 对字符串返回 `[]`）
- **对象格式（推荐）**: `"model": { "primary": "deepseek/deepseek-chat", "fallbacks": ["openai-codex/gpt-5.2"] }` — 自定义 fallback 链
- **省略**: 跟随 `agents.defaults.model`（含全局 fallback 链）

> **注意**: 若 per-agent 需要 fallback 能力，必须使用对象格式。字符串格式仅适用于明确固定使用某个模型的场景。

## 4. 后端改动

### 4.1 `octopus.json` 配置变更

**改动**: `agents.defaults.model` 从字符串改为对象格式，新增 `models.providers.deepseek`。

**原因**: 引擎的 `resolveAgentModelFallbackValues()` (`config/model-input.ts:20-24`) 对字符串格式直接返回空数组，必须用对象格式才能启用 fallback。

### 4.2 删除 `config.ts` 中 `ai` 配置块

**文件**: `apps/server/src/config.ts`

**改动**: 删除 `ai` 字段及相关类型定义：
```typescript
// 删除以下内容
ai: {
  apiBase: string;
  apiKey: string;
  model: string;
}
```

**原因**: 模型信息统一从 `octopus.json` 读取，不再需要通过环境变量配置。

### 4.3 删除 `.env` 中模型相关变量

**文件**: `.env`

**改动**: 删除以下三个变量：
- `OPENAI_API_BASE`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

**原因**: apiKey 直接写入 `octopus.json` 的 `models.providers.deepseek.apiKey`，不再需要环境变量中转。

### 4.4 `scheduler.ts` 心跳模型去硬编码

**文件**: `apps/server/src/routes/scheduler.ts`

**改动（共 4 处）**:
- 行 23: 删除 `const HEARTBEAT_MODEL = 'custom-api-deepseek-com/deepseek-chat'`
- 行 223: `heartbeat: { every, prompt: 'HEARTBEAT.md', model: HEARTBEAT_MODEL }` → `heartbeat: { every, prompt: 'HEARTBEAT.md' }`
- 行 225: 同上（agent 不存在时新建的分支）
- 行 383, 388: `heartbeat: { every: heartbeatEvery, prompt: 'HEARTBEAT.md', model: HEARTBEAT_MODEL }` → `heartbeat: { every: heartbeatEvery, prompt: 'HEARTBEAT.md' }`

**原因**: 引擎 heartbeat runner 中 `heartbeat?.model?.trim() || undefined`，省略 model 则使用全局 `agents.defaults.model`（含 fallback 链）。

### 4.5 `index.ts` 清理 `config.ai` 引用

**文件**: `apps/server/src/index.ts`

`config.ai` 实际仅在 `index.ts` 中被引用（2 处）：
- 行 355: `/health` 端点返回 `model: config.ai.model` → 改为返回 `model: 'configured in octopus.json'` 或从 bridge 获取
- 行 403: 启动日志 `Model: ${config.ai.model} @ ${config.ai.apiBase}` → 改为 `Model: configured in octopus.json (unified)`

`chat.ts` 中**不存在** `config.ai` 引用，无需改动。

### 4.6 `scheduler.ts` 配置更新方式优化

**文件**: `apps/server/src/routes/scheduler.ts`

**现状**: 心跳配置更新使用 `bridge.configApplyFull(config)`（行 228, 392, 476），底层调的是 `config.apply` RPC，会触发 SIGUSR1 强制重启 native gateway。

**改动**: 将心跳配置更新改为使用 `bridge.configApply(patch)` 或直接 `config.set` RPC，避免不必要的全量重启。具体：
- `configApplyFull(config)` → `configApply({ agents: { list: updatedList } })`
- 底层走 `config.set`（read-merge-write），对 `agents.list` 变更支持热加载

## 5. 前端改动

### 5.1 AgentsPage.tsx 模型选择改造

**文件**: `apps/console/src/pages/AgentsPage.tsx`

**当前**: 纯文本输入框 `<Input placeholder="如: deepseek-chat, deepseek-coder" />`

**改动**: 改为 Input + 下拉辅助选择

```
┌──────────────────────────────────────────┐
│ 模型 (留空跟随全局默认)                    │
│ ┌────────────────────────────┬─────────┐ │
│ │ deepseek/deepseek-chat     │ ▼ 选择  │ │
│ └────────────────────────────┴─────────┘ │
│                                          │
│  下拉展开时：                              │
│  ┌──────────────────────────────────┐    │
│  │ （留空）跟随全局默认              │    │
│  │ openai-codex / gpt-5.2          │    │
│  │ deepseek / deepseek-chat        │    │
│  └──────────────────────────────────┘    │
└──────────────────────────────────────────┘
```

**实现**:
1. 页面加载时调用 `GET /api/chat/models` 获取可用模型列表
2. 渲染为 Input + 右侧下拉按钮（Combobox 模式）
3. 下拉选择后填入输入框值，用户仍可手动编辑输入任意模型名
4. 第一项 "跟随全局默认" 选中后清空输入框（model 传 null）

### 5.2 API 层

已有 `GET /api/chat/models` 端点（`chat.ts` 中），调用 `bridge.modelsList()` 返回可用模型列表，无需新增 API。

## 6. 不改的地方

| 模块 | 原因 |
|------|------|
| `packages/engine/src/agents/model-fallback.ts` | 原生支持对象格式 + fallbacks，零改动 |
| `packages/engine/src/config/model-input.ts` | `resolveAgentModelFallbackValues()` 已支持对象格式 |
| `packages/engine/src/agents/models-config.ts` | 引擎自动读取新配置重新生成 `models.json` |
| `packages/engine/src/gateway/config-reload-plan.ts` | `agents.defaults.model` 变更已标记为 `kind: "hot"`，支持热加载 |
| 数据库 schema | agent 的 `model` 字段是字符串，存 `provider/model` 格式，不受影响 |

## 7. 效果验证

| 场景 | 预期行为 |
|------|---------|
| openai-codex 挂了 | `runWithModelFallback()` 自动切 DeepSeek，用户无感知，不用重启 |
| DeepSeek 也挂了 | 所有候选耗尽，返回 "All models failed" 错误 |
| 某 agent 配了固定模型 | 该 agent 使用指定模型，不走全局 fallback |
| 修改 octopus.json 模型配置 | `config.set` → hot reload → 下次对话立即生效 |
| 心跳巡检 | 跟随全局 primary + fallbacks，不再硬编码 |
| 前端创建 agent | 下拉列表展示可用模型，也可手动输入 |

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| apiKey 写入 octopus.json 进版本控制 | octopus.json 已在 .gitignore 的运行时数据中；若需更高安全性，后续可支持 `$ENV_VAR` 引用 |
| 删除 .env 后遗漏其他依赖 | 全文搜索 `OPENAI_API_BASE` / `OPENAI_API_KEY` / `OPENAI_MODEL` 确认无遗漏 |
| 心跳去掉 model 后引擎是否正确 fallback | 引擎 heartbeat runner 使用 agent 配置，省略 model 即走 defaults，已有此逻辑 |
| `config.ai` 删除后影响其他功能 | 全文搜索 `config.ai` 确认所有引用点已清理 |
