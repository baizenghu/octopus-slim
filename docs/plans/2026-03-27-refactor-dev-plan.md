# Octopus 架构重构 — 详细开发计划

> 基于 `2026-03-27-enterprise-plugin-architecture.md` 设计文档
> 预计 6 个 Phase，按依赖顺序执行

---

## Phase 1：引擎精简 — 删原生 memory + 未用包（~30K 行）

**前置依赖**：无
**风险**：低（删的都是不用的代码）
**验证方式**：tsc --noEmit + 网关启动 + 聊天测试

### 任务清单

#### 1.1 删除原生 memory 模块
- [ ] 分析 `packages/engine/src/memory/` 所有文件的外部引用
- [ ] 对有外部引用的文件创建 stub（保留类型导出）
- [ ] 删除 memory/ 下所有实现文件（~60 个文件，19K 行）
- [ ] 修改 `plugins/runtime/runtime-tools.ts`：移除 `registerMemoryCli` 调用
- [ ] 修改 `cli/memory-cli.ts`：stub 化或删除
- [ ] 修改 config schema：保留 `memory.*` 字段定义（plugin 使用），删除原生 memory 初始化
- [ ] 验证 memory-lancedb-pro plugin 正常工作（记忆写入/搜索）

#### 1.2 删除未使用的 packages
- [ ] 删除 `packages/rag/`（~800 行，零引用）
- [ ] 删除 `packages/quota/`（~9,000 行，零导入）
- [ ] 更新根 `package.json` 和 `pnpm-workspace.yaml`
- [ ] 验证编译和启动

#### 1.3 验证
- [ ] `npx tsc --noEmit` 零错误
- [ ] 网关启动正常
- [ ] 聊天功能正常
- [ ] memory-lancedb-pro 记忆读写正常
- [ ] 提交 + tag `slim-phase1`

---

## Phase 2：扩展引擎 RPC — agents.update 增强

**前置依赖**：无（可与 Phase 1 并行）
**风险**：中（改引擎源码）
**验证方式**：引擎单元测试 + 企业层调用测试

### 任务清单

#### 2.1 扩展 agents.update schema
- [ ] 读取 `packages/engine/src/gateway/server-methods/agents-models-skills.ts`
- [ ] 在 AgentsUpdateParamsSchema 中新增：
  ```
  tools?: { profile?, allow?, deny? }
  skills?: string[]
  subagents?: { allowAgents?: string[] }
  ```
- [ ] 实现处理逻辑：写入 octopus.json agents.list 对应字段
- [ ] 编写测试

#### 2.2 修复 agents.delete
- [ ] 读取 `packages/engine/src/gateway/server-methods/agents.ts` delete 方法
- [ ] 添加逻辑：删除 agent 时同时清理 `agents.list` 中的配置条目
- [ ] 编写测试

#### 2.3 heartbeat → cron 迁移准备
- [ ] 确认 `cron.add` RPC 参数能完全表达 heartbeat 语义
- [ ] 编写 heartbeat-to-cron 转换函数
- [ ] 编写测试

#### 2.4 验证
- [ ] 引擎 vitest 测试通过
- [ ] 企业层调用扩展后的 RPC 正常
- [ ] 提交 + tag `slim-phase2`

---

## Phase 3：精简桥接层 — EngineAdapter + AgentConfigSync

**前置依赖**：Phase 2（需要扩展后的 RPC）
**风险**：中（改核心桥接代码）
**验证方式**：全功能回归测试

### 任务清单

#### 3.1 EngineAdapter 精简
- [ ] 删除 20 个纯转发方法，路由改为 `adapter.call('rpc.method', params)` 直调
- [ ] 更新所有路由文件（sessions.ts, agents.ts, scheduler.ts 等）的调用方式
- [ ] 提取 config 重试逻辑为 `configRetryLoop` 公共方法（300 行→50 行）
- [ ] 验证所有路由功能不变

#### 3.2 AgentConfigSync 精简
- [ ] model 同步：改用 `agents.update` RPC（删除 config.set model 逻辑）
- [ ] heartbeat 同步：改用 `cron.add/remove` RPC（删除 config.set heartbeat 逻辑）
- [ ] tools 同步：改用扩展的 `agents.update` RPC（删除 config.set tools 逻辑）
- [ ] skills 同步：改用扩展的 `agents.update` RPC（删除 config.set skills 逻辑）
- [ ] subagents 同步：改用扩展的 `agents.update` RPC
- [ ] 评估 memory scope 同步是否仍需通过 config.set
- [ ] 预期：AgentConfigSync 从 546 行降到 ~100 行（仅保留 memory scope）

#### 3.3 TenantEngineAdapter 精简
- [ ] 评估是否可以合并到路由层的 auth middleware
- [ ] 客户端过滤改为路由层直接用 userId 参数调 RPC

#### 3.4 验证
- [ ] Agent 创建/更新/删除正常
- [ ] 心跳定时任务正常
- [ ] 工具权限正常
- [ ] 多租户隔离正常
- [ ] 提交 + tag `slim-phase3`

