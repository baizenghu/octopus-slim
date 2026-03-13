# Phase 3: 单进程合并 — 核心重构（最高风险）

> **状态:** 待执行 | **预估:** 12-16h | **依赖:** Phase 1 + Phase 2
> **这是整个项目最核心最复杂的 Phase**

---

## Task 3.1: 创建统一后端入口 apps/server

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Copy + Modify: `openclaw-enterprise/apps/gateway/src/` → `apps/server/src/`

**Step 1: 复制企业 gateway 代码为 server**

```bash
cp -r /home/baizh/openclaw-enterprise/apps/gateway apps/server
sed -i 's/@openclaw-enterprise\/gateway/@octopus\/server/g' apps/server/package.json
```

**Step 2: 全局替换 import 和品牌**

```bash
find apps/server/src -name "*.ts" -exec sed -i 's/@openclaw-enterprise\//@octopus\//g' {} +
find apps/server/src -name "*.ts" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +
find apps/server/src -name "*.ts" -exec sed -i 's/OpenClaw/Octopus/g' {} +
find apps/server/src -name "*.ts" -exec sed -i 's/openclaw/octopus/g' {} +
```

**Step 3: Commit（编译暂不通过，下一步修）**

```bash
git add apps/server/
git commit -m "feat: 创建统一后端 @octopus/server（品牌替换完成，待重构 Bridge）"
```

---

## Task 3.2: 删除 OpenClawBridge，替换为引擎直接调用 ⭐ 核心任务

这是整个合并中最关键的一步。OpenClawBridge（701 行）的 25+ 个 RPC 方法需要逐个替换为 `@octopus/engine` 的直接函数调用。

**Files:**
- Delete: `apps/server/src/services/OctopusBridge.ts`（Phase 3.1 已从 OpenClawBridge 重命名）
- Create: `apps/server/src/services/EngineAdapter.ts` — 薄包装层
- Modify: 6 个路由文件 + 1 个 IM 服务

### Step 1: 创建 EngineAdapter — 直接调用引擎 API

创建 `apps/server/src/services/EngineAdapter.ts`，对 `@octopus/engine` 的 API 做薄包装，保持与旧 Bridge 相同的方法签名，但内部改为进程内调用：

```typescript
// apps/server/src/services/EngineAdapter.ts
import { loadConfig } from '@octopus/engine/config';
import { createEmbeddedRunner } from '@octopus/engine/agents';
import { createPluginRuntime } from '@octopus/engine/plugins';
// ... 更多 import

export class EngineAdapter extends EventEmitter {
  private runner: EmbeddedRunner;
  private configIO: ConfigIO;

  async initialize() {
    // 直接初始化引擎（不再通过 WebSocket）
    const config = await loadConfig();
    this.configIO = createConfigIO();
    this.runner = createEmbeddedRunner(config);
    // 加载 plugins
    await loadPlugins(config);
  }

  // 保持与旧 Bridge 相同的方法签名
  async callAgent(params, onEvent) { /* 直接调用 runner */ }
  async sessionsList(agentId?) { /* 直接调用 session store */ }
  async agentsCreate(params) { /* 直接调用 agent manager */ }
  async configGet() { /* 直接调用 configIO */ }
  async configSet(raw, hash) { /* 直接调用 configIO */ }
  // ... 其余 20+ 方法
}
```

### Step 2: RPC 方法映射表（逐个实现）

