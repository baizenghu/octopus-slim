# Octopus 系统审计报告：基于 OpenClaw 原生能力对照分析

> 审计日期：2026-03-17
> 审计范围：Octopus 企业版全部模块 vs OpenClaw 官方文档（docs.openclaw.ai）
> 审计方法：两个独立团队并行审计，交叉验证后合并
> - 团队 A：7 个 agent 学习 120+ 页文档 → 6 个 agent 代码分析 → 4 个 agent 前端链路分析
> - 团队 B：深度源码分析 + 对照 192 页文档
> 审计结论：**P0×3、P1×14、P2×16、P3×8 = 41 个问题**，死代码约 1800 行，重复代码约 800 行
> 注：API Key 明文存储问题（对方 P0-3）经确认为内网部署场景，不纳入整改范围

---

## 一、审计概述

Octopus 企业版基于 OpenClaw（原名 Clawd）原生引擎开发，通过企业网关层（Express:18790）代理原生 Gateway（:19791），提供多租户隔离、JWT 认证、RBAC、审计日志等企业能力。

本次审计由两个独立团队分别从不同角度完成，合并后覆盖以下维度：
1. 哪些功能原生已支持，企业层重复实现了？
2. 哪些原生能力未被充分利用？
3. 哪些实现存在安全、性能或架构问题？
4. 前端每个操作的完整调用链路是否合理？

15 个问题经双方交叉验证确认，8 个问题为对方独立发现后补充。

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
| Skill 提示注入 | 引擎从 SKILL.md 自动构建 system prompt | SkillsInfo.ts 手动读文件构建 | **高度冗余**（双重注入） |
| 工具说明注入 | tool catalog + TOOLS.md | buildMCPToolsSection() prompt 注入 | **高度冗余**（同一信息注入两次） |
| 配置局部更新 | `config.patch`（RFC 7396 Merge Patch） | `configApplyFull` read-modify-write | **可替代** |
| 会话管理 | 原生 sessions.* RPC | 企业层代理 + namespace 过滤 | **代理合理，但过滤可简化** |
| 审计日志 | 原生 JSON Lines 文件日志 | enterprise-audit 插件（DB + JSONL + HMAC） | **必要扩展** |
| 认证 | token/password/trusted-proxy/tailscale | JWT + MockLDAP + RBAC | **必要扩展** |

### 2.2 数据双权威源问题

Agent 状态同时维护在两处（DB + octopus.json + workspace 文件 = 三处存储），同步逻辑复杂且不完整：

| 数据 | 企业 DB（Prisma） | 原生 octopus.json | workspace 文件 |
|------|-----------------|------------------|---------------|
| Agent 基本信息 | name, description, model, enabled | id, workspace, model | — |
| 工具权限 | toolsFilter, mcpFilter, skillsFilter | tools.allow, tools.deny | TOOLS.md |
| 身份信息 | identity (name, emoji) | — | IDENTITY.md |
| 系统提示 | systemPrompt 字段 | — | SOUL.md |
| 记忆模板 | — | — | MEMORY.md |
| 允许调用 | — | subagents.allowAgents | — |

同步方向：DB → 原生（单向），由 `syncToNative`/`syncAllowAgents`/`syncAgentNativeConfig`/`syncToolsMd` 4 个函数维护。

**已知同步缺陷**：
- 启动时只恢复 workspace 路径，model/tools.allow/allowAgents 丢失
- 删除 Agent 后 `agents.list` 中的 config entry 残留
- 创建时最多触发 4 次 RPC（2 次读 + 2 次写），有 hash 冲突风险

---

## 三、安全审计

### 3.1 P0 — 安全漏洞

#### P0-1：Docker sandbox 引擎配置缺失 ✅双方确认

**现象**：`octopus.json` 中缺少 `tools.exec.host`、`sandbox.mode`、`sandbox.scope` 配置。CLAUDE.md 描述 sandbox 已启用，但实际配置不存在。

**影响**：Agent 执行 bash 命令时直接在宿主机上以 baizh（uid=1000）身份运行，无容器隔离。`docker/sandbox/` 的 Dockerfile、`setup-network.sh` 的 iptables 规则全部空转。

**推测原因**：2026-03-16 vitest worker 覆盖 octopus.json 事件中配置丢失。