---

## Phase 4：统一工具源模型 — 合并 MCP + Skills

**前置依赖**：Phase 3（桥接层稳定后再改数据模型）
**风险**：高（DB 迁移 + 前后端同改）
**验证方式**：MCP 工具调用 + Skill 执行 + 权限验证

### 任务清单

#### 4.1 创建 ToolSource 表
- [ ] 编写 Prisma migration：创建 ToolSource 表
- [ ] 编写数据迁移脚本：MCPServer → ToolSource (type='mcp')
- [ ] 编写数据迁移脚本：Skill → ToolSource (type='skill')
- [ ] 验证迁移数据完整性

#### 4.2 Agent 白名单模型
- [ ] Agent 表新增 `allowedToolSources` 字段
- [ ] 编写迁移脚本：从 mcpFilter + skillsFilter 转换为 allowedToolSources
  ```
  旧: mcpFilter=["高德地图"], skillsFilter=["数据分析"]
  新: allowedToolSources=["高德地图", "数据分析"]
  ```
- [ ] 删除 Agent 表的 toolsFilter / mcpFilter / skillsFilter 字段（migration）

#### 4.3 后端路由合并
- [ ] 新建 `routes/tool-sources.ts`：统一的 CRUD API
  ```
  GET    /api/tool-sources          # 列表（支持 type 筛选）
  POST   /api/tool-sources          # 创建
  PUT    /api/tool-sources/:id      # 更新
  DELETE /api/tool-sources/:id      # 删除
  POST   /api/tool-sources/:id/test # 测试连接
  ```
- [ ] 迁移 enterprise-mcp plugin 的权限过滤逻辑：读 allowedToolSources 替代 mcpFilter
- [ ] 迁移技能启用/禁用逻辑
- [ ] 删除 `routes/mcp.ts`（迁移完成后）
- [ ] 删除 `routes/skills.ts` 中的 MCP 相关逻辑

#### 4.4 AgentConfigSync 权限计算简化
- [ ] 替换 computeNativeDeny + computeMcpDeny + computeSkillDeny
- [ ] 新逻辑：读 allowedToolSources → 查 ToolSource → 生成 tools.allow
- [ ] 预期：200 行 → 20 行

#### 4.5 前端改造
- [ ] 新建"工具源管理"统一页面（或修改 MCP 页面支持 skill 类型）
- [ ] Agent 编辑页：3 个 filter 选择器 → 1 个 allowedToolSources 多选
- [ ] 保留后向兼容：旧 API 路径暂时重定向到新路径

#### 4.6 清理
- [ ] 删除 MCPServer 表（确认数据已迁移）
- [ ] 删除 Skill 表（确认数据已迁移）
- [ ] 删除旧路由文件
- [ ] 删除 AgentConfigSync 中的旧 filter 计算代码

#### 4.7 验证
- [ ] MCP 工具调用正常（数据库连接器、高德地图、OA 系统）
- [ ] Skill 执行正常
- [ ] 白名单权限控制正确（允许的能用，不允许的被拒绝）
- [ ] 前端管理界面正常
- [ ] 提交 + tag `slim-phase4`

---

## Phase 5：Agent 配置存 DB — AgentStore

**前置依赖**：Phase 3（桥接层精简后）+ Phase 4（ToolSource 稳定后）
**风险**：高（改引擎核心 + 数据迁移）
**验证方式**：全功能回归 + 压力测试

### 任务清单

#### 5.1 引擎 AgentStore 接口
- [ ] 创建 `packages/engine/src/agents/store.ts`：定义 AgentStore 接口
- [ ] 创建 `packages/engine/src/agents/store-file.ts`：默认文件实现
- [ ] 在 plugin types 中添加 `registerAgentStore` 方法
- [ ] 修改引擎 agent 运行时：从 AgentStore 读取 agent 配置（替代从 config.agents.list 读取）
- [ ] 修改 gateway server-methods/agents.ts：通过 AgentStore 操作
- [ ] 编写测试：FileAgentStore 行为与当前一致

#### 5.2 PrismaAgentStore 实现
- [ ] 创建 enterprise plugin 的 PrismaAgentStore
- [ ] Agent 表扩展（toolsProfile, toolsAllow, toolsDeny, subagents, memoryScope, sandboxMode）
- [ ] 编写 Prisma migration
- [ ] 实现 list/get/create/update/delete 方法
- [ ] 实现 onChanged 回调（用于缓存失效）

#### 5.3 数据迁移
- [ ] 编写迁移脚本：从 octopus.json agents.list → Agent DB 表
- [ ] 处理字段映射：JSON config 字段 → DB 列
- [ ] 验证迁移数据完整性
- [ ] 清理 octopus.json 中的 agents.list

#### 5.4 注册 AgentStore
- [ ] enterprise-audit 或 enterprise-gateway plugin 中注册 PrismaAgentStore
- [ ] 验证引擎通过 AgentStore 读取 agent 配置
- [ ] 验证 agent 创建/更新/删除通过 AgentStore 写入 DB

