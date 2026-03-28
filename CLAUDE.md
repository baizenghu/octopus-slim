# CLAUDE.md — Octopus

> 行为规范 + 项目架构 + 活跃规则。历史归档见 `docs/`。

---

## 语言规范

- **始终使用中文与用户交流**
- 代码、变量名、命令保持原样（不翻译）
- 代码注释：业务逻辑用中文，技术实现用英文

---

## Part 1: Workflow Rules

### 1. Plan First
- **3 步以上的任务先写计划** → `tasks/todo.md`（含 checkbox），确认后再动手
- 计划含验证步骤，出问题立即 STOP 重新规划

### 2. Subagent Strategy
- 复杂任务拆子任务并行，调研/审查可 offload
- 每个子任务只做一件事

### 3. Self-Improvement Loop
- 被纠正后**立即**更新 Lessons Learned
- 每次 session 先浏览 lessons

### 4. Verification Before Done
- **不验证 = 没完成**
- 类型检查 `npx tsc --noEmit`、单元测试 `npx vitest run`、健康检查 `curl localhost:18790/health`
- 问自己："资深工程师会批准这个 PR 吗？"

### 5. Demand Elegance
- 非 trivial 改动先想有没有更优解；简单修复直接改

### 6. Autonomous Bug Fixing
- 收到 bug 直接修，先看日志和错误栈，不问"请提供更多信息"

### 7. Engine-First Development（引擎优先）

开发新功能前**必须**先检查引擎原生支持：

1. **Config Schema**: `packages/engine/src/config/zod-schema*.ts` — 200+ 配置字段
2. **RPC API**: `packages/engine/src/gateway/server-methods/` — 20+ 组方法
3. **Context Engine**: `packages/engine/src/context-engine/types.ts` — 可插拔上下文引擎
4. **Plugin 接口**: `packages/engine/src/plugins/types.ts` — hook + registerTool
5. **能力对照表**: `~/.openclaw/workspace/octopus-engine-capability-map.md`

**决策优先级：**
1. 引擎 JSON 配置（`loopDetection`、`dmScope`、`contextPruning` 等）
2. 引擎 RPC 调用（`agents.create`、`cron.add`、`config.apply`）
3. 改引擎源码（我们有 fork）
4. 企业层实现（仅限用户管理、计费、IM 适配等纯业务逻辑）

**绝对禁止：**
- 在企业层重新实现引擎已有功能
- 用 prompt 文字描述来做权限控制（引擎 `tools.allow/deny` 已硬执行）
- 硬编码工具列表（用 `tools.profile` + `alsoAllow`）
- 用内存缓存跟踪引擎已有状态

**Checklist（新功能前逐项确认）：**
- [ ] `zod-schema*.ts` 有无相关配置
- [ ] `server-methods/` 有无相关 RPC
- [ ] `context-engine/types.ts` 有无相关 hook
- [ ] 引擎不够 → 改引擎，不包一层

---

## Part 2: Code Principles

- **Simplicity First**: 改动尽可能小，影响面最小
- **No Laziness**: 找根因不打补丁，资深工程师标准
- **Type Safety**: TypeScript strict，不用 `any`（Prisma 动态查询除外）
- **Error Handling**: async 必须 try-catch，catch 有 context

---

## Part 3: Architecture

```
Browser / Console (React)
         │ HTTP/SSE
         ▼
Enterprise Server ─── port 18790 (apps/server)
  - Auth (JWT)
  - Multi-user isolation (ent_{userId}_{agentName})
  - Audit logging (plugin)
  - SystemPromptBuilder (企业级 prompt 注入)
  - AgentConfigSync (agent 配置同步到引擎)
  - IM 适配 (飞书/微信)
         │
         │ 进程内调用 (EngineAdapter)
         ▼
Engine (packages/engine) ─── port 19791
  - Agent runtime + tool system
  - Session / cron / memory
  - MCP (enterprise-mcp plugin)
  - Docker sandbox
         │ OpenAI-compatible HTTP
         ▼
Model Provider (DeepSeek / etc.)
```

### Key Files

| 文件 | 职责 |
|------|------|
| `EngineAdapter.ts` | 企业层→引擎桥接，`call()` 通用 RPC + `callAgent()` 事件映射 |
| `AgentConfigSync.ts` | memory scope 同步（plugin 配置）+ tools deny 计算 |
| `PrismaAgentStore.ts` | DB-backed AgentStore 实现，引擎通过它读写 Agent 配置 |
| `SystemPromptBuilder.ts` | 企业级 extraSystemPrompt（用户信息、工作区、MCP、Skills） |
| `chat.ts` | SSE 对话流，斜杠命令，thinking 分离 |
| `agents.ts` | Agent CRUD，tools deny 计算写入 DB |
| `tool-sources.ts` | 统一工具源管理（MCP + Skills 合并） |
| `IMRouter.ts` | 飞书/微信消息路由 |

### Key Concepts

**架构核心（2026-03-27 重构后）**
- **octopus.json 是启动配置**（providers、gateway、sandbox、plugins），不再是运行时数据库
- **Agent 配置存 DB**（通过 PrismaAgentStore），引擎 RPC 通过 AgentStore 接口读写
- **ToolSource 统一模型**：MCP 和 Skills 合并为一张表，Agent 用白名单控制权限
- **tools deny 从 DB 读取**：PrismaAgentStore.toEntry() 返回计算好的 tools.deny/alsoAllow

