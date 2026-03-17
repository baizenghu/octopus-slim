# Octopus 系统审计报告：基于 OpenClaw 原生能力对照分析

> 审计日期：2026-03-17
> 审计范围：Octopus 企业版全部模块 vs OpenClaw 官方文档（docs.openclaw.ai）
> 审计方法：7 个 agent 并行学习 120+ 页官方文档 → 6 个 agent 并行代码分析 → 4 个 agent 前端操作链路分析

---

## 一、审计概述

Octopus 企业版基于 OpenClaw（原名 Clawd）原生引擎开发，通过企业网关层（Express:18790）代理原生 Gateway（:19791），提供多租户隔离、JWT 认证、RBAC、审计日志等企业能力。

本次审计对照 OpenClaw 官方文档，从以下维度逐模块分析：
1. 哪些功能原生已支持，企业层重复实现了？
2. 哪些原生能力未被充分利用？
3. 哪些实现存在安全、性能或架构问题？

**审计结论**：发现 **P0 级问题 2 个、P1 级问题 10 个、P2 级问题 12 个、P3 级问题 6 个**，死代码约 1700 行，重复代码约 800 行。

---

## 二、架构层面发现

### 2.1 企业层定位偏移

企业层设计目标是"策略层"（多租户鉴权 + 策略配置），但实际演变为"代理层"——重新实现了原生引擎已有的能力。

**根因**：2026-02 的 native-alignment 重构采用"最小侵入"策略，保留了企业层的 IM、调度、认证等代码，仅把 agent 调用替换为 RPC 桥接。

| 功能 | 原生支持 | 企业层状态 | 评价 |
|------|---------|-----------|------|
| 飞书 IM | 原生 `channels/feishu-native/`（90 个源文件） | 自建 FeishuAdapter（~400 行），仅支持私聊文本 | **重复且功能弱于原生** |
| 聊天 SSE | `/v1/chat/completions` + `/v1/responses` | 完全重写 SSE 流式推送 | **必要的重复**（需注入企业 system prompt） |
| 配置管理 UI | Control UI Config 标签页 | SystemConfigPage（1185 行） | **双入口冲突** |
| 斜杠命令 | 原生命令系统（/new /reset /stop 等） | 自建命令处理（/mcp /skill /help） | **部分重复，原生命令被屏蔽** |
| 定时任务 | 原生 Cron + Heartbeat | 企业 DB 表 + configApplyFull 同步 | **双层封装** |
| 会话管理 | 原生 sessions.* RPC | 企业层代理 + namespace 过滤 | **代理合理，但过滤可简化** |
| 审计日志 | 原生 JSON Lines 文件日志 | enterprise-audit 插件（DB + JSONL + HMAC） | **必要扩展**，原生不满足企业审计需求 |
| 认证 | token/password/trusted-proxy/tailscale | JWT + MockLDAP + RBAC | **必要扩展**，原生是单用户模型 |

### 2.2 数据双权威源问题

Agent 状态同时维护在两处，同步逻辑复杂且不完整：

| 数据 | 企业 DB（Prisma） | 原生 octopus.json |
|------|-----------------|------------------|
| Agent 基本信息 | name, description, model, enabled | id, workspace, model |
| 工具权限 | toolsFilter, mcpFilter, skillsFilter | tools.allow, tools.deny |
| 身份信息 | identity (name, emoji) | IDENTITY.md 文件 |
| 系统提示 | systemPrompt 字段 | SOUL.md 文件 |
| 允许调用 | — | subagents.allowAgents |

同步方向：DB → 原生（单向），由 `syncToNative`/`syncAllowAgents`/`syncAgentNativeConfig`/`syncToolsMd` 4 个函数维护。

**已知同步缺陷**：
- 启动时只恢复 workspace 路径，model/tools.allow/allowAgents 丢失
- 删除 Agent 后 `agents.list` 中的 config entry 残留
- 创建时最多触发 4 次 RPC（2 次读 + 2 次写），有 hash 冲突风险

---

## 三、安全审计

### 3.1 P0 — 安全漏洞

#### P0-1：Docker sandbox 引擎配置缺失

**现象**：`octopus.json` 中缺少 `tools.exec.host`、`sandbox.mode`、`sandbox.scope` 配置。CLAUDE.md 描述 sandbox 已启用，但实际配置不存在。

