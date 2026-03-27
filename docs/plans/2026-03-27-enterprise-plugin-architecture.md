# Enterprise Plugin Architecture — 去掉 apps/server，全面 Plugin 化

> 状态：设计中 | 日期：2026-03-27

---

## 1. 目标

- **完全删除 `apps/server/`**，所有企业功能通过引擎 plugin 实现
- **前端 `apps/console/` 保留**，plugin 暴露相同 REST API
- **Agent/用户配置迁移到 DB**，消除 octopus.json 双写和 AgentConfigSync
- **分布式就绪**，多实例部署、无状态网关节点

---

## 2. 架构总览

### 当前架构（两层 + 双写）

```
apps/console (React)
       │ REST
       ▼
apps/server (Express, port 18790)    ← 要删掉的
  ├─ Auth (JWT/LDAP)
  ├─ 多租户隔离
  ├─ AgentConfigSync (双写)          ← 痛点
  ├─ SystemPromptBuilder
  ├─ IM 适配
  │        │ 进程内 RPC
  │        ▼
  └─ Engine Gateway (port 19791)
       ├─ Agent Runtime
       ├─ Plugins (audit/mcp/email)
       └─ octopus.json (agents.list) ← 双写目标
```

### 目标架构（单层 + DB 单源）

```
apps/console (React)          IM (飞书/微信)
       │ REST                      │
       ▼                           ▼
Engine Gateway (唯一端口)
  ├─ 原生能力 (sessions, cron, models, health, tools)
  ├─ enterprise-gateway plugin
  │    ├─ JWT Auth + 多租户
  │    ├─ RPC-to-REST 桥接
  │    ├─ Chat 流 (SSE)
  │    ├─ Agent CRUD → DB
  │    ├─ Files / Skills / DB-Connections
  │    └─ Admin / Users
  ├─ enterprise-im plugin
  │    ├─ FeishuAdapter
  │    └─ WeixinAdapter
  ├─ enterprise-mcp plugin (已有)
  ├─ enterprise-audit plugin (已有)
  └─ enterprise-email plugin (已有)
       │         │         │
       ▼         ▼         ▼
    MySQL     Redis     S3/NFS
   (Prisma)  (缓存/锁)  (文件存储)
```

### 分布式部署

```
              Load Balancer (Nginx/Traefik)
             ┌──────┼──────┐
             ▼      ▼      ▼
          Node 1  Node 2  Node 3   ← 无状态网关节点
          (engine + plugins)
             │      │      │
             ▼      ▼      ▼
          ┌──────────────────┐
          │   MySQL (主从)    │  ← Agent/User/Session 元数据
          │   Redis (集群)    │  ← 缓存、分布式锁、Pub/Sub 事件
          │   S3/NFS         │  ← 工作区文件、JSONL 会话存储
          └──────────────────┘
```

---

## 3. 引擎改造：AgentStore 抽象

### 3.1 新增接口

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

