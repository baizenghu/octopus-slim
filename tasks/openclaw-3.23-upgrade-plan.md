# OpenClaw v2026.3.23 升级实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 octopus 企业版的引擎从当前版本升级到 OpenClaw v2026.3.23（含 3.22 全部功能 + 热修复）

**Architecture:** 引擎源码位于 `packages/engine/src/`，企业层通过 `EngineAdapter.ts` 的不透明动态导入（opaque import）与引擎交互。升级主要涉及：引擎源码替换、Plugin SDK 兼容性验证、环境变量适配、EngineAdapter 导入路径修复、配置格式迁移。

**Tech Stack:** TypeScript 5.4, Node 22, pnpm 9, Express 4.18, Prisma 6, json5

---

## 前置条件

升级前必须完成的准备工作：

1. 获取 OpenClaw v2026.3.23 引擎源码包
2. 确认 memory-lancedb-pro 插件是否有 3.22 兼容版本
3. 完整备份 `.octopus-state/` 和数据库

---

## Task 1: 环境备份与升级分支创建

**Files:**
- Modify: `start.sh`（验证备份逻辑）
- 操作: git 和文件系统

- [ ] **Step 1: 完整备份 state 目录**

```bash
cd /home/baizh/octopus
cp -r .octopus-state/ .octopus-state.bak-$(date +%Y%m%d-%H%M%S)
```

- [ ] **Step 2: 备份数据库**

```bash
source .env
mysqldump -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$DB_NAME" > /tmp/octopus-db-backup-$(date +%Y%m%d).sql
```

- [ ] **Step 3: 提交当前所有未提交变更**

```bash
git add -A
git commit -m "chore: snapshot before openclaw 3.23 upgrade"
```

- [ ] **Step 4: 创建升级分支**

```bash
git checkout -b upgrade/openclaw-3.23
```

- [ ] **Step 5: 验证当前系统可正常运行**

```bash
./start.sh start
curl -sf http://localhost:18790/health
# Expected: {"status":"ok",...}
./start.sh stop
```

---

## Task 2: 引擎源码替换

**Files:**
- Replace: `packages/engine/src/` — 整目录替换为 v2026.3.23 源码

- [ ] **Step 1: 解压新版本引擎源码**

将 v2026.3.23 引擎源码解压到临时目录：
```bash
mkdir -p /tmp/openclaw-3.23
# 解压源码包到 /tmp/openclaw-3.23/（具体命令取决于包格式）
```

- [ ] **Step 2: 备份旧引擎源码**

```bash
mv packages/engine/src/ packages/engine/src.bak/
```

- [ ] **Step 3: 复制新引擎源码**

```bash
cp -r /tmp/openclaw-3.23/src/ packages/engine/src/
```

- [ ] **Step 4: 验证关键模块路径是否变更**

检查 EngineAdapter 依赖的 6 个引擎模块是否仍然存在：

```bash
# 必须全部存在
ls packages/engine/src/gateway/server.ts          # startGatewayServer
ls packages/engine/src/gateway/server-methods.ts   # handleGatewayRequest（或分类处理器）
ls packages/engine/src/gateway/protocol/index.ts   # PROTOCOL_VERSION
ls packages/engine/src/infra/agent-events.ts       # onAgentEvent
ls packages/engine/src/infra/heartbeat-events.ts   # onHeartbeatEvent
ls packages/engine/src/plugins/types.ts            # OctopusPluginApi
```

如果任何文件不存在，需要 `grep -r "startGatewayServer\|onAgentEvent\|onHeartbeatEvent\|PROTOCOL_VERSION" packages/engine/src/` 找到新路径。

- [ ] **Step 5: 检查引擎导出函数名是否变更**

```bash
grep -n "export.*startGatewayServer" packages/engine/src/gateway/server*.ts
grep -n "export.*handleGatewayRequest" packages/engine/src/gateway/server-methods*.ts
grep -n "export.*PROTOCOL_VERSION" packages/engine/src/gateway/protocol/*.ts
grep -n "export.*onAgentEvent" packages/engine/src/infra/agent-events*.ts
grep -n "export.*onHeartbeatEvent" packages/engine/src/infra/heartbeat*.ts
```

记录所有变更的路径和函数名，供 Task 4 使用。

- [ ] **Step 6: 提交**

```bash
git add packages/engine/
git commit -m "chore: replace engine with openclaw v2026.3.23"
```

---

## Task 3: 环境变量与 State 目录适配

**Files:**
- Modify: `start.sh`
- Modify: `apps/server/src/index.ts`（可能需要）
- Check: `.env`

