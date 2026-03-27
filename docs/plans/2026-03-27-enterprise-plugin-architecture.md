# Octopus Enterprise 架构重构设计

> 状态：设计完成 | 日期：2026-03-27

## 定位

Octopus 是一个**多租户企业 AI 应用**，使用 OpenClaw 引擎作为 AI 执行层。
企业层是主体，引擎是依赖。重构目标是**更好地利用引擎原生能力，消除重复造轮子**。

---

## 1. 六大重构目标

| # | 目标 | 现状 | 改后 |
|---|------|------|------|
| 1 | **Agent 配置存 DB** | octopus.json 双写 + AgentConfigSync 546 行 | DB 单源，删 AgentConfigSync |
| 2 | **统一工具源模型** | MCP 和 Skills 分开管理，3 套 filter | ToolSource 统一表 + 白名单 |
| 3 | **删原生 memory** | 引擎原生 19K 行 + plugin 3K 行，两套并存 | 只保留 memory-lancedb-pro |
| 4 | **扩展引擎 RPC** | agents.update 不支持 tools/skills/subagents | 扩展后企业层直接调 RPC |
| 5 | **精简桥接层** | EngineAdapter 648 行（20 个纯转发） | 路由直调 RPC，adapter 降到 300 行 |
| 6 | **分布式就绪** | 单进程，文件锁，进程内事件 | Redis 协调，NFS 共享，无状态节点 |

---

## 2. 架构对比

### 当前架构

```
apps/console (React)
       │ REST (port 18790)
       ▼
apps/server (Express)               ← 企业主体
  ├─ Auth (JWT/LDAP)
  ├─ AgentConfigSync (双写 546 行)  ← 痛点 1
  ├─ 3 套 filter (tools/mcp/skills) ← 痛点 2
  ├─ SystemPromptBuilder
  ├─ EngineAdapter (648 行)         ← 痛点 5
  │        │ 进程内 RPC
  │        ▼
  └─ Engine Gateway (port 19791)
       ├─ Agent Runtime
       ├─ Native Memory (19K 行)    ← 痛点 3
       ├─ Plugins (audit/mcp/email)
       └─ octopus.json
            ├─ agents.list          ← 双写目标
            └─ memory.*             ← 不用的原生 memory 配置
```

### 目标架构

```
apps/console (React)
       │ REST (port 18790)
       ▼
apps/server (Express，精简后)        ← 企业主体（保留）
  ├─ Auth (JWT/LDAP)
  ├─ 多租户隔离
  ├─ ToolSource 统一管理             ← 合并 MCP + Skills
  ├─ SystemPromptBuilder (Hook 化)
  ├─ 路由直调 Engine RPC             ← 无 EngineAdapter 纯转发
  │        │ RPC (进程内 / WebSocket)
  │        ▼
  └─ Engine Gateway
       ├─ Agent Runtime
       ├─ AgentStore 接口 → DB       ← Agent 配置从 DB 读
       ├─ 扩展的 agents.update RPC   ← 支持 tools/skills/subagents
       ├─ memory-lancedb-pro (唯一)  ← 删原生 memory
       ├─ enterprise-audit plugin
       └─ enterprise-email plugin
            │         │
            ▼         ▼
         MySQL     Redis
```

### 分布式部署

```
           Load Balancer
          ┌────┼────┐
          ▼    ▼    ▼
       Node 1/2/3 (apps/server + engine)
          │    │    │
          ▼    ▼    ▼
       MySQL  Redis  NFS
```

---

## 3. 重构 1：Agent 配置存 DB

### 问题

Agent 配置双写：DB (Agent 表) ↔ octopus.json (agents.list)。
AgentConfigSync.ts 546 行做 read-modify-write + 互斥锁 + 重试。

### 方案

#### 3.1 引擎新增 AgentStore 接口

```typescript
// packages/engine/src/agents/store.ts
export interface AgentStore {
  list(filter?: { tenantId?: string }): Promise<AgentConfig[]>;
  get(agentId: string): Promise<AgentConfig | null>;
  create(config: AgentConfig): Promise<void>;
  update(agentId: string, patch: Partial<AgentConfig>): Promise<void>;
  delete(agentId: string): Promise<void>;
  onChanged?(callback: (agentId: string) => void): void;
}
```