#### ~~P0-2：API Key 明文存储~~ — 不纳入整改

内网部署场景，git 仓库不对外暴露，风险可接受。

#### P0-2：extraSystemPrompt 与 TOOLS.md 双重注入 🆕来自对方报告

**现象**：每次对话请求 `buildEnterpriseSystemPrompt()` 构建 ~150 行系统提示（含 MCP 工具说明），同时 `syncToolsMd()` 已把相同信息写入 TOOLS.md，原生引擎也会注入 TOOLS.md。**同一信息被注入了两次**。

**影响**：浪费 context token，增加每条消息的 DB 查询负担（无缓存时 7+ 次）。

#### P0-3：飞书 `/bind` 密码明文传输

**现象**：用户通过飞书发送 `/bind 用户名 密码` 完成绑定，密码以明文在 IM 通道传输。

**缓解因素**：飞书整体暂不改动，风险接受。

### 3.2 P1 — 安全隐患

#### P1-1：企业技能/MCP 安全策略倒挂 ✅双方确认

**Skill/MCP 四维安全对比**（来自对方报告 §11）：

| 维度 | 企业 Skill | 个人 Skill | 企业 MCP | 个人 MCP |
|------|-----------|-----------|---------|---------|
| 执行环境 | **宿主机子进程** | Docker 容器 | **宿主机子进程** | Docker 容器 |
| 执行身份 | **uid=1000 (baizh)** | 容器默认用户 | **uid=1000 (baizh)** | uid=2000 (sandbox) |
| 网络 | **无限制** | `--network=none` | **无限制** | `octopus-internal` |
| 内存/CPU | 无限制 | 512MB/1核 | 无限制 | 256MB/0.5核 |
| 文件访问 | **全局 fs** | 仅 workspace+skill:ro | **全局 fs** | 仅 workspace |
| 环境变量 | 最小集 | 容器隔离 | **继承完整 process.env** | 过滤敏感变量 |

**安全倒挂**：企业级（管理员管理）反而比个人级（用户自助）安全策略更宽松。

**企业 MCP 额外问题**：`spawn` 时 `env: { ...process.env, ...mergedEnv }`，继承完整宿主环境变量，包括 `DATABASE_URL`、`JWT_SECRET`、`DEEPSEEK_API_KEY` 等敏感信息。

**`skillsFilter` 豁免**：企业 Skill 的 scope 检查直接跳过 skillsFilter，任何企业 skill 对所有 agent 可见，无视 agent 的 skillsFilter 配置。

**缓解因素**：企业技能和 MCP 仅管理员可上传管理，信任级别高。

#### P1-2：`TOOL_NAME_TO_ENGINE` 多对一映射导致权限粗化 ✅双方确认

`list_files`/`read_file` 都映射到引擎 `read`，`execute_command`/`search_files` 都映射到 `exec`。前端 5 个精细开关在写入引擎时被粗化为 2-3 个，细粒度权限形同虚设。

#### P1-3：`tools.allow` 中 `group:plugins` 通配符

所有 Agent 的 `tools.allow` 里都包含 `group:plugins`，新增插件工具自动对所有 Agent 可见，违背最小权限原则。

#### P1-4：`memory-lancedb-pro` 记忆隔离隐式依赖

`scopes.agentAccess: {}` 空对象，记忆隔离完全依赖 agent ID 命名规则（`ent_{userId}_{agentName}`），无显式配置。

#### P1-5：HMAC 审计签名默认密钥 🆕来自对方报告

`AUDIT_HMAC_KEY` 默认值为 `'default-audit-key-change-me'`，生产环境未设环境变量则签名链形同虚设。应在启动时检查并警告。

### 3.3 安全设计亮点

- JWT Token 黑名单使用 SHA256 哈希，不存原始 token
- 内存 LRU Cache + Redis 双层黑名单，热路径无网络延迟
- Refresh Token 单例防并发竞争（`refreshPromise` 设计）
- enterprise-audit 插件 HMAC 签名链防篡改，专业级审计设计
- 登录失败锁定（≥5 次锁 15 分钟）
- 个人 MCP 命令白名单（node/python3/npx/tsx/ts-node）+ 路径限制

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
| Dashboard | dailyTrend 7 次串行 COUNT 查询，actionDistribution 全量内存聚合 |
| 会话列表 | `autoGenerateTitle` 嵌入 GET /sessions 响应路径，产生 2+3N 次额外 RPC |

