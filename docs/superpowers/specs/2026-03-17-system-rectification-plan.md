# Octopus 系统整改方案

> 基于 OpenClaw 官方文档学习 + 两轮深度代码分析，制定的分阶段整改方案。

---

## 背景

Octopus 企业版基于 OpenClaw 原生引擎开发，当前存在以下系统性问题：

1. **死代码残留**：约 1700 行已废弃但未清理的代码
2. **安全配置缺失**：Docker sandbox 在引擎层未激活，exec 在宿主机裸跑
3. **代码重复严重**：chat.ts 67KB+ 职责过重、enterprise-mcp 插件 4 个重复 execute 函数、个人 MCP CRUD 双入口
4. **性能问题**：每条消息 4+ 次 DB 查询（无缓存）、启动时 Agent 串行同步、委派结果暴力轮询
5. **配置管理混乱**：SystemConfigPage 与原生 Control UI 双入口冲突、configApplyFull 全量替换有丢失风险
6. **原生能力未充分利用**：工具 deny 列表、IDENTITY.md creature/vibe 字段、技能状态双写同步等

## 整改策略

采用**分阶段回归原生**策略（方案 B），分 3 个阶段逐步推进，每阶段独立可交付、可回滚。

---

## 阶段 1：清理 + 安全 + 快速修复

**目标**：消除死代码、激活安全配置、修复所有低风险的具体问题。

### 1.1 删除死代码（约 1700 行）

| 文件 | 行数 | 原因 |
|------|------|------|
| `apps/server/src/services/OctopusBridge.ts` | 657 | 已被 EngineAdapter 完全替代，仅测试引用 |
| `apps/console/src/pages/McpPage.tsx` | 426 | 未被路由引用，已被 McpSettingsPage 替代 |
| `apps/console/src/pages/SkillsPage.tsx` | 530 | 未被路由引用，已被 SkillsSettingsPage 替代 |
| `HeartbeatForwarder` 相关代码 | ~100 | 已标注 @deprecated，从未收到事件 |

附带：将 `OctopusBridge.test.ts` 中静态方法测试迁移到 `EngineAdapter.test.ts`。

### 1.2 引擎 exec 沙箱化

在 `octopus.json` 中补充缺失的 sandbox 配置：

```json
{
  "tools": {
    "exec": { "host": "sandbox" }
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "agent",
        "docker": { "image": "octopus-sandbox:enterprise" }
      }
    }
  }
}
```

前提：确认 Docker 镜像已构建（`docker/sandbox/build.sh`）、`octopus-internal` 网络已就绪（`docker/sandbox/setup-network.sh`）。

注意：此配置仅影响引擎的 exec 工具（agent 执行 bash 命令），不影响 `run_skill` 插件工具（企业技能由管理员编写，信任级别高，沙箱化降级到阶段 3）。

### 1.3 前端禁用空转功能

- 导出历史按钮加 `disabled` + tooltip "功能开发中"（后端返回 501）
- 搜索历史输入框加 `disabled` + placeholder "功能开发中"（后端返回空结果）

### 1.4 chat.ts 快速修复（6 项）

**1.4.1 `loadAgent` 单次请求只查一次**

当前流式路由中附件处理、斜杠命令、主流程各调一次 `loadAgent`，共 3 次相同 DB 查询。
修复：入口处查一次，结果传递给所有下游函数。

**1.4.2 标题生成去重**

当前后端 `done` 事件异步调 `autoGenerateTitle`，前端 SSE 读完后又调 `generateTitle` API，两次并发导致 `label already in use` 冲突。
修复：删除前端的 `generateTitle` 调用，只保留后端触发。

**1.4.3 `ensureNativeAgent` 的 `sleep(2000)` 替换**

当前用固定 2 秒延时等待 config reload。
修复：改为轮询就绪状态，最多 5 次 × 500ms，超时报错。

**1.4.4 附件处理函数提取**

流式/非流式路由各有 ~40 行相同的附件处理逻辑。
修复：提取 `processAttachments(files, workspace)` 共享函数。

**1.4.5 `sessionPrefs` 加 TTL 过期**

当前进程级 Map 只有 size 上限 2000，无过期清理。
修复：加 30 分钟 TTL，session 过期后自动清理。

**1.4.6 SSE 解析加行缓冲区**

当前 `chunk.split('\n')` 直接解析，TCP 分片可能把一个 `data:` 切成两个 chunk。
修复：前端加 `buffer += chunk`，按 `\n\n` 切割完整事件再解析。

### 1.5 agents.ts 快速修复（4 项）

**1.5.1 删除 Agent 时清理 native config entry**

当前 `agents.list` 中的配置记录在删除后仍残留。
修复：删除时同步移除 octopus.json 中对应 entry。

**1.5.2 `ensureDefaultAgent` 只执行一次**

当前每次 `GET /api/agents` 都触发（3 次 DB 查询 + 可能的 INSERT）。
修复：加内存标记 `defaultChecked[userId]`，每用户只查一次。