**背景:** 3.22 移除了 `CLAWDBOT_*` 和 `MOLTBOT_*` 兼容变量，统一使用 `OPENCLAW_*`。当前 octopus 使用 `OCTOPUS_STATE_DIR` 和 `OCTOPUS_HOME`，需要确认新引擎是否仍然识别这些变量。

- [ ] **Step 1: 检查新引擎识别的环境变量名**

```bash
grep -rn "OPENCLAW_STATE_DIR\|OPENCLAW_HOME\|OPENCLAW_CONFIG" packages/engine/src/ | head -20
grep -rn "OCTOPUS_STATE_DIR\|OCTOPUS_HOME" packages/engine/src/ | head -20
grep -rn "CLAWDBOT_\|MOLTBOT_" packages/engine/src/ | head -5
```

**三种可能结果：**
- (a) 引擎只认 `OPENCLAW_*` → 需要在 start.sh 中添加映射
- (b) 引擎同时认 `OCTOPUS_*` 和 `OPENCLAW_*` → 无需改动
- (c) 引擎有自己的 fallback 逻辑 → 需要深入阅读确认

- [ ] **Step 2: 如果需要，更新 start.sh 环境变量导出**

当前 `start.sh` 第 37-38 行：
```bash
export OCTOPUS_STATE_DIR="$ROOT_DIR/.octopus-state"
export OCTOPUS_HOME="$ROOT_DIR/.octopus-state"
```

如果引擎改为只认 `OPENCLAW_*`，添加映射：
```bash
export OCTOPUS_STATE_DIR="$ROOT_DIR/.octopus-state"
export OCTOPUS_HOME="$ROOT_DIR/.octopus-state"
# 新引擎 3.22+ 使用 OPENCLAW_* 命名空间
export OPENCLAW_STATE_DIR="$OCTOPUS_STATE_DIR"
export OPENCLAW_HOME="$OCTOPUS_HOME"
```

- [ ] **Step 3: 检查 .env 文件中的废弃变量**

```bash
grep -n "CLAWDBOT_\|MOLTBOT_" .env
```

如果存在，替换为 `OPENCLAW_*` 等价变量。

- [ ] **Step 4: 检查企业代码中的环境变量引用**

```bash
grep -rn "OCTOPUS_STATE_DIR\|OCTOPUS_HOME\|OCTOPUS_CONFIG" apps/ plugins/ --include="*.ts"
```

这些是企业层自己的代码引用，与引擎无关，保持不变。但需要确认 `EngineAdapter.ts` 中是否直接使用了某些环境变量。

- [ ] **Step 5: 提交**

```bash
git add start.sh .env
git commit -m "chore: adapt environment variables for openclaw 3.23"
```

---

## Task 4: EngineAdapter 适配

**Files:**
- Modify: `apps/server/src/services/EngineAdapter.ts`

**背景:** EngineAdapter 通过 opaque import 动态导入引擎模块。如果引擎模块路径或导出函数名在 3.22/3.23 中变更，需要更新。

- [ ] **Step 1: 检查 ENGINE_ROOT 定义是否仍有效**

当前 `EngineAdapter.ts` 第 20 行：
```typescript
const ENGINE_ROOT = new URL('../../../../packages/engine/src/', import.meta.url).href;
```

验证相对路径 `../../../../packages/engine/src/` 从 `apps/server/src/services/` 到 `packages/engine/src/` 是否正确（应该不变，目录结构未改）。

- [ ] **Step 2: 更新引擎导入路径（如有变更）**

根据 Task 2 Step 4-5 的结果，修改所有动态导入路径。

**当前导入（约 L75-128）：**
```typescript
// L75: Gateway 启动
await opaqueImport(`${ENGINE_ROOT}gateway/server.js`);

// L84: Agent 事件
await opaqueImport(`${ENGINE_ROOT}infra/agent-events.js`);

// L90-100: 心跳事件（双模块兼容）
await opaqueImport(`${ENGINE_ROOT}infra/heartbeat-visibility.js`);
await opaqueImport(`${ENGINE_ROOT}infra/heartbeat-events.js`);

// L160-165: RPC 调用
await opaqueImport(`${ENGINE_ROOT}gateway/server-methods.js`);
await opaqueImport(`${ENGINE_ROOT}gateway/protocol/index.js`);
```

**如果路径变更**，按新路径修改。注意 `.js` 后缀是 ESM 解析要求（对应 `.ts` 源文件）。

- [ ] **Step 3: 验证 startGatewayServer 参数签名**