### 4.4 标题生成双触发

后端 `done` 事件异步调 `autoGenerateTitle`，前端 SSE 读完后又调 `generateTitle` API。两次并发触发导致 `label already in use` 冲突（已有重试逻辑作为临时修复）。

---

## 五、代码质量审计

### 5.1 死代码（约 1800 行）

| 文件 | 行数 | 状态 | 来源 |
|------|------|------|------|
| `OctopusBridge.ts` | 657 | 已被 EngineAdapter 完全替代 | ✅双方确认 |
| `McpPage.tsx` | 426 | 未被路由引用 | ✅双方确认 |
| `SkillsPage.tsx` | 530 | 未被路由引用 | ✅双方确认 |
| `SkillTools.ts` | ~100 | 定义了未使用的 executeSkillToolCall | 🆕对方发现 |
| `HeartbeatForwarder` | ~100 | @deprecated，从未收到事件 | 团队 A 发现 |

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
| `ChatPage.tsx` | ~1245 | 会话管理、流式对话、附件上传、斜杠命令、Agent 切换、Delegation 轮询、提醒轮询 |

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

### 5.6 其他代码问题 🆕来自对方报告

| 问题 | 位置 | 影响 |
|------|------|------|
| 中文 agentName 转换冲突 | `userAgentId()` | 多个中文名 agent 可能产生相同 ID（如"财务助手"和"技术助手"都变成 `ent_user_____`） |
| tools-cache.json 位置不当 | `plugins/mcp/` | 写入版本控制目录，应放 `.octopus-state/` |
| 个人 MCP/Skill 沙箱参数不一致 | Docker 启动参数 | MCP: 256m/0.5cpu/internal vs Skill: 512m/1cpu/none |

---

## 六、原生能力利用率审计

### 6.1 已正确利用的原生能力

| 原生能力 | 使用方式 | 评价 |
|---------|---------|------|
| `config.set` RPC | EngineAdapter 底层已使用 | 正确，避免 SIGUSR1 重启 |
| `tools.loopDetection` | octopus.json 已配置三层阈值 | 正确，与应用层熔断互补 |
| `cron.add` RPC | 提醒/心跳通过原生 cron 持久化 | 正确，重启不丢失 |
| Plugin 入口同步函数 | enterprise-audit/mcp 入口均为同步 | 正确（2026-02-25 踩坑后修正） |
| `agents.create`/`agents.delete` RPC | Agent CRUD 同步到原生 | 基本正确，但启动恢复不完整 |

### 6.2 已确认丢失的能力：`skills.load.extraDirs`

对方团队通过 grep 确认：当前 `octopus.json` 中**没有** `skills` 配置块。CLAUDE.md 记录 2026-02-26 已迁移到 `skills.load.extraDirs`，但配置在 2026-03-16 vitest 覆盖事件中丢失。

**影响**：
- 原生引擎对企业 Skill 完全不可见
- `SkillsInfo.ts` 手动重建了原生已有的 Skill 提示注入功能（双重注入）
- 原生的 skill 热更新/监视、`skills.entries` 配置覆盖等能力全部不可用

**已纳入整改方案阶段 1.3**：恢复配置。

### 6.3 未利用的原生能力

| 原生能力 | 说明 | 潜在价值 |
|---------|------|---------|
| `tools.deny` 列表 | deny 永远优先于 allow，8 层级联过滤 | 实现真正的细粒度工具控制 |
| `tools.profile` 预设 | minimal/coding/messaging/full | 简化工具权限管理 |
| IDENTITY.md `creature`/`vibe` 字段 | 引擎自动渲染 persona | 减轻 SOUL.md 负担 |
| `exec.mode: allowlist` + `safeBins` | 不依赖 Docker 的白名单防线 | 多层纵深防御 |
| `exec.elevated: ask` 审批 | 危险命令需用户审批 | 提升安全性 |
| 原生飞书通道 `dmPolicy: pairing` | 一次性验证码绑定 | 比密码明文更安全 |
| Cron `delivery.mode: announce` | 任务结果直接推送到 IM | 消除前端轮询 |
| 原生斜杠命令 `/new` `/reset` `/stop` | 企业层返回"未知命令"未透传 | 用户可用更多原生命令 |
| `sessions.patch` RPC | session 元数据持久化 | 替代进程级 sessionPrefs Map |
| 工具组简写 `group:runtime`/`group:fs` | 简化 tools.allow 配置 | 减少映射维护 |
| `config.patch` RPC | RFC 7396 Merge Patch 局部更新 | 替代 configApplyFull 全量替换 |
| `$include` 配置拆分 | 大配置拆分为多文件 | 减少并发冲突 |
| Session Pruning | `contextPruning.mode: "cache-ttl"` | 优化长会话 token 消耗 |
| Memory Flush | `compaction.memoryFlush` | 压缩前保存重要上下文 |