**影响**：Agent 执行 bash 命令时直接在宿主机上以 baizh（uid=1000）身份运行，无容器隔离。`docker/sandbox/` 的 Dockerfile、`setup-network.sh` 的 iptables 规则全部空转。

**推测原因**：2026-03-16 vitest worker 覆盖 octopus.json 事件中配置丢失。

**修复方案**：在 octopus.json 中补充 sandbox 配置，前置验证 Docker 环境就绪。

#### P0-2：飞书 `/bind` 密码明文传输

**现象**：用户通过飞书发送 `/bind 用户名 密码` 完成绑定，密码以明文在 IM 通道传输。

**影响**：即使事后删除消息，无法保证飞书服务器不留存消息内容。

**缓解因素**：飞书整体暂不改动，风险接受。

### 3.2 P1 — 安全隐患

#### P1-1：企业技能在宿主机 uid=1000 执行

`run_skill` 插件工具通过 `child_process.spawn()` 直接在宿主机执行 Python/Node 脚本，身份为 baizh（uid=1000），理论上可访问宿主机所有文件。

**缓解因素**：企业技能仅管理员可上传管理，信任级别高。

#### P1-2：`TOOL_NAME_TO_ENGINE` 多对一映射导致权限粗化

`list_files`/`read_file` 都映射到引擎 `read`，`execute_command`/`search_files` 都映射到 `exec`。前端 5 个精细开关在写入引擎时被粗化为 2-3 个，细粒度权限形同虚设。

#### P1-3：`tools.allow` 中 `group:plugins` 通配符

所有 Agent 的 `tools.allow` 里都包含 `group:plugins`，新增插件工具自动对所有 Agent 可见，违背最小权限原则。

#### P1-4：`memory-lancedb-pro` 记忆隔离隐式依赖

`scopes.agentAccess: {}` 空对象，记忆隔离完全依赖 agent ID 命名规则（`ent_{userId}_{agentName}`），无显式配置。

### 3.3 安全设计亮点

- JWT Token 黑名单使用 SHA256 哈希，不存原始 token
- 内存 LRU Cache + Redis 双层黑名单，热路径无网络延迟
- Refresh Token 单例防并发竞争（`refreshPromise` 设计）
- enterprise-audit 插件 HMAC 签名链防篡改，专业级审计设计
- 登录失败锁定（≥5 次锁 15 分钟）

---

## 四、性能审计

### 4.1 每条消息的 DB 查询风暴

发送一条消息时后端执行的 DB 查询：

| 查询 | 次数 | 来源 |
|------|------|------|
| `loadAgent`（prisma.agent.findFirst） | 3 | 附件处理、斜杠命令、主流程各调一次 |
| `prisma.agent.findMany`（专业 agent 列表） | 1 | buildEnterpriseSystemPrompt |
| `prisma.skill.findMany` | 1 | buildEnterpriseSystemPrompt |
| `prisma.databaseConnection.findMany` | 1 | buildEnterpriseSystemPrompt |
| 读 tools-cache.json 文件 | 1 | buildEnterpriseSystemPrompt |
| **合计** | **7+** | **无缓存，每条消息重复执行** |

### 4.2 启动性能

| 操作 | 当前实现 | 问题 |
|------|---------|------|
| Agent 同步 | 串行 await，N 个 agent N 次 RPC | 50 用户 × 3 agent = 150 次串行 RPC |
| 密码迁移 | 每次启动全量扫描 | 应为一次性迁移 |
| MockLDAP 同步 | 逐个 registerMockUser | 每次启动遍历所有用户 |

### 4.3 前端性能

| 操作 | 问题 |
|------|------|
| 打开聊天页 | 并行 5 个请求，MCP/Skills 列表仅斜杠命令使用，多数用户浪费 |
| 切换 Agent | `loadSessions` 被触发两次（currentAgentId 初始为空） |
| 委派轮询 | 每 5s 全量拉历史，最多 36 次 |
| 提醒轮询 | 每 30s 轮询 `/reminders/due` |
| Agent CRUD | 每次操作后 `loadData()` 重新拉整个列表 |
| Dashboard | dailyTrend 7 次串行 COUNT 查询 |

### 4.4 标题生成双触发