```bash
grep -A 20 "export.*function.*startGatewayServer\|export.*startGatewayServer" packages/engine/src/gateway/server*.ts
```

当前调用方式（`EngineAdapter.ts` L77-81）：
```typescript
this.engineServer = await startGatewayServer(port, {
  bind: 'loopback',
  controlUiEnabled: false,
});
```

检查新版是否：
- 增加了必填参数
- 变更了选项对象的字段名
- 返回值结构是否变化

- [ ] **Step 4: 验证 RPC 调用机制**

检查 `handleGatewayRequest` 是否仍然是同一签名：

```bash
grep -A 30 "export.*handleGatewayRequest\|handleGatewayRequest.*=" packages/engine/src/gateway/server-methods*.ts
```

当前调用方式（`EngineAdapter.ts` L180-210）：
```typescript
handleGatewayRequest({
  req: { type: 'req', id: uuid, method, params },
  client: { connect: { minProtocol, maxProtocol, client, role, scopes } },
  isWebchatConnect: () => false,
  respond: (ok, payload, error) => { ... },
  context,
});
```

检查：
- `client.connect.scopes` 中的 scope 名称是否变化
- 是否需要新增 scope（3.22 可能增加了新的 admin scope）
- `respond` 回调签名是否变化

- [ ] **Step 5: 验证 FALLBACK_GATEWAY_CONTEXT_KEY**

```bash
grep -rn "FALLBACK_GATEWAY_CONTEXT\|fallbackGatewayContext" packages/engine/src/ | head -10
```

当前使用的 Symbol key（`EngineAdapter.ts` L18）：
```typescript
const FALLBACK_GATEWAY_CONTEXT_KEY = Symbol.for("octopus.fallbackGatewayContextState");
```

确认 Symbol 名称是否变更。如果引擎改用 `openclaw.fallbackGatewayContextState`，需要同步修改。

- [ ] **Step 6: 验证 onAgentEvent 事件字段**

```bash
grep -B 5 -A 20 "type AgentEventPayload\|AgentEventStream\|interface.*AgentEvent" packages/engine/src/infra/agent-events*.ts
```

检查事件结构是否变化：
- `evt.stream` — 仍然是 `'assistant' | 'tool' | 'lifecycle' | 'thinking'`？
- `evt.data.phase` — tool 事件仍然有 `'start' | 'update' | 'result'`？
- `evt.data.toolCallId` / `evt.data.name` — 字段名是否变化？
- `evt.runId` — 仍然存在？

- [ ] **Step 7: 验证 cron service 内部路径**

当前 monkey-patch（`EngineAdapter.ts` L112-128）：
```typescript
const cronService = state?.context?.cron;
cronService._state.deps.onEvent = ...;
```

检查新版引擎中 cron service 的内部结构：
```bash
grep -rn "_state\|deps.*onEvent\|cronService" packages/engine/src/cron/ | head -10
```

如果内部结构变化，需要更新 monkey-patch 路径。

- [ ] **Step 8: 应用所有修改并提交**

```bash
cd apps/server && npx tsc --noEmit  # 验证类型
git add apps/server/src/services/EngineAdapter.ts
git commit -m "fix: adapt EngineAdapter imports for openclaw 3.23"
```

---

## Task 5: Plugin SDK 兼容性验证与适配

**Files:**
- Check: `packages/engine/src/plugins/types.ts` — OctopusPluginApi 接口
- Modify (if needed): `plugins/audit/src/index.ts`
- Modify (if needed): `plugins/mcp/src/index.ts`
- Modify (if needed): `plugins/email/src/index.ts`

**背景:** 3.22 将 Plugin SDK 从 `openclaw/extension-api` 迁移到 `openclaw/plugin-sdk/*`。我们的插件使用 `api: any` 类型注入，**不直接 import 引擎类型**，因此 import 路径变更不直接影响我们。但 API 本身（方法名、参数、Hook 名）可能有变化。

- [ ] **Step 1: 对比新旧 OctopusPluginApi 接口**

```bash
diff packages/engine/src.bak/plugins/types.ts packages/engine/src/plugins/types.ts
```

重点关注：
- `registerTool` 签名是否变化
- `on` / `registerHook` 的 Hook 名列表是否变化
- `pluginConfig` 字段是否仍然存在
- `logger` 接口是否变化
- 是否有新的必填方法

- [ ] **Step 2: 检查 Hook 名称变化**

当前 enterprise-audit 使用的 6 个 Hook：
- `before_tool_call`
- `after_tool_call`
- `llm_output`
- `session_start`
- `session_end`
- `agent_end`
- `gateway_stop`