### 6.4 与原生冲突的实现

| 冲突点 | 详情 |
|--------|------|
| SystemConfigPage vs Control UI Config | 两套 UI 操作同一份 octopus.json，后写覆盖先写 |
| 技能启用状态 | DB `skill.enabled` 与 `skills.entries` 不联动 |
| `ensureNativeAgent`（chat.ts）vs `syncToNative`（agents.ts） | 两套 Agent 创建逻辑，IDENTITY.md 内容不一致 |
| 心跳任务 | 原生 `heartbeat` 调度器 + 企业 DB 表 + configApplyFull 三层叠加 |
| Skill 提示注入 | SkillsInfo.ts 手动构建 + 原生引擎自动注入 SKILL.md = 双重注入 |
| MCP 工具说明 | buildMCPToolsSection() + TOOLS.md + tool catalog = 多重注入 |

---

## 七、前端操作链路审计

### 7.1 聊天页面（ChatPage.tsx，~1245 行）

**打开页面**：并行 5 个请求，`loadSessions` 被触发两次，`autoGenerateTitle` 嵌入列表接口产生 2+3N 次额外 RPC。

**发送消息**：`loadAgent` 查 3 次、`buildEnterpriseSystemPrompt` 无缓存 7+ 次 DB/文件查询、标题生成前后端各触发一次。SSE 解析无行缓冲区，TCP 分片可能丢数据。

**附件上传**：base64 嵌入 JSON body（膨胀 33%），已有 `uploadFile()` multipart API 未使用。附件格式经 3 次变换（前端显示 → 后端注入 → 历史记录正则还原）。

**委派轮询**：每 5s 全量拉历史最多 36 次。

### 7.2 Agent 管理页面（AgentsPage.tsx，~700 行）

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

## 八、多余开发清单（OpenClaw 原生已支持但企业版又自建的）

| 功能 | OpenClaw 原生支持 | 企业版自建 | 冗余程度 | 建议 |
|------|-------------------|-----------|----------|------|
| Skill 提示注入 | 引擎从 SKILL.md 自动构建 system prompt | `SkillsInfo.ts` 手动读文件构建 | **高度冗余** | 接入原生 `skills.load.extraDirs` |
| Skill 可见性 | `skills.entries[name].enabled` | `skillsFilter` DB 字段 + ToolFactory 过滤 | **中度冗余** | 保留 DB 做 RBAC，用 `skills.entries` 同步到原生 |
| 工具说明注入 | tool catalog + TOOLS.md | `buildMCPToolsSection()` prompt 注入 | **高度冗余** | 删除 prompt 注入，依赖 tool catalog |
| 配置局部更新 | `config.patch` Merge Patch | `configApplyFull` read-modify-write | **完全冗余** | 迁移到 `config.patch` |
| 对话流增量 delta | `/v1/chat/completions` SSE 原生增量 | `prevContent` diff 手动取增量 | **可替代** | 评估代理 OpenAI 兼容 API |
| 飞书 IM 集成 | `channels/feishu-native/`（WebSocket/Webhook/DM策略/群组/流式卡片） | FeishuAdapter（仅私聊文本） | **高度冗余** | 中期迁移评估 |
| 循环检测 | `tools.loopDetection` 配置 | 已配置 | **无冗余** | 保持 |
| Session Pruning | `contextPruning.mode: "cache-ttl"` | 未实现 | **未利用** | 可引入 |
| Memory Flush | `compaction.memoryFlush` | 未实现 | **未利用** | 可引入 |