export interface AgentConfig {
  id: string;
  tenantId?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  toolsDeny?: string[];
  toolsAllow?: string[];
  toolsProfile?: string;
  heartbeat?: { every: string; prompt: string };
  subagents?: { allowAgents?: string[] };
  memoryScope?: string[];
  sandbox?: { mode?: string };
  [key: string]: unknown;
}
```

### 3.2 注册方式

Plugin 通过新的引擎扩展点注册：

```typescript
// 类似 registerContextEngine，独占槽位
api.registerAgentStore(new PrismaAgentStore(prisma));
```

### 3.3 默认实现（兼容）

```typescript
// packages/engine/src/agents/store-file.ts
// 从 octopus.json agents.list 读写，保持原生 CLI 兼容
class FileAgentStore implements AgentStore { ... }
```

### 3.4 octopus.json 瘦身

移到 DB 的：
- `agents.list` → DB Agent 表
- per-agent 的 `tools.deny/allow`、`heartbeat`、`subagents`、`memoryScope`

保留在 JSON 的：
- `agents.defaults`（系统级默认值）
- `providers`（模型提供商配置）
- `gateway`（网关配置）
- `plugins`（插件配置）
- `tools.exec`（沙箱配置）
- `sandbox`（Docker 配置）
- `sessions`（会话存储配置）

---

## 4. Plugin 设计

### 4.1 enterprise-gateway（核心，新建）

**职责**：认证、路由、多租户、Agent 管理、文件管理

#### 注册的引擎扩展

```typescript
export default function register(api: PluginAPI) {
  // 1. 注册 AgentStore（DB 实现）
  api.registerAgentStore(new PrismaAgentStore(prisma));

  // 2. 注册 HTTP 路由
  registerAuthRoutes(api);        // /api/auth/*
  registerChatRoutes(api);        // /api/chat/*
  registerAgentRoutes(api);       // /api/agents/*
  registerFileRoutes(api);        // /api/files/*
  registerSkillRoutes(api);       // /api/skills/*
  registerAdminRoutes(api);       // /api/admin/*
  registerDbConnectionRoutes(api);// /api/user/db-connections/*
  registerPassthroughRoutes(api); // sessions/cron/models → RPC 桥接

  // 3. 注册 Hook
  api.registerHook('before_prompt_build', enterprisePromptHook);
  api.registerHook('before_agent_start', tenantValidationHook);

  // 4. 注册后台服务
  api.registerService('file-cleanup', fileCleanupService);
  api.registerService('security-monitor', securityMonitorService);
}
```

#### RPC-to-REST 桥接（覆盖 ~60% 路由）

```typescript
const PASSTHROUGH: RouteConfig[] = [
  // Sessions
  { method: 'GET',    path: '/api/chat/sessions',          rpc: 'sessions.list' },
  { method: 'DELETE', path: '/api/chat/history/:id',       rpc: 'sessions.delete' },
  { method: 'GET',    path: '/api/chat/history/:id',       rpc: 'chat.history' },
  { method: 'POST',   path: '/api/chat/sessions/:id/compact', rpc: 'sessions.compact' },
  // Models
  { method: 'GET',    path: '/api/chat/models',            rpc: 'models.list' },
  // Cron
  { method: 'GET',    path: '/api/scheduler/tasks',        rpc: 'cron.list' },
  { method: 'POST',   path: '/api/scheduler/tasks',        rpc: 'cron.create' },
  { method: 'DELETE', path: '/api/scheduler/tasks/:id',    rpc: 'cron.remove' },
  { method: 'POST',   path: '/api/scheduler/tasks/:id/run',rpc: 'cron.run' },
  // Health
  { method: 'GET',    path: '/health',                     rpc: 'health' },
  // Config
  { method: 'GET',    path: '/api/admin/config',           rpc: 'config.get' },
  // Skills
  { method: 'GET',    path: '/api/skills',                 rpc: 'skills.list' },
  // Tools
  { method: 'GET',    path: '/api/tools',                  rpc: 'tools.catalog' },
];

function registerPassthroughRoutes(api: PluginAPI) {
  for (const route of PASSTHROUGH) {
    api.registerHttpRoute({
      path: route.path,
      method: route.method,
      auth: 'plugin',
      handler: async (req, res) => {
        const user = await verifyJwt(req);
        const params = { ...req.params, ...req.query, ...req.body };
        const result = await api.gateway.rpc(route.rpc, params);
        res.json(applyTenantFilter(result, user));
      },
    });
  }
}
```

#### 多租户隔离

```typescript
// Hook: 拦截所有 agent 操作，校验 tenantId
api.registerHook('before_agent_start', async (event, ctx) => {
  const agentConfig = await api.agentStore.get(ctx.agentId);
  if (!agentConfig) return { status: 'error', message: 'Agent not found' };
  // 租户校验在 HTTP 路由层已完成（JWT → userId → tenantId）
  // Hook 层做最终防御
});