```bash
grep "PluginHookName" packages/engine/src/plugins/types.ts
```

确认所有 Hook 名仍然存在。3.22 新增了多个 Hook（`subagent_spawning` 等），但不应移除旧的。

- [ ] **Step 3: 检查 registerTool 的 ToolFactory 签名**

当前 enterprise-mcp 使用的 ToolFactory 模式：
```typescript
api.registerTool((ctx: { agentId?: string }) => {
  return { name, label, description, parameters, execute };
});
```

```bash
grep -A 10 "OctopusPluginToolFactory\|ToolFactory" packages/engine/src/plugins/types.ts
```

确认：
- Factory 函数仍然接收 `ctx` 参数（含 `agentId`）
- 返回值结构 `{ name, label, description, parameters, execute }` 不变
- `execute` 返回值 `{ content: [{ type: 'text', text }], details? }` 不变

- [ ] **Step 4: 检查插件入口函数签名**

```bash
grep "OctopusPluginModule\|register.*api.*OctopusPluginApi\|activate.*api" packages/engine/src/plugins/types.ts
```

当前支持：
```typescript
export type OctopusPluginModule =
  | OctopusPluginDefinition      // { register(api) }
  | ((api: OctopusPluginApi) => void | Promise<void>);  // 直接函数
```

确认 3.22 仍然支持直接函数模式（我们三个插件都用这种方式）。

**注意**：3.22 Release Notes 提到 "Bundled plugins 必须使用注入的 runtime 执行宿主侧操作"。确认这是否只针对 bundled plugins，还是也影响 workspace plugins。

- [ ] **Step 5: 如有变化，更新 enterprise-audit**

当前 `plugins/audit/src/index.ts`（289 行）使用：
- `api.pluginConfig` — 读取配置
- `api.logger.info/warn/error` — 日志
- `api.on(hookName, handler)` — 7 个 Hook 注册

如果 `api.on` 改为 `api.registerHook`，需要批量替换：
```typescript
// 旧
api.on('before_tool_call', async (event, ctx) => { ... });
// 新（如果变更）
api.registerHook('before_tool_call', async (event, ctx) => { ... });
```

- [ ] **Step 6: 如有变化，更新 enterprise-mcp**

当前 `plugins/mcp/src/index.ts`（1599 行）使用：
- `api.pluginConfig` — 读取配置
- `api.logger.warn/info/error` — 日志
- `api.registerTool(factory)` — ToolFactory 模式注册多个工具

重点检查：
- ToolFactory 的 `ctx` 参数是否仍然包含 `agentId`
- 工具的 `execute` 函数第一个参数仍然是 `_toolCallId: string`

- [ ] **Step 7: 如有变化，更新 enterprise-email**

当前 `plugins/email/src/index.ts`（121 行）使用：
- `api.pluginConfig` — 读取 SMTP 配置
- `api.registerTool(factory)` — 注册 `send_email` 工具
- `api.logger?.info/warn` — 可选日志

- [ ] **Step 8: 验证 TypeScript 编译**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 9: 提交**

```bash
git add plugins/
git commit -m "fix: adapt enterprise plugins for openclaw 3.23 plugin SDK"
```

---

## Task 6: Provider 配置适配

**Files:**
- Modify: `.octopus-state/octopus.json`
- Check: `apps/server/src/services/AgentConfigSync.ts`

**背景:** 3.22 将 OpenRouter、GitHub Copilot、OpenAI Codex、MiniMax 从核心提取为 bundled plugins。这可能影响 `models.providers` 配置格式。

- [ ] **Step 1: 检查新引擎的 provider 配置格式**

```bash
grep -rn "openai-codex\|minimax\|provider.*plugin\|bundled.*provider" packages/engine/src/config/ | head -20
```

当前 `octopus.json` 中的 provider 配置：
```json
{
  "models": {
    "providers": {
      "deepseek": { "baseUrl": "...", "apiKey": "...", "api": "openai-completions" },
      "openai-codex": { "baseUrl": "...", "api": "openai-codex-responses" },
      "minimax-portal": { "baseUrl": "...", "apiKey": "...", "api": "anthropic-messages" }
    }
  }
}
```

- [ ] **Step 2: 确认 bundled provider plugins 是否需要显式启用**

```bash
grep -rn "plugins.*allow\|bundled.*plugin\|provider.*bundled" packages/engine/src/plugins/ | head -15
```

可能的情况：
- (a) bundled provider plugins 自动加载，不需要 `plugins.allow` — 无需改动
- (b) 需要在 `plugins.allow` 中添加 provider plugin ID — 需要更新 octopus.json
- (c) `models.providers` 格式完全不变，只是内部实现改为 plugin — 无需改动