后端 `done` 事件异步调 `autoGenerateTitle`，前端 SSE 读完后又调 `generateTitle` API。两次并发触发导致 `label already in use` 冲突（已有重试逻辑作为临时修复）。

---

## 五、代码质量审计

### 5.1 死代码（约 1700 行）

| 文件 | 行数 | 状态 |
|------|------|------|
| `OctopusBridge.ts` | 657 | 已被 EngineAdapter 完全替代，仅测试引用 |
| `McpPage.tsx` | 426 | 未被路由引用，已被 McpSettingsPage 替代 |
| `SkillsPage.tsx` | 530 | 未被路由引用，已被 SkillsSettingsPage 替代 |
| `HeartbeatForwarder` | ~100 | @deprecated，从未收到事件 |

### 5.2 重复代码（约 800 行）

| 位置 | 重复量 | 描述 |
|------|--------|------|
| enterprise-mcp 4 个 execute 函数 | ~200 行 | mcpFilter 校验 + allowedConnections + 熔断 + callTool |
| chat.ts 流式/非流式路由 | ~250 行 | 附件处理、斜杠命令、systemPrompt 构建、token 计费 |
| 个人 MCP CRUD 双入口 | ~300 行 | McpSettingsPage + PersonalSettingsPage |
| 内容净化逻辑 | ~50 行 | 4 处独立维护的正则净化 |

### 5.3 文件职责过重

| 文件 | 行数 | 职责数 |
|------|------|--------|
| `chat.ts` | ~1500 | 对话流、会话管理、Token 计费、斜杠命令、MCP 说明、SOUL 渲染、native agent 创建 |
| `enterprise-mcp/index.ts` | 1601 | MCP 桥接、run_skill、enterprise_agents_list、send_im_message、个人 MCP 刷新、DB 连接管理 |
| `agents.ts` | 794 | Agent CRUD + 4 个 sync 函数 + TOOL_NAME_TO_ENGINE 映射 |

### 5.4 前端空转功能

| 功能 | 前端状态 | 后端状态 |
|------|---------|---------|
| 导出历史 | 菜单项可点击 | 返回 501 |
| 搜索历史 | 搜索框可输入 | 返回空结果 |

### 5.5 进程级状态（重启丢失）

| 状态 | 存储 | 影响 |
|------|------|------|
| `sessionPrefs`（MCP/Skill 偏好） | Map，size 上限 2000，无 TTL | 重启后用户 MCP/Skill 选择丢失 |
| `activeAgents`（IM agent 选择） | Map | 重启后所有用户 agent 选择回落 default |
| `defaultChecked` | 不存在 | 每次 GET /agents 都触发 ensureDefaultAgent |
| `sessionTokens`（计费基数） | Map | 重启后 token 差值计算可能多计 |

---

## 六、原生能力利用率审计

### 6.1 已正确利用的原生能力

| 原生能力 | 使用方式 | 评价 |
|---------|---------|------|
| `config.set` RPC | EngineAdapter 底层已使用 | 正确，避免 SIGUSR1 重启 |
| `tools.loopDetection` | octopus.json 已配置三层阈值 | 正确，与应用层熔断互补 |
| `skills.load.extraDirs` | 企业技能通过 extraDirs 让引擎发现 | 正确（2026-02-26 迁移完成） |
| `cron.add` RPC | 提醒/心跳通过原生 cron 持久化 | 正确，重启不丢失 |
| Plugin 入口同步函数 | enterprise-audit/mcp 入口均为同步 | 正确（2026-02-25 踩坑后修正） |
| `agents.create`/`agents.delete` RPC | Agent CRUD 同步到原生 | 基本正确，但启动恢复不完整 |

### 6.2 未利用的原生能力

| 原生能力 | 说明 | 潜在价值 |
|---------|------|---------|
| `tools.deny` 列表 | deny 永远优先于 allow，8 层级联过滤 | 实现真正的细粒度工具控制 |
| IDENTITY.md `creature`/`vibe` 字段 | 引擎自动渲染 persona | 减轻 SOUL.md 负担 |
| `exec.mode: allowlist` + `safeBins` | 不依赖 Docker 的白名单防线 | 多层纵深防御 |
| `exec.elevated: ask` 审批 | 危险命令需用户审批 | 提升安全性 |
| 原生飞书通道 `dmPolicy: pairing` | 一次性验证码绑定 | 比密码明文更安全 |
| Cron `delivery.mode: announce` | 任务结果直接推送到 IM | 消除前端轮询 |
| 原生斜杠命令 `/new` `/reset` `/stop` | 企业层返回"未知命令"未透传 | 用户可用更多原生命令 |
| `sessions.patch` RPC | session 元数据持久化 | 替代进程级 sessionPrefs Map |
| 工具组简写 `group:runtime`/`group:fs` | 简化 tools.allow 配置 | 减少映射维护 |

