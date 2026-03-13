---
name: octopus-merge-2026-03-13
description: Octopus 项目合并（openclaw-main + openclaw-enterprise → octopus）的架构变更、踩坑记录和当前状态
type: project
---

# Octopus 项目合并记录（2026-03-13）

## 项目背景
将 openclaw-main（AI 引擎）和 openclaw-enterprise（企业网关）合并为单一项目 **Octopus**，路径 `/home/baizh/octopus/`。

**Why:** 消除 WebSocket RPC 双进程架构的复杂性，改为单进程内函数调用。
**How to apply:** 后续开发都在 `/home/baizh/octopus/` 进行，老项目 `/home/baizh/openclaw-enterprise/` 和 `/home/baizh/openclaw-main/` 保留不动。

## 架构变更：单进程模式

### 旧架构（双进程 WebSocket RPC）
```
Enterprise Gateway (18790) --WebSocket--> Native Gateway (19791)
OctopusBridge.ts (WS client)              openclaw.mjs (独立进程)
```

### 新架构（单进程内调用）
```
Enterprise Gateway (18790) --进程内函数调用--> Engine (内嵌, port 19791 仅供内部)
EngineAdapter.ts                          startGatewayServer() 动态导入
```

### EngineAdapter 核心实现
- **Opaque import**：`new Function('s', 'return import(s)')` 阻止 TypeScript 追踪引擎源码（避免 TS6059 rootDir 错误）
- **ENGINE_ROOT**：`new URL('../../../../packages/engine/src/', import.meta.url).href`
- **Global Symbol**：`Symbol.for("octopus.fallbackGatewayContextState")` 访问引擎 context
- **initialize(port)**：动态导入 `startGatewayServer`，订阅 `onAgentEvent`
- **call(method, params)**：构造 synthetic operator client → `handleGatewayRequest` → Promise 包装 respond 回调
- **callAgent**：订阅 `onAgentEvent` + 异步错误处理（合成 lifecycle error 事件）
- **异步错误防护**：agent handler 先 respond(accepted) 再异步执行，如果异步失败无 event 发出 → EngineAdapter 监听第二次 respond 并合成 error 事件

## 关键配置变更

| 项目 | 旧值 | 新值 |
|------|------|------|
| 项目路径 | `/home/baizh/openclaw-enterprise/` | `/home/baizh/octopus/` |
| State 目录 | `.openclaw-state/` | `.octopus-state/` |
| 配置文件 | `openclaw.json` | `octopus.json` |
| Plugin manifest | `openclaw.plugin.json` | `octopus.plugin.json` |
| Plugin SDK import | `openclaw/plugin-sdk` | `octopus/plugin-sdk` |
| 启动脚本 | `start-dev.sh`（双进程） | `start.sh`（单进程，无 native gateway） |
| Admin Console 目录 | `apps/admin-console/` | `apps/console/` |
| Server 目录 | `apps/gateway/` | `apps/server/` |
| Sandbox 镜像 | `openclaw-sandbox:enterprise` | `octopus-sandbox:enterprise`（未构建） |
| exec.host | `sandbox` | `gateway`（临时，sandbox 镜像未构建） |
| sandbox.mode | `all` | `off`（临时，sandbox 镜像未构建） |

## 踩坑记录

### 1. `.env` CRLF 换行符
bash `source .env` 后值末尾带 `\r`，导致路径包含非法字符（winston-daily-rotate-file 报错）。修复：`sed -i 's/\r$//'`。

### 2. 引擎模板文件缺失
引擎需要 `docs/reference/templates/` 下的 7 个模板文件（AGENTS.md, SOUL.md, TOOLS.md 等）。从 openclaw-main 复制。

### 3. config 版本不匹配触发引擎反复 reload
`meta.lastTouchedVersion: "2026.3.9"` vs 引擎 `package.json` version `"1.0.0"`。每次写 config 都更新 meta → 触发 chokidar → reload → 杀死正在执行的 agent。修复：将 meta 版本改为 `"1.0.0"`。

### 4. ensureNativeAgent 盲目调用 agents.create
每次 chat 都调 `agents.create` RPC，引擎端处理失败但仍可能触发不必要的配置操作。修复：加内存缓存 `knownNativeAgents` Set，先 `agentsList()` 检查。

### 5. agent 异步执行错误被静默吞掉
引擎 agent handler 先 respond(accepted) 再异步执行 agentCommandFromIngress。如果异步失败，第二次 respond(error) 被 EngineAdapter 原有逻辑忽略（`if (responded) return`）。修复：检测第二次 respond 是 error 时 emit `_agent_async_error` → 合成 lifecycle error 事件。

### 6. defaultDataRoot 路径层级错误
`config.ts` 中 `path.resolve(__dirname, '..', '..', '..', '..', 'data')` 多了一层 `..`。修复：改为三层。

## 当前状态（2026-03-13）
- **P0 编译通过** ✅
- **P1 EngineAdapter.call() 实现** ✅
- **P2 启动验证** ✅（start.sh、health check、所有服务正常）
- **P3 E2E 对话测试** ✅（非流式模式，DeepSeek 正常回复）
- **待做**：Docker sandbox 镜像构建、流式对话测试、Admin Console 浏览器测试、数据库迁移命名