**1.5.3 SOUL.md 按需加载**

当前 `GET /api/agents/:id/config` 并行读 7 个文件 RPC，前端只用 SOUL.md。
修复：支持 `?file=SOUL.md` 参数，只读一个文件。

**1.5.4 前端乐观更新**

当前创建/编辑/删除后都 `loadData()` 重新拉整个列表。
修复：直接操作 React state（`setAgents(prev => ...)`），POST/PUT 响应已返回完整对象。

### 1.6 其他快速修复（4 项）

**1.6.1 `refreshToken` 改查 MySQL**

当前依赖 InMemoryUserStore，进程重启后失效，强制用户重新登录。
修复：`authService.refreshToken` 中 `userStore.findById` 改为 `prisma.user.findUnique`。

**1.6.2 Dashboard dailyTrend 查询优化**

当前 7 次串行 COUNT 查询。
修复：改为 `GROUP BY DATE(createdAt)` 一条 SQL。

**1.6.3 MCP 信号文件路径统一**

`plugins/mcp/src/index.ts` 用 `__dirname` 相对路径，与 `routes/mcp.ts` 用 `OCTOPUS_STATE_DIR` 不一致。
修复：统一使用 `process.env.OCTOPUS_STATE_DIR`。

**1.6.4 密码迁移逻辑优化**

当前每次启动全量扫描用户表做 bcrypt 迁移检查。
修复：移到独立函数，启动时只跑一次并用内存标记避免重复。

### 阶段 1 验证

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
# agent 执行 whoami 确认在 Docker 容器内
# 发消息确认对话正常、标题只生成一次
# 创建/编辑/删除 Agent 确认列表正确更新
# 查看 Dashboard 确认数据正常
```

---

## 阶段 2：消除重复代码 + 性能优化

**目标**：降低维护成本，解决性能瓶颈。

### 2.1 chat.ts 瘦身拆分

当前 67KB+，承担对话流、会话管理、Token 计费、斜杠命令、MCP 说明、SOUL 渲染、native agent 创建等职责。

拆分为：

| 拆出的模块 | 内容 | 预计行数 |
|-----------|------|---------|
| `routes/sessions.ts` | 会话列表/历史/删除/重置/重命名 | ~200 |
| `services/SystemPromptBuilder.ts` | `buildEnterpriseSystemPrompt` + 缓存 | ~150 |
| `services/ChatUtils.ts` | 附件处理、斜杠命令处理、内容净化 | ~200 |

`chat.ts` 只保留核心：流式/非流式对话入口 + SSE 事件处理。

附带：`buildEnterpriseSystemPrompt` 加 `(userId, agentId)` 维度缓存，TTL 5 分钟，agent 配置变更时 invalidate。

### 2.2 内容净化逻辑统一

当前分散在 4 处（后端 history 路由、前端 filterInternalTags、autoGenerateTitle、cleanSessionTitle），正则各自维护。

统一为：
- 后端 `sanitizeContent(text, type: 'user' | 'assistant' | 'title')` 一个函数
- 前端 `filterInternalTags` 降级为纯展示兜底

### 2.3 enterprise-mcp 插件去重

4 个几乎相同的 execute 函数体（~200 行重复）提取为工厂函数：

```typescript
function createMCPToolExecutor(options: {
  waitForReady: boolean;
  checkMcpFilter: boolean;
  checkAllowedConnections: boolean;
}) → (id, params) => Promise<ToolResult>
```

同时 `getMcpFilter` 和 `getAllowedConnections` 合并为一次 DB 查询（当前每次工具调用最多 2 次独立查询）。

### 2.4 Agent config 写入合并

当前创建/编辑 Agent 时 `syncAllowAgents` + `syncAgentNativeConfig` 各自独立做 config.get → modify → config.set，最多触发 4 次 configApplyFull。

合并为单一函数：

```typescript
async function syncAgentToEngine(userId, agentName, opts: {
  model?: string;
  toolsFilter?: string[];
  updateAllowAgents?: boolean;
}) {
  const config = await bridge.configGetParsed();  // 只读一次
  // 修改 agents.list 中的 model + tools.allow + allowAgents
  await bridge.configApplyFull(config);            // 只写一次
}
```

### 2.5 前端个人 MCP 去重

`McpSettingsPage`（我的工具 Tab）和 `PersonalSettingsPage`（我的 MCP Tab）有 ~300 行重复的个人 MCP CRUD 代码。

提取为 `<PersonalMcpManager />` 共享组件，两处引用同一组件。

### 2.6 启动优化

| 问题 | 修复 |
|------|------|
| Agent 同步串行 RPC（N 个 agent 逐一 await） | `Promise.allSettled` 并发 |
| 启动时全量同步不完整（只恢复 workspace，model/tools 丢失） | 完整读 DB 恢复 model + tools.allow + allowAgents |
| MockLDAP 用户逐个 `registerMockUser` | batch 处理 |

### 2.7 委派轮询优化

子 agent 执行时前端每 5s 全量拉历史（最多 36 次）。

改为轻量检查：
- 新增 `GET /api/chat/sessions/:id/status` — 只返回 `{ completed: boolean, messageCount: number }`
- 前端只在 `completed=true` 或 `messageCount` 变化时才拉完整历史

### 阶段 2 验证

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
npx vitest run
# 核心场景：发消息（含子 agent 委派）、创建 Agent、MCP 管理
# 性能对比：消息发送响应时间、启动耗时
```