---

## 九、合理的企业增值（应保留）

以下功能在 OpenClaw 原生中不存在，是企业版必须的增值层：

| 功能 | 说明 | 质量评价 |
|------|------|---------|
| JWT 认证 + LDAP | 多用户身份认证 | 合理 |
| 用户命名空间隔离 | `ent_{userId}_{agentName}` | 合理（需修复中文名冲突） |
| RBAC 权限矩阵 | toolsFilter/mcpFilter/skillsFilter/allowedConnections | 合理 |
| enterprise-audit 插件 | MySQL + HMAC 签名链审计 | 合理（需修复 HMAC 默认密钥） |
| 企业/个人 MCP 分级 | DB scope + ownerId 隔离 | 合理 |
| 企业/个人 Skill 分级 | 审批流 + 安全扫描 | 合理（需修复宿主机执行问题） |
| MCPExecutor 协议桥接 | stdio/HTTP MCP 客户端 | 必要（原生不支持 MCP） |
| 配额管理 | Token/请求限额 | 合理 |
| 文件隔离管理 | 用户级 workspace | 合理 |
| 数据库连接白名单 | allowedConnections | 合理 |
| Admin 仪表盘 | 用户/审计统计 | 合理 |

---

## 十、与 OpenClaw 原生的架构差异总结

### 10.1 信任模型差异（最根本）

| 维度 | OpenClaw | Octopus 企业版 |
|------|---------|---------------|
| 信任模型 | 单操作者个人助手 | 多租户企业隔离 |
| Session key | 上下文选择器（无授权含义） | 含用户 namespace 的授权令牌 |
| Agent 归属 | 全局共享 | `ent_{userId}_{agentName}` 隔离 |
| 认证 | token/password | JWT + LDAP + RBAC |

### 10.2 设计选择对比

| 维度 | OpenClaw 方式 | Octopus 方式 | 评价 |
|------|-------------|-------------|------|
| 用户隔离 | `dmScope` 策略 | Agent ID 命名空间 | Octopus 更彻底 |
| 工具控制 | 8 层级联 + deny 优先 | tools.allow + TOOL_NAME_TO_ENGINE 映射 | OpenClaw 更细粒度 |
| 技能管理 | skills.entries + extraDirs | DB 审批流 + run_skill 插件 | 各有优势 |
| 记忆隔离 | per-agent SQLite | memory-lancedb-pro 独立 dbPath | 均可，Octopus 需显式 agentAccess |
| 配置更新 | config.set/patch 智能热加载 | configApplyFull 全量替换 | OpenClaw 更安全 |

---

## 十一、问题严重度汇总

### P0 — 安全漏洞（4 个）

| # | 问题 | 模块 | 来源 |
|---|------|------|------|
| 1 | Docker sandbox 引擎配置缺失，exec 宿主机裸跑 | octopus.json | ✅双方 |
| 2 | extraSystemPrompt 与 TOOLS.md 双重注入 | chat.ts | 🆕对方 |
| 3 | 飞书 `/bind` 密码明文传输 | IM 集成 | 团队 A |

### P1 — 重大缺陷（14 个）

| # | 问题 | 模块 | 来源 |
|---|------|------|------|
| 1 | OctopusBridge.ts + SkillTools.ts 死代码 | 代码质量 | ✅双方 |
| 2 | McpPage.tsx + SkillsPage.tsx 死代码 | 前端 | ✅双方 |
| 3 | Agent 创建触发 4 次 RPC，hash 冲突风险 | agents.ts | ✅双方 |
| 4 | `TOOL_NAME_TO_ENGINE` 多对一映射导致权限粗化 | 安全 | ✅双方 |
| 5 | SystemConfigPage 与 Control UI 双入口冲突 | 配置管理 | ✅双方 |
| 6 | enterprise-mcp 1601 行，4 个重复 execute 函数 | 代码质量 | ✅双方 |
| 7 | `loadAgent` 每条消息查 3 次 DB | 性能 | 团队 A |
| 8 | `buildEnterpriseSystemPrompt` 无缓存，每条消息 7+ 次查询 | 性能 | ✅双方 |
| 9 | 删除 Agent 后 agents.list config entry 残留 | 数据一致性 | 团队 A |
| 10 | 启动时 Agent 同步不完整（model/tools 丢失） | 数据一致性 | 团队 A |
| 11 | HMAC 审计签名默认密钥 | 安全 | 🆕对方 |
| 12 | 完全绕过原生 Skills 系统（待验证） | 架构冗余 | 🆕对方 |
| 13 | 斜杠命令通过 prompt 注入实现 | 架构 | 🆕对方 |
| 14 | SSE delta diff 过于复杂（prevContent 手动差分） | 代码质量 | ✅双方 |