- 默认实现：FileAgentStore（从 octopus.json 读，保持原生 CLI 兼容）
- 企业实现：PrismaAgentStore（从 MySQL 读）
- 通过 `registerAgentStore` 注册（独占槽位，类似 registerContextEngine）

#### 3.2 octopus.json 瘦身

| 移到 DB | 留在 JSON |
|---------|----------|
| `agents.list` | `agents.defaults` |
| per-agent tools/skills/heartbeat/subagents | `providers` |
| per-agent memoryScope | `gateway` / `sandbox` |
| | `plugins` / `sessions` |

#### 3.3 删除清单

- `AgentConfigSync.ts` (546 行) → 全删
- `EngineAdapter.configTransaction/configApplyFull` → 不再需要
- `TenantEngineAdapter` 客户端过滤 → DB WHERE 替代

---

## 4. 重构 2：统一工具源模型（合并 MCP + Skills）

### 问题

MCP 和 Skills 本质相同（外部工具源），但管理完全割裂：
- 两张 DB 表（MCPServer / Skill）
- 两套前端页面
- 三个权限 filter（toolsFilter / mcpFilter / skillsFilter）
- AgentConfigSync 200 行计算 deny 列表

### 方案

#### 4.1 统一 ToolSource 模型

```prisma
model ToolSource {
  id          String   @id @default(uuid())
  name        String   @unique
  type        String   // "mcp" | "skill"
  enabled     Boolean  @default(true)
  scope       String   @default("enterprise")  // "enterprise" | "personal"
  ownerId     String?  // personal scope 时的用户 ID

  // MCP 配置
  transport   String?  // "stdio" | "http"
  command     String?
  args        Json?
  url         String?
  env         Json?

  // Skill 配置
  scriptPath  String?
  runtime     String?  // "python" | "node"

  // 通用
  description String?
  tools       Json?    // 提供的工具列表（缓存）
  config      Json?

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([ownerId, scope])
}
```

#### 4.2 白名单替代 deny 列表

Agent 模型变更：

```prisma
model Agent {
  // ... 现有字段

  // 替代 toolsFilter + mcpFilter + skillsFilter
  allowedToolSources  Json?    // string[] 白名单
                               // null = 禁用所有外部工具
                               // ["*"] = 允许所有
                               // ["高德地图", "数据分析"] = 仅允许指定源
}
```

权限计算从 200 行降到 ~20 行：

```typescript
// 当前：AgentConfigSync 行 144-234
toolsDeny = computeNativeDeny(toolsFilter)
          + computeMcpDeny(mcpFilter, allMcpTools)
          + computeSkillDeny(skillsFilter)
          + computeSpecialistDeny()

// 目标：
const allowed = agent.allowedToolSources ?? [];
const allowedTools = await db.toolSource.findMany({
  where: { name: { in: allowed }, enabled: true }
}).then(sources => sources.flatMap(s => s.tools));
// → 设置 tools.allow = [...nativeTools, ...allowedTools]
```

#### 4.3 前端合并

两个管理页面 → 一个"工具源管理"页面，按类型筛选（MCP / Skill / 全部）。

#### 4.4 迁移路径

```sql
-- MCPServer → ToolSource
INSERT INTO ToolSource (name, type, transport, command, args, url, ...)
SELECT name, 'mcp', transport, command, args, url, ...
FROM MCPServer;

-- Skill → ToolSource
INSERT INTO ToolSource (name, type, scriptPath, runtime, ...)
SELECT name, 'skill', path, runtime, ...
FROM Skill;
```

---

## 5. 重构 3：删除原生 memory

### 问题

引擎原生 memory（~19,000 行）和 memory-lancedb-pro plugin 并存。
企业版只用 plugin，原生 memory 是死代码。

### 方案

#### 5.1 删除清单

```
packages/engine/src/memory/           # 19,000 行，全删
  ├── qmd-manager.ts (2,098)
  ├── backend-config.ts
  ├── index-manager.ts
  ├── search.ts
  └── 60+ 个文件

packages/engine/src/cli/memory-cli.ts  # memory CLI（已在 slim 中保留）
```

#### 5.2 依赖处理