| Bridge RPC 方法 | Engine 直接 API | 备注 |
|----------------|----------------|------|
| `callAgent(params, onEvent)` | `runner.run(agentId, message)` | 最核心，需要事件流转换 |
| `sessionsList(agentId?)` | `sessionStore.list(agentId)` | |
| `sessionsDelete(key)` | `sessionStore.delete(key)` | |
| `sessionsReset(key)` | `sessionStore.reset(key)` | |
| `sessionsPatch(key, patch)` | `sessionStore.patch(key, patch)` | |
| `chatHistory(sessionKey)` | `sessionStore.getHistory(key)` | |
| `chatAbort(sessionKey)` | `runner.abort(sessionKey)` | |
| `agentsCreate(params)` | `agentManager.create(params)` | |
| `agentsUpdate(params)` | `agentManager.update(params)` | |
| `agentsDelete(agentId)` | `agentManager.delete(agentId)` | |
| `agentFilesSet(id, name, content)` | `agentManager.setFile(id, name, content)` | |
| `agentFilesGet(id, name)` | `agentManager.getFile(id, name)` | |
| `cronList(includeDisabled?)` | `cronScheduler.list(includeDisabled)` | |
| `cronAdd(job)` | `cronScheduler.add(job)` | |
| `cronRemove(id)` | `cronScheduler.remove(id)` | |
| `cronRun(id, mode?)` | `cronScheduler.run(id, mode)` | |
| `configGet()` | `configIO.read()` | 返回 `{raw, hash}` |
| `configSet(raw, hash)` | `configIO.write(raw, hash)` | |
| `configApplyFull(config)` | `configIO.readMergeWrite(config)` | |
| `configApply(patch)` | `configIO.readMergeWrite(patch)` | |
| `configApplyBatched(patch)` | 去掉批量逻辑，直接 apply | 单进程无需防抖 |
| `configGetParsed()` | `configIO.readParsed()` | |
| `sessionsUsage(params?)` | `sessionStore.usage(params)` | |
| `sessionsCompact(key, max?)` | `sessionStore.compact(key, max)` | |
| `toolsCatalog(agentId?)` | `toolRegistry.catalog(agentId)` | |
| `modelsList()` | `modelsConfig.list()` | |
| `health()` | 直接返回 `{status: 'ok'}` | 单进程总是健康的 |

### Step 3: 在路由文件中将 bridge 替换为 engineAdapter

需要修改的文件（6 个路由 + 1 个服务）：

| 文件 | bridge 调用数 | 改动策略 |
|------|-------------|---------|
| `routes/chat.ts` | 10+ | `bridge.callAgent()` → `engineAdapter.callAgent()` |
| `routes/agents.ts` | 15+ | `bridge.configApplyFull()` → `engineAdapter.configApplyFull()` |
| `routes/scheduler.ts` | 20+ | `bridge.cronAdd()` → `engineAdapter.cronAdd()` |
| `routes/admin.ts` | 6+ | `bridge.agentsDelete()` → `engineAdapter.agentsDelete()` |
| `index.ts` | 3+ | `bridge.connect()` → `engineAdapter.initialize()` |
| `services/im/IMRouter.ts` | 1 | `bridge.callAgent()` → `engineAdapter.callAgent()` |

由于 EngineAdapter 保持了相同的方法签名，这一步主要是变量重命名：

```typescript
// 旧代码
const bridge = new OctopusBridge(config);
await bridge.connect();

// 新代码
const engineAdapter = new EngineAdapter(config);
await engineAdapter.initialize();
```

### Step 4: 删除旧 Bridge 文件

```bash
rm apps/server/src/services/OctopusBridge.ts
```

### Step 5: 编译验证 + commit

```bash
cd apps/server && npx tsc --noEmit
git add -A
git commit -m "refactor: 删除 RPC Bridge，替换为 EngineAdapter 进程内直接调用"
```

---

## Task 3.3: 引擎启动集成

**Files:**
- Modify: `apps/server/src/index.ts` — 启动时初始化引擎

**Step 1: 修改 index.ts 启动流程**

```typescript
// 旧流程（两进程）：
// 1. 启动 Express
// 2. bridge.connect() → WebSocket 连接到 native gateway

// 新流程（单进程）：
// 1. 初始化引擎（加载配置、agent manager、cron scheduler、plugin system）
// 2. 启动 Express（使用引擎实例）
// 3. 加载 plugins（audit、mcp、memory）
```

**Step 2: 编译 + 运行测试**

```bash
npx tsc --noEmit
npx vitest run
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: 单进程启动 — 引擎和 HTTP 服务统一初始化"
```