- [ ] **Step 3: 如需要，更新 octopus.json 的 plugins.allow**

```json
{
  "plugins": {
    "allow": [
      "memory-lancedb-pro",
      "enterprise-audit",
      "enterprise-mcp",
      "enterprise-email",
      "provider-openai-codex",
      "provider-minimax"
    ]
  }
}
```

- [ ] **Step 4: 运行 `openclaw doctor --fix`（如 CLI 可用）**

3.23 Release Notes 建议运行此命令修复历史配置问题（Mistral max-token 等）。

```bash
# 如果引擎提供 CLI
node packages/engine/src/cli.js doctor --fix
# 或
OPENCLAW_STATE_DIR=.octopus-state npx openclaw doctor --fix
```

- [ ] **Step 5: 提交**

```bash
git add .octopus-state/octopus.json
git commit -m "chore: adapt provider config for openclaw 3.23"
```

---

## Task 7: octopus.json 配置清理与迁移

**Files:**
- Modify: `.octopus-state/octopus.json`

**背景:** 3.22 移除了一些配置项，新增了一些配置项。需要清理废弃配置，添加新必填配置。

- [ ] **Step 1: 检查并移除废弃配置项**

```bash
# 这些配置在 3.22 中已移除
grep -n "browser.relayBindHost\|driver.*extension\|nano-banana-pro" .octopus-state/octopus.json
```

如果存在，删除对应字段。

- [ ] **Step 2: 检查新版引擎的必填配置**

```bash
grep -rn "required.*config\|mandatory\|must.*config" packages/engine/src/config/ | head -20
```

- [ ] **Step 3: 验证 tools.loopDetection 配置兼容性**

当前配置：
```json
{
  "tools": {
    "loopDetection": {
      "enabled": true,
      "warningThreshold": 8,
      "criticalThreshold": 15,
      "globalCircuitBreakerThreshold": 25
    }
  }
}
```

```bash
grep -rn "loopDetection\|warningThreshold\|criticalThreshold" packages/engine/src/ | head -10
```

确认字段名和类型未变。

- [ ] **Step 4: 验证 sandbox 配置兼容性**

当前配置：
```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "workspaceAccess": "rw",
        "scope": "agent",
        "docker": { "image": "octopus-sandbox:enterprise" }
      }
    }
  }
}
```

3.22 新增了可插拔 sandbox 后端（SSH/OpenShell）。检查 Docker 后端配置是否仍然兼容：
```bash
grep -rn "sandbox.*mode\|sandbox.*docker\|sandbox.*scope" packages/engine/src/config/ | head -10
```

- [ ] **Step 5: 检查 plugins.allow 的行为变化**

3.23 修复：`plugins.allow` 中的未知/过期 plugin ID 从 fatal error 降级为 warning。确认这是否需要配置变更。

```bash
grep -rn "plugins.*allow\|unknown.*plugin\|expired.*plugin" packages/engine/src/plugins/ | head -10
```

- [ ] **Step 6: 提交**

```bash
git add .octopus-state/octopus.json
git commit -m "chore: clean up deprecated config for openclaw 3.23"
```

---

## Task 8: AgentConfigSync 适配

**Files:**
- Modify (if needed): `apps/server/src/services/AgentConfigSync.ts`

**背景:** AgentConfigSync 管理 `agents.list` 中每个 agent 的配置（tools.allow/deny, model, skills, heartbeat）。3.22 可能引入了新的 agent 配置字段或移除了旧字段。

- [ ] **Step 1: 检查 agents.list 配置结构变化**

```bash
grep -rn "AgentConfig\|AgentEntry\|agents.*list\|interface.*Agent" packages/engine/src/config/types.ts | head -20
```

对比当前使用的 agent entry 字段：
- `id`, `name`, `workspace`, `agentDir`, `model`, `skills`, `heartbeat`
- `subagents.allowAgents`
- `tools.allow`, `tools.deny`

- [ ] **Step 2: 检查 tools.allow 的工具名是否变化**

```bash
# 确认引擎原生工具名
grep -rn "'read'\|'write'\|'exec'\|'cron'\|'image'\|'memory_search'\|'memory_get'" packages/engine/src/agents/tools/ | head -20
```

当前 TOOL_NAME_TO_ENGINE 映射：
```typescript
const TOOL_NAME_TO_ENGINE = {
  list_files: 'read',
  read_file: 'read',
  write_file: 'write',
  execute_command: 'exec',
  search_files: 'exec',
};
```