// DB 查询天然隔离
class PrismaAgentStore implements AgentStore {
  async list(filter?: { tenantId?: string }) {
    return this.prisma.agent.findMany({
      where: filter?.tenantId ? { ownerId: filter.tenantId } : {},
    });
  }
}
```

#### 企业 Prompt 注入

```typescript
// 替代 SystemPromptBuilder，用 Hook 实现
api.registerHook('before_prompt_build', async (event, ctx) => {
  const userId = extractUserId(ctx.agentId);
  const prompt = await buildEnterprisePrompt(userId, ctx.agentId);
  return { prependSystemContext: prompt };
});
```

### 4.2 enterprise-im（新建）

```typescript
export default function register(api: PluginAPI) {
  // 飞书 WebSocket 长连接
  api.registerService('feishu-adapter', {
    start: async () => { /* 连接飞书开放平台 */ },
    stop: async () => { /* 断开连接 */ },
  });

  // 微信适配
  api.registerService('weixin-adapter', { ... });

  // IM 相关路由
  api.registerHttpRoute({ path: '/api/user/weixin/login', ... });
  api.registerHttpRoute({ path: '/api/user/weixin/status', ... });
  api.registerHttpRoute({ path: '/api/_internal/im/send', ... });
}
```

### 4.3 已有 plugin 改造

**enterprise-mcp**：增加 HTTP 路由

```typescript
// 当前：只注册 Hook + Tool
// 新增：MCP 管理的 REST API
api.registerHttpRoute({ path: '/api/mcp/servers', method: 'GET', ... });
api.registerHttpRoute({ path: '/api/mcp/servers', method: 'POST', ... });
api.registerHttpRoute({ path: '/api/mcp/servers/:id', method: 'PUT', ... });
api.registerHttpRoute({ path: '/api/mcp/servers/:id', method: 'DELETE', ... });
api.registerHttpRoute({ path: '/api/mcp/servers/:id/test', method: 'POST', ... });
```

**enterprise-audit**：增加查询路由

```typescript
api.registerHttpRoute({ path: '/api/audit/logs', method: 'GET', ... });
api.registerHttpRoute({ path: '/api/audit/export', method: 'GET', ... });
api.registerHttpRoute({ path: '/api/audit/stats', method: 'GET', ... });
```

**enterprise-email**：不变。

---

## 5. 分布式设计

### 5.1 无状态网关节点

每个节点是引擎 gateway + enterprise plugins 的完整实例。
节点间不直接通信，所有共享状态通过外部存储。

### 5.2 存储层职责

| 存储 | 职责 | 数据 |
|------|------|------|
| **MySQL** | 持久化业务数据 | User, Agent, Skill, MCPServer, AuditLog, Session 元数据 |
| **Redis** | 缓存 + 协调 | JWT 黑名单, 登录锁定, 分布式锁, Pub/Sub 事件, 限流计数 |
| **S3/NFS** | 文件存储 | 工作区文件, JSONL 会话记录, Skill 脚本, 审计日志文件 |

### 5.3 分布式关键问题

#### A. 会话存储

```
当前：本地 JSONL 文件
问题：多节点无法共享会话

方案：SessionStore 抽象（类似 AgentStore）
  - 默认实现：本地文件（单机兼容）
  - 分布式实现：S3/NFS 共享目录
  - 引擎已有 sessions 配置：sessions.store.path
  - 指向 NFS 挂载点即可，无需改代码
```

#### B. 事件传播

```
当前：进程内事件（EventEmitter）
问题：SSE 客户端连在 Node 1，agent 可能在 Node 2 执行

方案：Redis Pub/Sub
  - agent 事件 → publish 到 Redis channel
  - 所有节点 subscribe → 匹配本地 SSE 连接 → 推送

  enterprise-gateway plugin 实现：
    api.registerService('event-relay', {
      start: async () => {
        redis.subscribe('agent:events', (msg) => {
          const { sessionKey, event } = JSON.parse(msg);
          localSseConnections.get(sessionKey)?.write(event);
        });
      }
    });