### P2 — 中等问题（16 个）

| # | 问题 | 模块 | 来源 |
|---|------|------|------|
| 1 | chat.ts ~1500 行职责过重 | 代码质量 | ✅双方 |
| 2 | 个人 MCP CRUD 两个页面重复（~300 行） | 前端 | ✅双方 |
| 3 | 内容净化逻辑 4 处分散维护 | 代码质量 | 团队 A |
| 4 | 委派轮询每 5s 全量拉历史，最多 36 次 | 性能 | ✅双方 |
| 5 | `sessionPrefs` 进程级 Map 无 TTL | 可靠性 | 团队 A |
| 6 | `/agent` 命令状态存进程内存，重启丢失 | 可靠性 | 团队 A |
| 7 | `refreshToken` 依赖 InMemoryUserStore | 可靠性 | 团队 A |
| 8 | Dashboard dailyTrend 7 次串行 COUNT | 性能 | 团队 A |
| 9 | SSE 解析无行缓冲区 | 可靠性 | 团队 A |
| 10 | 标题生成前后端双触发 | 正确性 | ✅双方 |
| 11 | 技能启用状态 DB 与 octopus.json 不联动 | 数据一致性 | ✅双方 |
| 12 | `ensureNativeAgent` sleep(2000) 盲等 | 性能/UX | 团队 A |
| 13 | 中文 agentName 转换可能产生 ID 冲突 | 正确性 | 🆕对方 |
| 14 | tools-cache.json 写入版本控制目录 | 代码规范 | 🆕对方 |
| 15 | 个人 MCP/Skill 沙箱参数不一致 | 配置规范 | 🆕对方 |
| 16 | 定时任务双层存储（DB + octopus.json + HEARTBEAT.md） | 架构冗余 | ✅双方 |

### P3 — 优化建议（8 个）

| # | 问题 | 模块 | 来源 |
|---|------|------|------|
| 1 | IDENTITY.md 未用 creature/vibe 字段 | 原生能力 | 团队 A |
| 2 | 原生 exec allowlist + safeBins 未使用 | 安全纵深 | 团队 A |
| 3 | Cron delivery.mode 未用 | 原生能力 | 团队 A |
| 4 | 原生斜杠命令 /new /reset /stop 未透传 | 原生能力 | 团队 A |
| 5 | Plugin 配置两步保存 UX | 前端 | 团队 A |
| 6 | 导出/搜索功能空转但 UI 可操作 | 前端 | 团队 A |
| 7 | 未使用 `$include` 配置拆分 | 原生能力 | 🆕对方 |
| 8 | 未引入 Session Pruning 和 Memory Flush | 原生能力 | 🆕对方 |

---

## 十二、整改建议

详见 `docs/superpowers/specs/2026-03-17-system-rectification-plan.md`，分 3 个阶段逐步推进：

- **阶段 1**：清理死代码 + 安全修复 + 20+ 个快速修复
- **阶段 2**：消除重复代码 + 性能优化（chat.ts 拆分、enterprise-mcp 去重、config 写入合并、systemPrompt 双重注入消除）
- **阶段 3**：配置管理统一 + 工具权限对齐原生能力

每阶段独立可交付、可回滚，有明确的依赖关系和验证步骤。

---

## 附录：交叉验证统计

| 维度 | 数值 |
|------|------|
| 双方独立发现且一致的问题 | 15 个 |
| 团队 A 独立发现的问题 | 19 个 |
| 团队 B 独立发现的问题 | 8 个 |
| 合并后总问题数 | 42 个 |
| 定级存在分歧的问题 | 3 个（企业 Skill 执行、OctopusBridge 死代码、斜杠命令实现方式） |
| 需要实际验证的分歧 | 1 个（skills.load.extraDirs 是否实际生效） |