---

## 阶段 3：配置管理统一 + 工具权限对齐

**目标**：消除双入口冲突、让权限控制真正生效、状态同步可靠。

### 3.1 SystemConfigPage 作为唯一管理入口

当前 Admin Console 和原生 Control UI 操作同一份 octopus.json，后写覆盖先写。

修复：
- 原生 Gateway 的 token 不对外暴露，Admin Console 作为唯一管理入口
- SystemConfigPage 补齐缺失的配置项（sandbox、subagents、sessions 等）
- 页面顶部加提示："此页面是系统配置的唯一管理入口"

### 3.2 `configApplyFull` 全部替换为 `configApply`

| 调用位置 | 当前 | 改为 |
|---------|------|------|
| `PUT /admin/config/models` | `configApplyFull`（全量替换） | `configApply`（patch） |
| 删除用户（移除 agents.list） | `configApplyFull` | `configApply`（patch） |
| 心跳任务增删改 | `configApplyFull` | `configApply`（patch） |
| `syncAgentToEngine`（阶段 2 合并后） | `configApplyFull` | `configApply`（patch） |

统一走 deep merge 语义，只修改涉及的字段。

### 3.3 工具权限对齐原生 deny 列表

当前 `TOOL_NAME_TO_ENGINE` 多对一映射导致细粒度权限无效。

利用原生 `tools.deny` 列表实现细粒度控制：

| 前端开关 | 引擎工具 | 勾选 | 不勾 |
|---------|---------|------|------|
| list_files | read | allow read | — |
| read_file | read | allow read | — |
| write_file | write | allow write | deny write |
| execute_command | exec | allow exec | deny exec |
| search_files | exec | allow exec | — |

核心原则：`deny` 永远优先于 `allow`。

### 3.4 技能启用状态双写同步

当前 DB 的 `skill.enabled` 与 `octopus.json` 的 `skills.entries` 不联动。

修复：
- `POST /skills/:id/approve` 和 `PUT /skills/:id/enable` 路由中，DB 更新后同步 `skills.entries[skillId].enabled` 到 octopus.json
- `SystemConfigPage` 修改 skills.entries 时，反向同步到 DB
- 统一走 `configApply`（patch）

### 3.5 IDENTITY.md 利用原生 creature/vibe 字段

当前只写 `name` + `emoji`，persona 描述全靠 SOUL.md 文字堆叠。

Agent 创建/编辑时：
- `description` 字段 → IDENTITY.md 的 `creature`
- 新增可选的 `vibe` 字段 → IDENTITY.md 的 `vibe`
- 引擎统一渲染 persona，SOUL.md 专注任务准则

### 3.6 Plugin 配置即时保存

当前两步保存（Dialog 更新 state → 点"保存"写后端），用户易误以为已保存。

改为：Dialog 点"确认"直接调后端 API 保存。同时加"未保存变更"提示。

### 3.7 记忆隔离显式化

当前 `memory-lancedb-pro` 的 `scopes.agentAccess: {}` 空对象，记忆隔离隐式依赖 agent ID 命名规则。

Agent 创建时同步更新 `agentAccess`：
```json
{
  "ent_user-admin_default": ["ent_user-admin_*"],
  "ent_user-test_default": ["ent_user-test_*"]
}
```

### 阶段 3 验证

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
npx vitest run
# 验证：创建 Agent 检查 octopus.json 只修改目标字段
# 验证：工具权限勾选/取消后确认 deny 列表正确
# 验证：技能启用/禁用后确认 DB 和 octopus.json 同步
# 验证：Plugin 配置 Dialog 确认后直接生效
```

---

## 不在整改范围内

以下问题经评估后暂不处理：

| 问题 | 原因 |
|------|------|
| 飞书 IM 迁移到原生通道 | 当前自建方案可控，迁移成本高，中期再评估 |
| `/bind` 密码明文 | 飞书整体不动 |
| MockLDAP 去除 | 涉及认证体系重构，风险高，当前双写工作正常 |
| 企业技能执行沙箱化 | 企业技能由管理员编写，信任级别高 |
| 原生 exec allowlist + safeBins | 已有 Docker sandbox 兜底，优先级低 |
| chat.ts 中 `ensureNativeAgent` 与 agents.ts 的 `syncToNative` 合并 | 阶段 2 拆分 chat.ts 时一并处理 |

## 风险控制

- 每个阶段独立提交，可随时停止
- 每阶段完成后跑类型检查 + 单元测试 + 核心场景手动验证
- 涉及 octopus.json 的修改，`start.sh` 启动前自动备份（已有机制）