| 引用方 | 处理 |
|--------|------|
| `plugins/runtime/runtime-tools.ts` → `registerMemoryCli` | 删除注册调用 |
| `cli/memory-cli.ts` → memory 模块 | 删除或 stub |
| config schema → `memory.*` 字段 | 保留 schema（plugin 使用），删实现 |
| hooks → memory 相关 | memory-lancedb-pro 通过 hook 工作，不依赖原生代码 |

#### 5.3 验证

memory-lancedb-pro plugin 通过引擎的 hook 系统（`command:new`, `command:reset`, `after_tool_call`, `before_agent_start`, `before_prompt_build`）工作，**不调用原生 memory 任何 API**。删除原生 memory 对 plugin 零影响。

---

## 6. 重构 4：扩展引擎 RPC

### 问题

`agents.update` RPC 只支持 `model` 参数。tools/skills/subagents 必须通过 `config.set` 写 octopus.json，导致 AgentConfigSync 的复杂逻辑。

### 方案

#### 6.1 扩展 agents.update

```typescript
// 当前参数
{ agentId, name?, workspace?, model?, avatar? }

// 扩展后
{ agentId, name?, workspace?, model?, avatar?,
  tools?: { profile?, allow?, deny? },
  skills?: string[],
  subagents?: { allowAgents?: string[] },
  memoryScope?: string[]
}
```

#### 6.2 修复 agents.delete

当前 `agents.delete` 只删工作空间，不清理 `agents.list` 配置条目。
修复后同时清理 config（或 AgentStore）中的条目。

#### 6.3 heartbeat 改用 cron RPC

```typescript
// 当前：存在 agents.list[].heartbeat
entry.heartbeat = { every: '30m', prompt: '检查状态' }

// 改为：用 cron.add RPC
await bridge.cronAdd({
  name: `heartbeat-${agentId}`,
  agentId,
  schedule: { kind: 'cron', expr: '*/30 * * * *' },
  payload: { kind: 'agentTurn', message: '检查状态' }
});
```

---

## 7. 重构 5：精简桥接层

### 问题

EngineAdapter 648 行中有 20 个纯转发方法（直接调 RPC 无额外逻辑）。
config 操作有 300 行重复的重试逻辑。

### 方案

#### 7.1 纯转发方法 → 路由直调

```typescript
// 当前
// routes/sessions.ts → adapter.sessionsList() → adapter.call('sessions.list')

// 改后
// routes/sessions.ts → adapter.call('sessions.list')
```

删除的纯转发方法（20 个）：
`sessionsList`, `sessionsDelete`, `sessionsReset`, `sessionsCompact`, `sessionsUsage`,
`agentsList`, `agentsCreate`, `agentsUpdate`, `agentsDelete`,
`agentFilesSet`, `agentFilesGet`,
`cronList`, `cronAdd`, `cronRemove`, `cronRun`,
`configGet`, `toolsCatalog`, `modelsList`,
`chatHistory`, `chatAbort`

#### 7.2 config 重试逻辑提取

```typescript
// 当前：configApplyFull, configTransaction, configApply 各含 100 行重试
// 改后：提取 configRetryLoop 公共方法

private async configRetryLoop<T>(fn: () => Promise<T>): Promise<T> {
  return this.configMutex.runExclusive(async () => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try { return await fn(); }
      catch (e) {
        if (this.isRetryable(e) && attempt < maxRetries - 1) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        throw e;
      }
    }
  });
}
```

#### 7.3 预期效果

EngineAdapter: 648 → ~300 行
AgentConfigSync: 546 → 0 行（Agent 配置在 DB 后完全删除）

---

## 8. 重构 6：分布式就绪

### 8.1 存储层

| 存储 | 数据 |
|------|------|
| **MySQL** | User, Agent, ToolSource, AuditLog, SessionMeta |
| **Redis** | JWT 黑名单, 登录锁定, 分布式锁, Pub/Sub, 限流 |
| **NFS/S3** | 工作区文件, JSONL 会话记录, 技能脚本 |

### 8.2 分布式问题及方案

| 问题 | 方案 |
|------|------|
| 会话文件共享 | `sessions.store.path` 指向 NFS 挂载点 |
| SSE 事件传播 | Redis Pub/Sub — agent 事件 publish，各节点 subscribe 匹配本地 SSE |
| Cron 去重 | Redis 分布式锁 `SET cron:{jobId}:lock NX EX 60` |
| IM 单连接 | Redis Leader 选举 `SET im:leader NX EX 30` + 续期 |
| 配置同步 | Agent 在 DB（天然同步），octopus.json 只在启动时读取 |