### 6.3 与原生冲突的实现

| 冲突点 | 详情 |
|--------|------|
| SystemConfigPage vs Control UI Config | 两套 UI 操作同一份 octopus.json，后写覆盖先写 |
| 技能启用状态 | DB `skill.enabled` 与 `skills.entries` 不联动 |
| `ensureNativeAgent`（chat.ts）vs `syncToNative`（agents.ts） | 两套 Agent 创建逻辑，IDENTITY.md 内容不一致 |
| 心跳任务 | 原生 `heartbeat` 调度器 + 企业 DB 表 + configApplyFull 三层叠加 |

---

## 七、前端操作链路审计

### 7.1 聊天页面（ChatPage.tsx，1245 行）

**打开页面**：并行 5 个请求，`loadSessions` 被触发两次，`autoGenerateTitle` 嵌入列表接口产生 2+3N 次额外 RPC。

**发送消息**：`loadAgent` 查 3 次、`buildEnterpriseSystemPrompt` 无缓存 4+ 次 DB 查询、标题生成前后端各触发一次。SSE 解析无行缓冲区，TCP 分片可能丢数据。

**附件上传**：base64 嵌入 JSON body（膨胀 33%），已有 `uploadFile()` multipart API 未使用。附件格式经 3 次变换（前端显示 → 后端注入 → 历史记录正则还原）。

**委派轮询**：每 5s 全量拉历史最多 36 次。

### 7.2 Agent 管理页面（AgentsPage.tsx，700 行）

**创建 Agent**：4 步串行同步（syncToNative → syncAllowAgents → syncAgentNativeConfig → syncToolsMd），最多 4 次 RPC。`openCreateModal` 内联重写了 `loadOptions()`。

**编辑 SOUL.md**：加载 7 个文件 RPC，前端只用 SOUL.md 1 个。

**删除 Agent**：`agents.list` native config entry 未清理，重建同名 agent 命中旧配置。

**所有操作后**：`loadData()` 重新拉整个列表，无乐观更新。

### 7.3 设置页面各 Tab

**MCP 管理**：个人 MCP CRUD 在两个页面重复实现（~300 行）。`loadData()` 对个人 MCP 发起两次查询。

**技能管理**：审批通过后不通知原生引擎，技能何时生效不确定。拒绝理由使用 `window.prompt()`。

**定时任务**：每次增删改触发 `configApplyFull`（可能引起引擎重启）。只暴露心跳任务，丢失 Cron 通用能力。

**系统配置**：模型配置用 `configApplyFull`（全量替换），工具/插件用 `configApply`（patch），不一致。Plugin 配置两步保存，用户易误以为已保存。

### 7.4 管理员页面

**Dashboard**：dailyTrend 7 次串行 COUNT 查询，actionDistribution 全量内存聚合。

**用户管理**：删除用户触发 `configApplyFull`（引擎重启）。密码修改双写 DB + MockLDAP。

**认证**：`refreshToken` 依赖 InMemoryUserStore，进程重启后强制重新登录。

---

## 八、与 OpenClaw 原生的架构差异总结

### 8.1 信任模型差异（最根本）

| 维度 | OpenClaw | Octopus 企业版 |
|------|---------|---------------|
| 信任模型 | 单操作者个人助手 | 多租户企业隔离 |
| Session key | 上下文选择器（无授权含义） | 含用户 namespace 的授权令牌 |
| Agent 归属 | 全局共享 | `ent_{userId}_{agentName}` 隔离 |
| 认证 | token/password | JWT + LDAP + RBAC |

### 8.2 设计选择对比