确认引擎原生工具名（`read`, `write`, `exec`）是否变化。

- [ ] **Step 3: 检查 group:plugins 是否仍然有效**

```bash
grep -rn "group:plugins\|group.*plugin" packages/engine/src/ | head -10
```

当前所有有工具权限的 agent 都需要 `group:plugins` 来启用 MCP 工具。

- [ ] **Step 4: 检查 sessions_spawn 等委派工具名**

```bash
grep -rn "sessions_spawn\|sessions_list\|sessions_history\|sessions_send\|agents_list" packages/engine/src/agents/tools/ | head -10
```

当前 DEFAULT_ONLY_TOOLS：
```typescript
['sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn', 'agents_list']
```

- [ ] **Step 5: 检查 agent 默认超时变更**

3.22 将默认超时从 600s 提升至 48h。评估是否需要在 agent config 中显式设置合理超时：
```bash
grep -rn "timeout\|48.*hour\|172800" packages/engine/src/config/ | head -10
```

如果 48h 超时对企业场景不合适，在 `agents.defaults` 中添加：
```json
{
  "agents": {
    "defaults": {
      "timeout": 1800
    }
  }
}
```

- [ ] **Step 6: 如有变化，更新 AgentConfigSync 并提交**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/services/AgentConfigSync.ts
git commit -m "fix: adapt AgentConfigSync for openclaw 3.23"
```

---

## Task 9: SystemPromptBuilder 与记忆系统适配

**Files:**
- Check: `apps/server/src/services/SystemPromptBuilder.ts`
- Check: memory-lancedb-pro 插件版本

**背景:** 3.22 新增了 memory 插件 system-prompt section 注册能力，以及 `memory_search`/`memory_get` 独立注册。如果 memory-lancedb-pro 适配了新能力，可能与 SystemPromptBuilder 的手动注入冲突。

- [ ] **Step 1: 确认 memory-lancedb-pro 版本兼容性**

```bash
ls .octopus-state/extensions/memory-lancedb-pro/
cat .octopus-state/extensions/memory-lancedb-pro/package.json | grep version
```

检查是否有 3.22 兼容版本可用。

- [ ] **Step 2: 检查新版 memory 插件是否自动注入 system-prompt**

```bash
grep -rn "system.*prompt.*section\|registerSection\|promptSection" packages/engine/src/plugins/ | head -10
grep -rn "system.*prompt.*section\|registerSection" .octopus-state/extensions/memory-lancedb-pro/ | head -10
```

**如果 memory 插件自动注入 `<relevant-memories>` 到 system prompt：**
- SystemPromptBuilder 中的手动记忆注入可能产生重复
- 需要检查引擎的 system prompt 合并机制

**如果 memory 插件不自动注入（仅提供 API）：**
- 无需改动 SystemPromptBuilder

- [ ] **Step 3: 检查 memory_search/memory_get 注册方式**

3.22 将 `memory_search` 和 `memory_get` 从合并注册改为独立注册。检查 tools.allow 中是否需要分别列出：

```bash
grep -rn "memory_search\|memory_get" packages/engine/src/agents/tools/ | head -10
```

当前 AgentConfigSync 的 BASE_TOOLS 包含两者。如果引擎注册方式改变但工具名不变，无需改动。

- [ ] **Step 4: 提交（如有变更）**

```bash
git add apps/server/src/services/SystemPromptBuilder.ts
git commit -m "fix: adapt SystemPromptBuilder for new memory plugin capabilities"
```

---

## Task 10: exec 安全策略验证

**Files:**
- Check: Docker sandbox 配置
- Check: Skill 脚本依赖

**背景:** 3.22 收紧了 exec 安全策略：`jq` 从 safe-bin 移除，JVM/glibc/.NET 注入阻断。

- [ ] **Step 1: 检查 skill 脚本是否依赖 jq**

```bash
grep -rn "jq " data/skills/ --include="*.sh" --include="*.py"
```

如果有 skill 使用 `jq`，需要在引擎配置中显式 opt-in：
```json
{
  "tools": {
    "exec": {
      "additionalAllowedBins": ["jq"]
    }
  }
}
```

- [ ] **Step 2: 检查 Docker sandbox 镜像中 jq 是否可用**

```bash
docker run --rm octopus-sandbox:enterprise which jq
```

如果 sandbox 容器内有 `jq` 但引擎 allowlist 不允许，需要在 sandbox 配置中 opt-in。

- [ ] **Step 3: 验证 JVM/glibc 阻断对 Java 工具的影响**

```bash
# 检查是否有 agent 执行 Java/Maven/Gradle
grep -rn "MAVEN_OPTS\|mvn\|gradle\|java" data/skills/ --include="*.sh" | head -5
```

如果 skill 中包含 Java 构建工具，需要评估 JVM 注入阻断的影响。

- [ ] **Step 4: 提交（如有变更）**

```bash
git add .octopus-state/octopus.json
git commit -m "chore: configure exec allowlist for openclaw 3.23 security"
```

---

## Task 11: IM 适配器兼容性检查

**Files:**
- Check: `apps/server/src/services/im/IMRouter.ts`
- Check: `apps/server/src/services/im/WeixinAdapter.ts`

**背景:** 3.22 变更了 Message Discovery 机制（`describeMessageTool` 替代旧 API）。我们的 IM 适配器是自研的，不使用引擎的 channel 系统，但需要确认。

- [ ] **Step 1: 确认 IM 适配器不使用被移除的 API**

```bash
grep -rn "listActions\|getCapabilities\|getToolSchema\|describeMessageTool" apps/server/src/services/im/
```

预期结果：无匹配（我们的 IM 适配器不使用引擎的 channel 发现 API）。

- [ ] **Step 2: 确认 EngineAdapter 事件格式兼容**

IMRouter 通过 `bridge.callAgent()` 获取事件。事件格式在 Task 4 Step 6 中已验证。

- [ ] **Step 3: 检查飞书 3.22 新功能是否值得集成**

3.22 为飞书新增了：
- 结构化交互审批和快速操作启动卡片
- ACP 和 subagent session 绑定
- `onReasoningStream`/`onReasoningEnd` streaming card
- 扩展运行时 action

**评估**：这些功能需要使用引擎的 channel plugin 系统。我们的飞书适配器是自研的（通过 webhook），集成这些功能需要大幅改造 IM 架构。**建议在升级完成后单独评估**，不在本次升级范围内。

---

## Task 12: 依赖更新与编译验证

**Files:**
- Modify (if needed): `package.json`
- Modify (if needed): `pnpm-lock.yaml`

- [ ] **Step 1: 检查新引擎是否引入新依赖**

```bash
diff packages/engine/src.bak/package.json packages/engine/src/package.json 2>/dev/null || \
  cat packages/engine/package.json