**多租户隔离**
- Agent ID: `ent_{userId}_{agentName}`（统一格式，DB 和引擎共用）
- Workspace: `{dataRoot}/users/{userId}/workspace/`
- Docker sandbox: `tools.exec.host = "sandbox"`, `sandbox.scope = "agent"`
- 记忆隔离: `memory-lancedb-pro` agentAccess 白名单（octopus.json plugin 配置）

**数据存储分工**

| 存储 | 数据 |
|------|------|
| `MySQL (Prisma)` | User、Agent 配置、ToolSource、AuditLog、Session 元数据 |
| `.octopus-state/octopus.json` | 启动配置：providers、gateway、sandbox、plugins |
| `.octopus-state/` | 引擎运行时：memory LanceDB、cron、JSONL 会话 |
| `data/` | 企业数据：skills 脚本、用户工作区、审计日志文件 |
| `plugins/` | 企业插件：enterprise-audit、enterprise-mcp、enterprise-email |

**引擎扩展点**
- `AgentStore`：可插拔的 agent 存储（默认文件，企业层注册 PrismaAgentStore）
- `CronLockProvider`：可插拔的分布式锁（默认单机，企业层可注册 Redis 实现）
- Plugin API：registerTool / registerHook / registerHttpRoute / registerService

---

## Part 4: Lessons Learned（活跃规则）

> 仍然有效、影响日常开发的规则。已解决的历史问题见 `docs/lessons-archived.md`。

| 规则 | 说明 |
|------|------|
| **引擎 SSE 是累积全文** | `data.text` 是全量文本，chat.ts 需 diff `prevContent` 取增量 |
| **Plugin 入口必须同步** | async 入口函数会导致 hooks 丢失；异步 init 用 `.then()` |
| **Plugin package.json 规范** | 必须有 `"octopus": {"extensions": ["./src/index.ts"]}`，name 与 manifest id 一致 |
| **MCP 通过 Plugin 注册** | 引擎无原生 MCP config，enterprise-mcp 用 `registerTool()` 桥接 |
| **Skills 用 extraDirs** | 不用软链接（workspaceOnly realpath 会失效） |
| **Agent 配置走 DB** | Agent CRUD 通过 PrismaAgentStore，不再双写 octopus.json；tools deny 在创建/更新时计算并存 DB |
| **config.set 替代 config.apply** | `config.apply` 触发 full restart；`config.set` 由 reload 模块智能评估（仅用于 plugin 配置） |
| **stub 返回安全默认值** | stub 函数不能返回 undefined，必须返回 null/[]/{}，否则运行时崩溃（3 个实际案例） |
| **tools.allow vs alsoAllow** | allow 是严格白名单（替换默认），alsoAllow 是追加。PrismaAgentStore 必须映射到 alsoAllow |
| **config 是 JSON5 格式** | `configGetParsed()` 先 JSON.parse 失败后 json5 兜底 |
| **configApply 对数组是替换** | `agents.list` 变更必须 read-modify-write，不能 deep merge |
| **config 变更前先 diff** | 无变化时跳过写入，避免不必要的引擎 reload |
| **sandbox tools.allow 必须配** | 不配 `["*"]` 会导致 plugin 注册的工具（run_skill 等）全部不可见 |
| **心跳事件字段名** | `preview`（非 `reply`）、`agentId` 是引擎内部 ID（非企业 ID） |
| **多层 bug 逐层验证** | 数据层→环境层→参数层，每层确认再进下一层 |
| **prompt 伪安全无效** | 安全靠 sandbox + tool policy 硬执行，不靠文字指令 |
| **提醒用 cron.add** | 不用 setTimeout（重启丢失） |

---

## Part 5: Backlog

> 重构历史见 `docs/refactor-history.md`

### P0 — 系统运维
- **SystemConfigPage**: 管理员前端维护 octopus.json（stash 中有 WIP）
- **Plugin 配置 UI**: 从零创建

### P1 — 功能缺失
- **个人 Skill 依赖自动安装**: Docker 镜像缺包 → `pip install --target`
- **skills.entries 双写同步**: DB ↔ 引擎不联动
- **前端轮询改推送**: 提醒 30s 轮询 → SSE/cron announce
- **API Key 移至环境变量**: 当前明文在 octopus.json

### P2 — 代码优化
- **ChatPage.tsx 拆分**（~1400 行）
- **工具名映射消除**: 前端直接用引擎原生名 read/write/exec
- **knownNativeAgents 缓存删除**: 用 agentsCreate 幂等性替代
- ~~SystemPromptBuilder → Context Engine 插件~~: **已评估不可行** — assemble() 无法获取 userId/prisma 等企业依赖，extraSystemPrompt 是正确的注入边界
- **多租户命名空间下沉引擎**: 加 tenantId 概念替代 ent_ 前缀
- **RAG 实现**: 待规划（packages/rag 已删除）

---

_历史归档: `docs/lessons-archived.md` | `docs/refactor-history.md`_