### 8.3 引擎改造

```typescript
// CronLockProvider 接口（plugin 注册）
interface CronLockProvider {
  tryAcquire(jobId: string, ttlMs: number): Promise<boolean>;
  release(jobId: string): Promise<void>;
}
```

### 8.4 SessionMeta 表（分布式需要）

```prisma
model SessionMeta {
  id           String   @id      // sessionKey
  agentId      String
  ownerId      String
  title        String?
  messageCount Int      @default(0)
  lastActive   DateTime
  storePath    String            // JSONL 文件路径
  nodeId       String?           // 最后处理的节点

  createdAt    DateTime @default(now())
  @@index([ownerId, agentId])
}
```

---

## 9. DB Schema 完整变更

### 新增

```prisma
model ToolSource {
  id          String   @id @default(uuid())
  name        String   @unique
  type        String   // "mcp" | "skill"
  enabled     Boolean  @default(true)
  scope       String   @default("enterprise")
  ownerId     String?
  transport   String?
  command     String?
  args        Json?
  url         String?
  env         Json?
  scriptPath  String?
  runtime     String?
  description String?
  tools       Json?
  config      Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([ownerId, scope])
}

model SessionMeta {
  id           String   @id
  agentId      String
  ownerId      String
  title        String?
  messageCount Int      @default(0)
  lastActive   DateTime
  storePath    String
  nodeId       String?
  createdAt    DateTime @default(now())
  @@index([ownerId, agentId])
}
```

### 修改

```prisma
model Agent {
  // 新增（从 octopus.json 迁入）
  toolsProfile       String?
  toolsAllow         Json?
  toolsDeny          Json?
  subagents          Json?
  memoryScope        Json?
  sandboxMode        String?

  // 替代 toolsFilter + mcpFilter + skillsFilter
  allowedToolSources Json?    // string[] 白名单

  // 删除（不再需要）
  // toolsFilter     ← 被 allowedToolSources 替代
  // mcpFilter       ← 被 allowedToolSources 替代
  // skillsFilter    ← 被 allowedToolSources 替代
}
```

### 删除

```prisma
// MCPServer 表 → 迁移到 ToolSource 后删除
// Skill 表 → 迁移到 ToolSource 后删除
// ScheduledTask 表 → 心跳改用 cron RPC 后评估
```

---

## 10. 代码删除清单

| 模块 | 行数 | 替代 |
|------|------|------|
| `packages/engine/src/memory/` | ~19,000 | memory-lancedb-pro plugin |
| `AgentConfigSync.ts` | 546 | PrismaAgentStore + 扩展 RPC |
| `EngineAdapter` 纯转发 | ~200 | 路由直调 RPC |
| `EngineAdapter` 重复重试 | ~200 | 提取公共方法 |
| `TenantEngineAdapter.ts` | 65 | DB WHERE 查询 |
| config deny 计算 | ~200 | 白名单模型 |
| `packages/quota/` | ~9,000 | 未使用，直接删 |
| `packages/rag/` | ~800 | 未使用，直接删 |
| **合计** | **~30,000** | |

---

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| AgentStore 接口改引擎，上游合并困难 | 接口最小化（5 个方法），独立文件 |
| ToolSource 合并影响前端两个页面 | 渐进式：先后端统一，前端暂保留两个入口 |
| 删原生 memory 后引擎测试失败 | 只删实现文件，保留 stub（类型导出） |
| 分布式 NFS 性能 | 先验证单机 NFS，必要时改 S3 |
| 白名单模型迁移期间权限不一致 | 迁移脚本自动转换 filter → allowedToolSources |

---

## 12. 成功指标

- [ ] AgentConfigSync.ts 完全删除
- [ ] Agent 配置 DB 单源，无 octopus.json 双写
- [ ] MCPServer + Skill 表合并为 ToolSource
- [ ] Agent 权限从 3 套 filter 变为 1 个 allowedToolSources
- [ ] 原生 memory 19K 行删除
- [ ] EngineAdapter 从 648 行降到 ~300 行
- [ ] 2 节点分布式部署通过功能测试
- [ ] 聊天延迟无显著增加