```

- [ ] **Step 2: 安装依赖**

```bash
pnpm install
```

- [ ] **Step 3: 编译全部 TypeScript**

```bash
cd apps/server && npx tsc --noEmit
```

期望：无错误。如果有错误，逐一修复。

- [ ] **Step 4: 提交**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: update dependencies for openclaw 3.23"
```

---

## Task 13: 启动验证

**Files:**
- Run: `start.sh`

- [ ] **Step 1: 启动引擎**

```bash
./start.sh start
```

观察日志：
```bash
tail -f logs/gateway.log
```

**关键检查：**
- 引擎启动成功（`startGatewayServer` 无异常）
- 4 个插件加载成功（audit、mcp、email、memory-lancedb-pro）
- Provider 配置识别成功（deepseek、openai-codex）
- Docker 网络就绪

- [ ] **Step 2: 健康检查**

```bash
curl -sf http://localhost:18790/health
# Expected: {"status":"ok",...}
```

- [ ] **Step 3: 检查插件加载日志**

```bash
grep -i "plugin\|loaded\|registered\|audit\|mcp\|email\|memory" logs/gateway.log | head -30
```

确认所有 4 个插件正常加载，无 warning/error。

- [ ] **Step 4: 检查 provider 加载日志**

```bash
grep -i "provider\|model\|deepseek\|openai-codex\|minimax" logs/gateway.log | head -20
```

- [ ] **Step 5: 如有问题，分析并修复**

常见问题与修复：
- **Plugin 加载失败** → 检查 `plugins.allow` 列表和 `octopus.extensions` 入口
- **Provider 不识别** → 检查 `models.providers` 格式，可能需要 `plugins.allow` 启用 bundled provider
- **State 目录不对** → 检查环境变量映射
- **引擎模块找不到** → 检查 `EngineAdapter.ts` 中的导入路径

---

## Task 14: 功能回归测试

**Files:**
- 测试：全部关键功能

- [ ] **Step 1: 对话测试**

通过前端或 API 发送一条消息，验证完整对话流程：
```bash
curl -X POST http://localhost:18790/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "你好，请简单介绍你自己", "agentId": "default"}'
```

**验证点：**
- 收到完整回复（非空、非错误）
- 标题自动生成
- 记忆正常存取（检查日志中的 memory 相关输出）