#### 5.5 删除遗留代码
- [ ] 删除 AgentConfigSync.ts 剩余代码（memory scope 也改用 AgentStore）
- [ ] 删除 EngineAdapter 中的 config.set agents 相关逻辑
- [ ] 删除 TenantEngineAdapter.ts（DB WHERE 替代客户端过滤）

#### 5.6 验证
- [ ] Agent CRUD 全流程正常
- [ ] 多租户隔离正常（DB 查询 WHERE ownerId = ?）
- [ ] 聊天功能正常
- [ ] 心跳/定时任务正常
- [ ] octopus.json 无 agents.list 字段
- [ ] 压力测试：并发 agent 操作无冲突
- [ ] 提交 + tag `slim-phase5`

---

## Phase 6：分布式就绪

**前置依赖**：Phase 5（Agent 在 DB 后才有意义）
**风险**：中
**验证方式**：多节点部署 + 功能测试

### 任务清单

#### 6.1 Redis 集成
- [ ] 引入 ioredis 依赖（enterprise plugin）
- [ ] 实现 Redis 连接管理（连接池、重连、降级）
- [ ] 迁移 JWT 黑名单到 Redis（当前进程内 Set）
- [ ] 迁移登录锁定到 Redis（当前已在 Redis）
- [ ] 实现分布式限流（当前进程内计数器）

#### 6.2 事件传播 — Redis Pub/Sub
- [ ] 实现 EventRelay 服务：
  - agent 事件 → Redis PUBLISH `octopus:agent:events`
  - 各节点 SUBSCRIBE → 匹配本地 SSE 连接 → 推送
- [ ] 修改 EngineAdapter.callAgent：事件发布到 Redis
- [ ] 修改 chat.ts SSE handler：从 Redis 订阅
- [ ] 验证：Node 1 发起聊天，Node 2 的 SSE 能收到事件

#### 6.3 Cron 分布式锁
- [ ] 引擎新增 CronLockProvider 接口
- [ ] 实现 RedisCronLockProvider：
  ```
  tryAcquire: SET cron:{jobId}:lock {nodeId} NX EX {ttl}
  release: DEL cron:{jobId}:lock (仅 owner 可删)
  ```
- [ ] 在 enterprise plugin 中注册
- [ ] 验证：两节点只有一个执行 cron job

#### 6.4 IM Leader 选举
- [ ] 实现 RedisLeaderElection：
  ```
  acquire: SET im:leader {nodeId} NX EX 30
  renew: EXPIRE im:leader 30 (每 10s)
  check: GET im:leader === myNodeId
  ```
- [ ] 只有 leader 节点启动 FeishuAdapter / WeixinAdapter
- [ ] leader 故障 → 30s 后其他节点接管
- [ ] 验证：杀掉 leader 节点后 IM 自动恢复

#### 6.5 会话存储共享
- [ ] 配置 `sessions.store.path` 指向 NFS 挂载点
- [ ] 验证 JSONL 文件在 NFS 上正常读写
- [ ] 测试并发写入同一 session 的行为
- [ ] 如有冲突，实现文件锁或 session affinity

#### 6.6 部署验证
- [ ] 编写 docker-compose.yml（2 gateway + MySQL + Redis + NFS）
- [ ] 编写自动化测试脚本：
  - 创建 agent（Node 1）→ 列出 agent（Node 2）→ 聊天（Node 1）→ 查历史（Node 2）
  - Cron 不重复执行
  - IM 单连接
  - 节点故障恢复
- [ ] 负载测试：100 并发聊天
- [ ] 提交 + tag `slim-phase6`

---

## 执行顺序与并行关系

```
Phase 1 ─────────────────────┐
(删 memory + 未用包)          │
                              ├─→ Phase 3 ──→ Phase 4 ──→ Phase 5 ──→ Phase 6
Phase 2 ─────────────────────┘    (精简桥接)   (ToolSource) (AgentStore) (分布式)
(扩展 RPC)
```

- Phase 1 和 Phase 2 可并行
- Phase 3 依赖 Phase 2
- Phase 4 依赖 Phase 3
- Phase 5 依赖 Phase 3 + 4
- Phase 6 依赖 Phase 5

---

## 各 Phase 预计影响

| Phase | 删除行数 | 新增行数 | 净减 | 复杂度 |
|-------|---------|---------|------|--------|
| 1 | ~30,000 | ~200 (stub) | ~29,800 | 低 |
| 2 | 0 | ~300 (RPC 扩展) | -300 | 中 |
| 3 | ~900 | ~100 | ~800 | 中 |
| 4 | ~2,000 | ~800 | ~1,200 | 高 |
| 5 | ~1,500 | ~600 | ~900 | 高 |
| 6 | 0 | ~1,500 | -1,500 | 中 |
| **合计** | **~34,400** | **~3,500** | **~30,900** | |