```

#### C. Cron 执行（只执行一次）

```
当前：引擎内置 cron，单实例运行
问题：多实例会重复执行

方案：Redis 分布式锁
  - Cron 触发前获取锁：SET cron:{jobId}:lock NX EX 60
  - 获取成功才执行
  - 引擎层改造：cron runner 支持 lockProvider 接口

  interface CronLockProvider {
    tryAcquire(jobId: string, ttlMs: number): Promise<boolean>;
    release(jobId: string): Promise<void>;
  }
```

#### D. IM 连接（单实例）

```
当前：飞书 WebSocket 连接在 apps/server
问题：多实例会建立多条 WebSocket，飞书会拒绝

方案：Leader 选举
  - Redis SET im:leader NX EX 30 + 续期
  - 只有 leader 节点运行 FeishuAdapter
  - Leader 故障 → 30s 后其他节点接管
```

#### E. 配置变更通知

```
当前：octopus.json 文件变更 → fs.watch
问题：多节点各自的 octopus.json 不同步

方案一（推荐）：Agent 配置已在 DB，JSON 配置很少改
  - octopus.json 作为启动配置，运行时不变
  - Agent 变更通过 DB + Redis Pub/Sub 通知

方案二：etcd/consul 存储配置
  - 过度设计，暂不需要
```

### 5.4 部署拓扑

#### 单机开发

```
./start.sh
  → octopus gateway run --config .octopus-state/octopus.json
  → 加载 enterprise-* plugins
  → SQLite (或本地 MySQL)
  → 本地 Redis
  → 本地文件系统
```

#### 生产分布式

```yaml
# docker-compose.yml
services:
  gateway-1:
    image: octopus-gateway
    environment:
      DB_URL: mysql://...
      REDIS_URL: redis://...
      STORAGE_PATH: /mnt/nfs/octopus
    volumes:
      - nfs:/mnt/nfs/octopus

  gateway-2:
    image: octopus-gateway
    # 同上

  mysql:
    image: mysql:8

  redis:
    image: redis:7

  nginx:
    image: nginx
    # upstream gateway-1, gateway-2