| 维度 | OpenClaw 方式 | Octopus 方式 | 评价 |
|------|-------------|-------------|------|
| 用户隔离 | `dmScope` 策略 | Agent ID 命名空间 | Octopus 更彻底 |
| 工具控制 | 8 层级联 + deny 优先 | tools.allow + TOOL_NAME_TO_ENGINE 映射 | OpenClaw 更细粒度 |
| 技能管理 | skills.entries + extraDirs | DB 审批流 + run_skill 插件 | 各有优势 |
| 记忆隔离 | per-agent SQLite | memory-lancedb-pro 独立 dbPath | 均可，Octopus 需显式 agentAccess |
| 配置更新 | config.set 智能热加载 | configApplyFull 全量替换 | OpenClaw 更安全 |

---

## 九、问题严重度汇总

### P0 — 安全漏洞（2 个）

| # | 问题 | 模块 |
|---|------|------|
| 1 | Docker sandbox 引擎配置缺失，exec 宿主机裸跑 | octopus.json |
| 2 | 飞书 `/bind` 密码明文传输 | IM 集成 |

### P1 — 重大缺陷（10 个）

| # | 问题 | 模块 |
|---|------|------|
| 1 | OctopusBridge.ts 657 行死代码 | 代码质量 |
| 2 | McpPage.tsx + SkillsPage.tsx 956 行死代码 | 前端 |
| 3 | Agent 创建触发 4 次 RPC，有 hash 冲突风险 | agents.ts |
| 4 | `TOOL_NAME_TO_ENGINE` 多对一映射导致权限粗化 | 安全 |
| 5 | SystemConfigPage 与 Control UI 双入口冲突 | 配置管理 |
| 6 | enterprise-mcp 4 个重复 execute 函数（~200 行） | 代码质量 |
| 7 | `loadAgent` 每条消息查 3 次 DB | 性能 |
| 8 | `buildEnterpriseSystemPrompt` 无缓存，每条消息 4+ 次 DB | 性能 |
| 9 | 删除 Agent 后 agents.list config entry 残留 | 数据一致性 |
| 10 | 启动时 Agent 同步不完整（model/tools 丢失） | 数据一致性 |

### P2 — 中等问题（12 个）

| # | 问题 | 模块 |
|---|------|------|
| 1 | chat.ts ~1500 行职责过重 | 代码质量 |
| 2 | 个人 MCP CRUD 两个页面重复（~300 行） | 前端 |
| 3 | 内容净化逻辑 4 处分散维护 | 代码质量 |
| 4 | 委派轮询每 5s 全量拉历史，最多 36 次 | 性能 |
| 5 | `sessionPrefs` 进程级 Map 无 TTL | 可靠性 |
| 6 | `/agent` 命令状态存进程内存，重启丢失 | 可靠性 |
| 7 | `refreshToken` 依赖 InMemoryUserStore | 可靠性 |
| 8 | Dashboard dailyTrend 7 次串行 COUNT | 性能 |
| 9 | SSE 解析无行缓冲区 | 可靠性 |
| 10 | 标题生成前后端双触发 | 正确性 |
| 11 | 技能启用状态 DB 与 octopus.json 不联动 | 数据一致性 |
| 12 | `ensureNativeAgent` sleep(2000) 盲等 | 性能/UX |

### P3 — 优化建议（6 个）

| # | 问题 | 模块 |
|---|------|------|
| 1 | IDENTITY.md 未用 creature/vibe 字段 | 原生能力 |
| 2 | 原生 exec allowlist + safeBins 未使用 | 安全纵深 |
| 3 | Cron delivery.mode 未用（飞书通道未接入引擎） | 原生能力 |
| 4 | 原生斜杠命令 /new /reset /stop 未透传 | 原生能力 |
| 5 | Plugin 配置两步保存 UX | 前端 |
| 6 | 导出/搜索功能空转但 UI 可操作 | 前端 |

---

## 十、整改建议

详见 `docs/superpowers/specs/2026-03-17-system-rectification-plan.md`，分 3 个阶段逐步推进：

- **阶段 1**：清理死代码 + 安全修复 + 20 个快速修复
- **阶段 2**：消除重复代码 + 性能优化（chat.ts 拆分、enterprise-mcp 去重、config 写入合并）
- **阶段 3**：配置管理统一 + 工具权限对齐原生能力

每阶段独立可交付、可回滚，有明确的依赖关系和验证步骤。