- [ ] **Step 2: Agent CRUD 测试**

通过前端：
1. 创建一个新的专业 Agent
2. 修改其工具权限（toolsFilter）
3. 修改其模型（model）
4. 删除该 Agent

每步操作后检查 `octopus.json` 中 `agents.list` 是否正确同步。

- [ ] **Step 3: 工具调用测试**

发送一条需要工具调用的消息：
```
请列出我的工作区中有哪些文件
```

**验证点：**
- 工具调用成功（`read` 工具被调用）
- 结果正确返回

- [ ] **Step 4: MCP 工具测试**

如果有 MCP server 配置，发送需要 MCP 工具的请求，验证工具调用正常。

- [ ] **Step 5: Skill 执行测试**

发送调用 Skill 的请求，验证 run_skill 正常工作。

- [ ] **Step 6: Docker sandbox 测试**

```bash
# 验证 sandbox 执行正常
curl -X POST http://localhost:18790/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"message": "在工作区创建一个名为 test-upgrade.txt 的文件，内容是 hello openclaw 3.23"}'
```

检查文件是否在用户 workspace 中创建成功。

- [ ] **Step 7: IM 测试**

如果 IM 服务运行中：
1. 通过微信发送一条消息，验证收发正常
2. 发送 `/status` 命令，验证响应
3. 发送 `/agent list` 命令，验证 agent 列表

- [ ] **Step 8: 心跳检查测试**

```bash
# 手动触发心跳 cron
curl -X POST http://localhost:18790/api/scheduler/heartbeat/trigger \
  -H "Authorization: Bearer <admin-token>"
```

检查日志中是否有心跳事件。

- [ ] **Step 9: 会话管理测试**

1. 列出会话：`GET /api/sessions`
2. 查看历史：`GET /api/sessions/:id/history`
3. 删除会话：`DELETE /api/sessions/:id`

- [ ] **Step 10: 前端控制台测试**

访问 `http://localhost:18792`，验证：
- 登录正常
- 对话页面工作
- Agent 配置页面工作
- 用户管理页面工作

---

## Task 15: 清理与合并

**Files:**
- Remove: `packages/engine/src.bak/`

- [ ] **Step 1: 删除旧引擎备份**

```bash
rm -rf packages/engine/src.bak/
```

- [ ] **Step 2: 最终编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 3: 更新 CLAUDE.md**

在 Lessons Learned 表格中追加升级记录：

```markdown
| 2026-03-XX | OpenClaw 3.22/3.23 升级 | 记录实际遇到的问题和解决方案 |
```

- [ ] **Step 4: 提交并合并**

```bash
git add -A
git commit -m "feat: upgrade engine to openclaw v2026.3.23"
git checkout main
git merge upgrade/openclaw-3.23
```

---

## 附录 A: 快速回滚命令

如果升级失败需要回滚：

```bash
# 停止服务
./start.sh stop

# 回滚到 main 分支
git checkout main

# 恢复 state 目录
cp -r .octopus-state.bak-YYYYMMDD-HHMMSS/* .octopus-state/

# 恢复数据库（如果做了 schema 变更）
mysql -u "$DB_USER" -p"$DB_PASS" -h "$DB_HOST" "$DB_NAME" < /tmp/octopus-db-backup-YYYYMMDD.sql

# 重新启动
./start.sh start
```

## 附录 B: 已知需要特别注意的 3.23 修复

| 修复 | 与 octopus 的关系 |
|------|-------------------|
| OpenAI Codex OAuth 代理初始化 | 直接相关（使用 openai-codex provider） |
| LanceDB 记忆插件初始化 bootstrap | 需确认是否影响 lancedb-pro |
| Mistral max-token 默认值修正 | 如配置了 Mistral 需检查 |
| `plugins.allow` 未知 ID 降为 warning | 降低升级风险 |
| Skills SecretRef 解析修复 | 如 skill 使用 SecretRef 则受益 |
| Shell wrapper 安全加强 | Docker sandbox 内的命令执行 |
| Anthropic thinking block 排序 | 使用 Claude 模型时的思考过程展示 |

## 附录 C: 升级后可选采用的新功能

| 功能 | 改动范围 | 优先级 |
|------|----------|--------|
| `/btw` 侧问 | chat.ts 透传 | P2 |
| Memory system-prompt section | SystemPromptBuilder 简化 | P1 |
| 自动压缩通知 | 无需改动 | P2 |
| config set --dry-run | 可用于验证 | P1 |
| 飞书结构化卡片 | IM 适配器大改 | P3 |