```

---

## 6. 数据库 Schema 变更

### 6.1 Agent 表扩展

```prisma
model Agent {
  id            String   @id
  ownerId       String   // 租户 ID
  name          String
  displayName   String?
  model         String?
  provider      String?
  systemPrompt  String?  @db.Text
  avatar        String?

  // 从 octopus.json 迁移过来的配置
  toolsProfile  String?           // "default" | "minimal" | "full"
  toolsAllow    Json?             // string[]
  toolsDeny     Json?             // string[]
  heartbeat     Json?             // { every, prompt }
  subagents     Json?             // { allowAgents }
  memoryScope   Json?             // string[]
  sandboxMode   String?           // "all" | "none"

  // 企业字段
  toolsFilter       Json?         // 前端工具白名单
  mcpFilter         Json?         // MCP 白名单
  skillsFilter      Json?         // 技能白名单
  allowedConnections Json?        // DB 连接白名单

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([ownerId, name])
}
```

### 6.2 新增 Session 元数据表（可选，分布式需要）

```prisma
model SessionMeta {
  id          String   @id           // sessionKey
  agentId     String
  ownerId     String
  title       String?
  messageCount Int     @default(0)
  lastActive  DateTime
  storePath   String                 // JSONL 文件路径
  nodeId      String?                // 最后处理的节点 ID

  createdAt   DateTime @default(now())

  @@index([ownerId, agentId])
}
```

---

## 7. 迁移策略

### Phase 0：引擎改造（前置）
1. 新增 `AgentStore` 接口 + 默认文件实现
2. 新增 `registerAgentStore` 扩展点
3. 新增 `CronLockProvider` 接口（分布式 cron）
4. 引擎 gateway HTTP server 支持 plugin 的 CORS 配置
5. **验证**：引擎原生功能不受影响

### Phase 1：enterprise-gateway plugin（核心）
1. 创建 plugin 骨架，初始化 Prisma
2. 实现 JWT 认证（从 packages/auth 迁移）
3. 实现 RPC-to-REST 桥接（60% 路由直通）
4. 实现 PrismaAgentStore（Agent 配置读写）
5. 迁移 chat/stream 路由（SSE + prompt 注入）
6. 迁移 Agent CRUD 路由
7. 迁移 files/skills/db-connections 路由
8. 迁移 admin 路由
9. **验证**：前端对接 plugin 路由，功能一致

### Phase 2：已有 plugin 扩展
1. enterprise-mcp 增加 REST 路由
2. enterprise-audit 增加查询路由
3. **验证**：MCP 管理和审计查询正常

### Phase 3：enterprise-im plugin
1. 从 apps/server/services/im/ 提取
2. 实现 registerService（FeishuAdapter, WeixinAdapter）
3. 实现 leader 选举（分布式部署时）
4. **验证**：飞书/微信消息收发正常

### Phase 4：删除 apps/server
1. 更新 start.sh → 直接启动引擎 gateway
2. 更新前端 API base URL
3. 删除 apps/server/ 目录
4. 删除 packages/auth/（逻辑已迁入 plugin）
5. 删除 packages/workspace/（逻辑已迁入 plugin）
6. 清理 package.json 依赖
7. **验证**：全功能回归测试

### Phase 5：分布式验证
1. Docker Compose 多实例部署
2. 验证 SSE 事件传播（Redis Pub/Sub）
3. 验证 Cron 不重复执行（分布式锁）
4. 验证 IM 单连接（Leader 选举）
5. 验证会话存储共享（NFS/S3）
6. 负载测试

---

## 8. 删除清单

完成后可删除的代码：

| 模块 | 行数 | 替代方式 |
|------|------|---------|
| `apps/server/` | ~8,000 | enterprise-gateway plugin |
| `packages/auth/` | ~1,500 | plugin 内 AuthService |
| `packages/workspace/` | ~500 | plugin 内 WorkspaceManager |
| `packages/database/` | ~100 | plugin 内 Prisma |
| `packages/audit/` | ~500 | enterprise-audit plugin |
| `packages/quota/` | ~9,000 | 未使用，直接删 |
| `packages/rag/` | ~800 | 未使用，直接删 |
| `packages/skills/` | ~300 | plugin 内实现 |
| `AgentConfigSync.ts` | 546 | PrismaAgentStore 替代 |
| `EngineAdapter.ts` | 648 | 引擎原生 RPC |
| `TenantEngineAdapter.ts` | 65 | DB WHERE 查询 |
| `SystemPromptBuilder.ts` | 167 | Hook 实现 |
| **合计** | **~22,000** | |

---

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Plugin HTTP 路由不支持中间件链 | 每个路由重复 auth 代码 | 封装 `withAuth(handler)` 工具函数 |
| 引擎 registerHttpRoute 不支持 SSE | chat/stream 无法实现 | 验证 response 对象是否支持流式写入 |
| Plugin 间共享 Prisma 实例 | 多 plugin 各自创建连接 | 通过引擎 Symbol 或 plugin config 共享 |
| JSONL 会话文件不支持并发写 | 分布式下会话损坏 | Session affinity 或 NFS 文件锁 |
| 引擎上游更新破坏 AgentStore 接口 | 升级困难 | 接口最小化，版本锁定 |
| 迁移期间双系统运行 | 状态不一致 | Phase 1-3 并行运行旧系统，Phase 4 一次性切换 |

---

## 10. 成功指标

- [ ] `apps/server/` 目录完全删除
- [ ] 前端功能 100% 正常（对照当前功能清单）
- [ ] 单端口运行（不再有 18790 + 19791 双端口）
- [ ] Agent 配置单源（DB），无 octopus.json 双写
- [ ] 2 节点部署通过全功能测试
- [ ] 聊天延迟无显著增加（< 50ms overhead）
