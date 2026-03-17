# CLAUDE.md — Octopus

> 行为规范 + 项目知识 + 踩坑记录，三合一。

---

## 语言规范

- **始终使用中文与用户交流**，包括回复、解释、提问、总结等所有输出
- 代码、变量名、命令保持原样（不翻译）
- 代码注释：业务逻辑用中文，技术实现用英文

---

## Part 1: Workflow Rules（行为规范）

### 1. Plan First（先计划再动手）

- **3 步以上的任务必须先写计划**，写到 `tasks/todo.md`（含 checkbox）
- 计划写完先给用户确认，再动手
- 计划要包含验证步骤，不只是实现步骤
- 写详细的 spec 减少歧义（接口签名、数据格式、边界情况）
- **出问题立即 STOP**，不要硬推——重新规划

### 2. Subagent Strategy（子任务拆分）

- 复杂任务拆成子任务并行处理，保持主上下文干净
- 调研、探索、代码审查可以 offload 给子任务
- 每个子任务只做一件事，聚焦执行
- 对难题多投计算资源，不要硬想

### 3. Self-Improvement Loop（自我迭代）

- 被用户纠正后，**立即**更新 `Lessons Learned` 段落
- 写出具体的规则防止同类错误再犯
- 持续迭代 lessons 直到犯错率下降
- 每次 session 开始先浏览 lessons

### 4. Verification Before Done（完成前验证）

- **不验证 = 没完成**
- 必须跑的验证：
  ```bash
  cd apps/gateway && npx tsc --noEmit     # 类型检查
  cd apps/admin-console && npx tsc --noEmit
  npx vitest run                           # 单元测试
  curl http://localhost:18790/health       # 健康检查
  ```
- 改了 chat 路由？手动测一条对话
- 改了 Bridge？确认 WebSocket 能连上
- 问自己：**"一个资深工程师会批准这个 PR 吗？"**
- diff 你的改动和 main 分支，检查有没有遗漏

### 5. Demand Elegance（追求优雅，但别过度）

- 非 trivial 改动：停下来想"有没有更优雅的方式？"
- 如果一个 fix 感觉很 hacky：**用你现在掌握的全部信息，实现最优解**
- 简单明显的修复？直接改，不要过度设计
- 提交前 challenge 自己的方案

### 6. Autonomous Bug Fixing（自主修 bug）

- 收到 bug 报告：直接修，别问"请提供更多信息"
- 先看日志、错误栈、失败的测试——然后解决
- 用户不需要手把手教你调试
- CI 测试挂了？主动去修

---

## Part 2: Task Management（任务管理）

1. **Plan First**: 写计划到 `tasks/todo.md`（含 checkbox）
2. **Verify Plan**: 给用户确认再动手
3. **Track Progress**: 边做边勾 checkbox
4. **Explain Changes**: 每步给高层 summary
5. **Document Results**: 完成后在 `tasks/todo.md` 加 review 段落
6. **Capture Lessons**: 有教训就更新本文件 `Lessons Learned` 段落

---

## Part 3: Code Principles（代码原则）

- **Simplicity First**: 每个改动尽可能简单，影响面最小
- **No Laziness**: 找根因，不打临时补丁，资深工程师标准
- **Minimal Impact**: 只改必要的部分，避免引入新 bug
- **Type Safety**: TypeScript strict，不用 `any`（除非和 Prisma 动态查询交互）
- **Error Handling**: 所有 async 函数必须 try-catch，catch 里要有 context
- **中文注释**: 业务逻辑用中文注释，技术实现用英文

---

## Part 4: Architecture（项目架构）

```
Browser / Admin Console (React)
         │
         │ HTTP/SSE
         ▼
Enterprise Gateway  ─── port 18790
  - Auth (JWT + Mock LDAP)
  - RBAC / multi-user isolation
  - Audit logging (file + DB)
  - Session namespace prefix: ent_{userId}_{agentName}
         │
         │ WebSocket RPC (OctopusBridge)
         ▼
Native Octopus Gateway  ─── port 19791
  - Agent engine
  - Session management
  - Cron scheduler
  - Tool system (fs, search, etc.)
  - Model management
         │
         │ OpenAI-compatible HTTP
         ▼
DeepSeek API  (internal intranet proxy)
```

### Services

| Service | Port | Start command |
|---------|------|---------------|
| Enterprise Gateway | 18790 | `pnpm --filter gateway dev` |
| Native Octopus Gateway | 19791 | `octopus --profile enterprise gateway --port 19791` |
| Admin Console | 18792 | `pnpm --filter admin-console dev` |

Start all: `./start.sh start` | Stop all: `./start.sh stop`

### Key Concepts

**User Namespace Isolation**
- Agent ID: `ent_{userId}_{agentName}` (e.g. `ent_zhangsan_default`)
- Session key: `agent:ent_{userId}_{agentName}:session:{id}`
- Workspace: `{dataRoot}/users/{userId}/workspace/`
- File isolation: `tools.fs.workspaceOnly = true`
- Exec 隔离: Docker sandbox（`tools.exec.host = sandbox`）— 见下方说明

**Docker Sandbox 隔离策略**
- 用户 agent 需要 bash/exec 能力，但 `workspaceOnly = true` 只限制 fs 工具，管不住 bash
- 直接放开 exec 会让 agent 在宿主机上自由执行命令，无法约束在用户工作区内
- 因此改用 Docker sandbox：exec 在容器内执行，容器只挂载该 agent 的 workspace
- 配置：`tools.exec.host = "sandbox"`、`sandbox.mode = "all"`、`sandbox.scope = "agent"`
- Docker image: `octopus-sandbox:enterprise`（构建脚本：`docker/sandbox/build.sh`）
- 每个 agent 独立容器，`sandbox.scope = "agent"` 保证容器间互相隔离
- 网络：`octopus-internal`（bridge 172.30.0.0/16，iptables 封锁公网，脚本：`docker/sandbox/setup-network.sh`）
- 容器内用户：sandbox（uid=2000，**非** baizh 的 uid=1000，避免 bind mount 权限穿透）
- Skills 挂载：`/data/skills:/opt/skills:ro`，宿主机 skills 目录权限 700（baizh 所有），容器 uid=2000 不可读
- Workspace：宿主机目录需 `chmod a+w`（容器 uid=2000 才能写入）

**OctopusBridge** (`apps/gateway/src/services/OctopusBridge.ts`)
- WebSocket RPC client, extends EventEmitter
- Key methods: `callAgent()`, `sessionsList()`, `agentsCreate()`, `cronAdd()`
- Static helpers: `userAgentId()`, `userSessionKey()`, `parseSessionKeyUserId()`

**Native Gateway Config**
- 唯一配置源: `.octopus-state/octopus.json`（项目内，随 git 版本控制）
- ~~`~/.octopus/` 软链接已删除~~（2026-03-16：vitest worker 通过软链接覆盖企业配置，导致 models 丢失）
- `start.sh` 通过 `OCTOPUS_STATE_DIR` 环境变量指定 state 目录
- Token 须与 `.env` 中 `OCTOPUS_GATEWAY_TOKEN` 一致

**Data Directories**

| 目录 | 用途 |
|------|------|
| `DATA_ROOT` (default `./data/`) | 企业网关数据（技能、用户、审计） |
| `.octopus-state/` | Native gateway state（配置、agent 状态、记忆、插件） |

两者均在项目目录内，随 git 版本控制（运行时临时数据已 gitignore）。

**Deployment Constraints (Intranet)**
- No external tools (web search, browser disabled)
- No IM channels
- No cloud sync
- Model: DeepSeek via internal proxy

---

## Part 5: Lessons Learned（踩坑记录）

> 每次踩坑后在此追加，格式：`日期 | 问题 | 规则`

| 日期 | 问题 | 规则 |
|------|------|------|
| 2026-02-21 | `OCTOPUS_CONFIG_PATH` 注入 override 文件会被 Octopus 重写，覆盖 model 配置 | **永远不要用 `OCTOPUS_CONFIG_PATH`**，只用 profile 文件 |
| 2026-02-21 | `skills.allowBundled: []` 无效，`normalizeAllowlist([])` 返回 undefined | 禁用技能只能用 `skills.entries[name].enabled: false` |
| 2026-02-22 | native gateway 的 `data.text` 是累积全量文本，不是增量 delta | chat.ts 里必须 diff `prevContent` 取增量再推 SSE |
| 2026-02-23 | Octopus 原生没有 MCP 机制，config 里没有 `mcp` 字段 | enterprise-mcp 包是唯一 MCP 实现，不能删；MCP 工具需通过 Plugin `registerTool()` 桥接到原生 |
| 2026-02-23 | Skill 不能通过 RPC 动态注入到原生 config | 放到原生 skill 搜索路径让其自动发现（6 个搜索路径） |
| 2026-02-23 | `setTimeout` 做提醒不可靠，进程重启全丢 | 提醒应使用原生 `cron.add()` RPC（支持 `schedule.kind: "at"` 一次性） |
| 2026-02-23 | prompt 里写"严禁访问"是伪安全，模型可被 jailbreak | 安全靠原生 sandbox + tool policy 硬执行，不靠文字指令 |
| 2026-02-25 | Plugin 无法被发现：目录内有 `src/index.ts` 但无根级 `index.ts` 且 `package.json` 无 `octopus.extensions` | Plugin `package.json` 必须加 `"octopus": {"extensions": ["./src/index.ts"]}` 否则扫描器忽略该目录 |
| 2026-02-25 | Plugin `package.json` name 与 manifest id 不一致触发警告 | `package.json` name 和 `octopus.plugin.json` id 必须完全一致 |
| 2026-02-25 | async Plugin 入口函数：octopus 忽略 promise，hooks 在 await 之后注册会丢失 | Plugin 入口必须是**同步函数**；异步 DB init 用 `.then()` 在后台完成 |
| 2026-02-25 | `npx prisma generate` 用全局 v7 CLI 报 P1012（url 属性移除） | Plugin Prisma 生成必须用项目 `node_modules/.bin/prisma`（v6.x）；output 指向 `../node_modules/.prisma/client` |
| 2026-02-25 | 企业 octopus 与个人 octopus 共用端口（18789/18791/18792），导致启动冲突 | 用 source 隔离（`/home/baizh/octopus/octopus.mjs`）+ 不同端口（18790/19791） |
| 2026-02-26 | `start.sh` 中 `pkill -f "octopus-gateway"` 会误杀个人 octopus systemd 服务（进程名完全匹配） | pkill 模式必须精确到路径：`pkill -f "octopus/octopus.mjs.*gateway"` |
| 2026-02-26 | Plugin `src/index.ts` 不存在时，octopus 验证 extension entry 报 `escapes package directory`，导致 native gateway 启动超时 | Plugin 放入 plugins 目录后，`src/index.ts` 必须同步创建；否则 octopus config validation 失败拒绝启动 |
| 2026-02-26 | Skill 软链接在 `workspaceOnly: true` 下失效（octopus 做 realpath 后发现路径在沙箱外） | 企业 Skills 改用 `skills.load.extraDirs`，由 native gateway 原生发现，无需软链接 |
| 2026-02-26 | `memory-lancedb-pro` 未配置 `dbPath` 时默认使用 `~/.octopus/memory/lancedb-pro`，企业 agent 会读到个人记忆 | 必须在企业 `octopus.json` 的 plugin config 中显式设置 `dbPath`（当前: `.octopus-state/memory/lancedb-pro`） |
| 2026-02-28 | `memory-lancedb-pro` 将 `<relevant-memories>` 块和时间戳注入用户消息后存入原生历史；工具调用把助手回复拆成多段，刷新后显示多个气泡 | `GET /history` 在返回前：① 从 user 消息剥离记忆块/时间戳前缀；② 合并相邻 assistant 消息；③ 前端 `filterInternalTags()` 渲染时再次兜底 |
| 2026-03-02 | Prisma v7 移除 `datasource.url` 属性（P1012），plugin schema 不兼容 | Plugin 必须 pin `prisma@6` 和 `@prisma/client@6`，不能用 latest |
| 2026-03-02 | Plugins 从 `~/.octopus/plugins/` 迁移到项目目录后，`octopus.json` 路径必须同步更新 | `plugins.load.paths` 指向 `./plugins/`（绝对路径），extensions 在 `.octopus-state/extensions/` |
| 2026-03-02 | Native Gateway state 目录从 `~/.octopus/` 迁移到项目内 `.octopus-state/` | `start.sh` 使用 `OCTOPUS_STATE_DIR` 环境变量覆盖 `--profile enterprise` 默认路径 |
| 2026-03-16 | `~/.octopus` 软链接导致 vitest worker 覆盖企业 `octopus.json`（models 配置丢失） | **已删除 `~/.octopus` 软链接**；企业通过 `OCTOPUS_STATE_DIR` 直接指定路径，不再需要软链接 |
| 2026-03-03 | `MCPRegistry.register()` 与路由各自 `prisma.create()` 导致主键冲突崩溃 | `MCPRegistry.register()` 改用 `upsert`（路由先写 DB，Registry 再同步时不报错） |
| 2026-03-05 | Native Gateway 的 tool 事件（`stream: "tool"`）不广播给所有 WS 连接 | 连接握手必须传 `caps: ["tool-events"]` 才能收到 `sessions_spawn` 等工具事件 |
| 2026-03-05 | SSE done 事件返回短 session ID，前端轮询 history API 返回 403 | SSE/非流式响应必须返回完整 sessionKey（`agent:ent_xxx:session:chat-xxx`），history API 增加短 ID 兜底转换 |
| 2026-03-05 | `config.apply` RPC 是全量替换，发送部分配置会覆盖所有其他配置 | `configApplyFull()` 发完整配置；`configApply()` 先 read → deep merge → write；`baseHash` 用服务端返回值 |
| 2026-03-05 | `config.get` 返回 JSON5 格式（单引号、尾逗号），JSON.parse 报错 | 先尝试 `JSON.parse`，失败后用 `json5` 库解析（`configGetParsed()`） |
| 2026-03-05 | `autoGenerateTitle` 遇到 "label already in use" 会无限重试，刷爆日志 | 添加时间戳后缀 + 最多 3 次重试，超限静默放弃 |
| 2026-03-05 | `config.apply` RPC 是**全量替换**不是 deep merge，发送 `{ agents: { list: [...] } }` 会覆盖整个配置 | 用 `configApplyFull`（发完整配置）或 `configApply`（自动 read-merge-write）；`baseHash` 必须用 `config.get` 返回的 `payload.hash`；raw 是 JSON5 格式需用 `json5` 库解析 |
| 2026-03-06 | **任何** `config.apply` RPC 调用都会触发 native gateway full restart（它会追加 restartReason 到 messages） | 已改用 `config.set` RPC 替代（2026-03-07），不再强制 SIGUSR1；调用前仍需检查数据是否实际变化，无变化则跳过 |
| 2026-03-06 | 前端编辑 agent 无条件发送 `enabled` 等字段，后端 `!== undefined` 判断总是 true，触发不必要的 native sync | 前端编辑时仅发送实际变化的字段；后端对比新旧值（`JSON.stringify`），相同则跳过 native sync |
| 2026-03-06 | `syncAllowAgents` 无条件调用 `configApplyFull`，即使 allowAgents 列表没变 | 必须先对比新旧 `allowAgents`，无变化时 return 跳过 |
| 2026-03-06 | Claude 模型通过 antigravity 反代返回 400 `INVALID_ARGUMENT` | native gateway 对非标准 provider 默认发送 OpenAI 特有参数（`max_completion_tokens`/`store`/`reasoning_effort`），需在模型配置中加 `compat: { supportsStore: false, supportsDeveloperRole: false, maxTokensField: "max_tokens", supportsReasoningEffort: false }` |
| 2026-03-06 | Personal MCP 工具名超 64 字符导致 Claude API 拒绝 | `personalToolName()` 中 serverId 超 16 字符时取后 8 字符缩短，确保所有工具名 ≤ 64 |
| 2026-03-07 | `config.apply` RPC **无条件**发送 SIGUSR1 触发 native gateway full restart，即使变更内容可被动态热加载 | 改用 `config.set` RPC（参数格式相同），由 `[reload]` 模块智能评估：`agents.*` → 热加载不重启，`plugins.*` → 仅在必要时重启。`config.set` 无 rate limit（不在 `CONTROL_PLANE_WRITE_METHODS` 中），无 audit log（可接受） |
| 2026-03-11 | Plugin Prisma schema 只有 `MCPServer`，`run_skill` 用 `prisma.skill.findFirst()` 报 `Cannot read properties of undefined (reading 'findFirst')` | **Plugin Prisma schema 必须包含所有代码中用到的模型**。`undefined.findFirst()` 容易误判为 `_prisma` 为 null，实际是生成的 PrismaClient 缺少对应 model 属性。修复：补全 Skill + DatabaseConnection 模型并 `prisma generate` |
| 2026-03-11 | 企业 Skill 在宿主机执行但 Python 脚本内 `pip install` 被 PEP 668 拦截（externally-managed-environment） | **不依赖脚本内自动 pip install**。在 `data/skills/.venv/` 创建共享虚拟环境预装依赖，`getInterpreter()` 优先使用 venv 的 python3。新增依赖：`data/skills/.venv/bin/pip install <pkg>` |
| 2026-03-11 | `tools.sandbox.tools.allow` 不配置时 ToolFactory 注册的工具（run_skill 等）对 Agent 不可见 | 必须配置 `tools.sandbox.tools.allow: ["*"]`（数组，不能是字符串 `"*"`），否则 plugin 工具全部消失 |
| 2026-03-11 | 多层 bug 叠加（Prisma schema→PEP 668→参数格式）互相掩盖，第一层修好才暴露第二层 | 按层级逐步验证：**数据层→环境层→参数层**，每层确认修好再进下一层 |
| 2026-03-16 | `~/.octopus` 软链接导致 vitest worker 覆盖企业 `octopus.json`，models 配置丢失 | **已删除 `~/.octopus` 软链接**；企业通过 `OCTOPUS_STATE_DIR` 直接指定路径；`start.sh` 启动前自动备份 octopus.json |
| 2026-03-16 | 企业工具名（`list_files`/`read_file`/`write_file`/`execute_command`）与引擎原生工具名（`read`/`write`/`exec`）不一致，导致 `tools.allow` 白名单中的原生工具被引擎标记为 unknown，agent 失去文件和命令执行能力 | `syncAgentNativeConfig` 中加 `TOOL_NAME_TO_ENGINE` 映射表：`list_files→read`、`read_file→read`、`write_file→write`、`execute_command→exec`、`search_files→exec`；DB 和前端继续用语义化名称，写入引擎配置时自动转换 |
| 2026-03-16 | agent 工具调用失败后 LLM 反复换参数重试进入死循环，无法通过前端终止按钮停止 | 三层防护：① 引擎 `loopDetection` 配置启用（8 次警告/15 次阻断/25 次终止）；② MCP 工具层连续失败 3 次自动熔断；③ IM `/cancel` 命令 + 30 分钟兜底超时 |
| 2026-03-16 | 引擎 tool 事件字段名是 `name` 不是 `toolName`，导致 `sessions_spawn` 检测失败，前端 delegation poll 不启动，子 agent 结果不自动显示 | `EngineAdapter.ts` 中 `data.toolName` 改为 `data.toolName \|\| data.name` |
| 2026-03-16 | 删除用户时 workspace 清理失败（sandbox 容器创建的 root 文件，宿主机 uid 无权删除） | `deleteWorkspace` 失败时自动用 Docker `--user root` 清理 |

---

## Part 6: Refactor History（重构记录）

### native-alignment (2026-02-21 → 2026-02-22)
Branch: `refactor/native-alignment`

Enterprise Gateway 从独立 DeepSeek 调用者重构为原生代理层：

- **Phase 1**: OctopusBridge 实现 + 启动脚本
- **Phase 2**: chat.ts 改用原生 agent RPC；删除 SessionStore/DeepSeekCompat/DelegateTools
- **Phase 3**: Agent CRUD 同步到原生 (IDENTITY.md, SOUL.md)
- **Phase 4**: Session 端点代理到原生 sessions.* RPC
- **Phase 5**: Scheduler 代理到原生 cron.* RPC
- **Phase 6**: 清理废弃测试，创建本文件

### Plugin 化 Phase 1 — enterprise-audit (2026-02-25) ✅
- enterprise-audit plugin 已完成，已迁移到 `./plugins/enterprise-audit/`
- 20 个 hook 双写 DB + JSONL 文件，全部验证通过

### Plugin 化 Phase 2 — enterprise-mcp + Skills extraDirs (2026-02-26) ✅
- `enterprise-mcp` plugin 已完成，已迁移到 `./plugins/enterprise-mcp/`
- 从 MySQL 读取 scope=enterprise 的 MCP Server，通过 `api.registerTool()` 注册为原生工具
- 企业 Skills 改用 `skills.load.extraDirs`，删除了 `ensureSkillsLinked()` 软链接逻辑
- 内存隔离：`memory-lancedb-pro` 配置独立 `dbPath`，与个人 octopus 完全隔离

### Phase 1 核心功能加固 (2026-03-02) ✅
- SkillExecutor: 沙箱执行 cwd 强制设为用户 workspace，outputs 目录自动创建
- SkillManager: DB 持久化 + 内存缓存双层架构（启动恢复 + fire-and-forget 写入）
- Plugins 迁移: `~/.octopus/plugins/` → `./plugins/`（版本控制 + 统一管理）
- State 目录迁移: `~/.octopus/` → `.octopus-state/`（项目内版本控制，`OCTOPUS_STATE_DIR` 环境变量）

### 阶段 2 整改 — 消除重复代码 + 性能优化 (2026-03-17) ✅
- chat.ts 瘦身拆分：1432→722 行（减 710 行），提取 sessions.ts(573)、SystemPromptBuilder.ts(277)、ContentSanitizer.ts(59)
- SystemPromptBuilder 添加 (userId, agentId) 缓存（TTL 5min），消除 MCP 双重注入
- 内容净化统一为 ContentSanitizer（替代 4 处分散正则）
- AgentConfigSync.ts 合并 3 处 config RMW 模式（6 RPC→2），消除并发竞争风险
- enterprise-mcp 插件去重：4 个 execute 函数→工厂模式，合并 getMcpFilter/getAllowedConnections 缓存
- 前端 PersonalMcpManager 组件提取，消除 McpSettingsPage/PersonalSettingsPage ~500 行重复
- 中文 agentName 冲突修复：userAgentId() 使用 md5 hash 后缀
- 启动优化：agent 创建 Promise.allSettled 并发，恢复完整 model/tools/allowAgents 配置
- 委派轮询优化：新增轻量 GET /sessions/:id/status，前端先检查再决定是否拉全量

### 阶段 1 整改 — 清理 + 安全 + 快速修复 (2026-03-17) ✅
- 删除死代码约 1800 行（OctopusBridge、SkillTools、HeartbeatForwarder、McpPage、SkillsPage + 3 个测试文件）
- 恢复 sandbox + skills.load.extraDirs 配置（vitest 覆盖丢失）
- 企业 MCP spawn 环境变量过滤（不再继承完整 process.env）
- HMAC 默认密钥启动警告
- start.sh 配置完整性校验
- chat.ts: loadAgent 去重（3→1）、标题生成去重、sleep→轮询、附件函数提取、sessionPrefs TTL、SSE 行缓冲区
- agents.ts: 删除时清理 config entry、ensureDefaultAgent 只查一次、SOUL.md 按需加载、前端乐观更新
- refreshToken DB fallback、Dashboard GROUP BY、MCP 路径统一、密码迁移优化、tools-cache.json 位置迁移
- 前端禁用空转功能（导出/搜索 disabled + tooltip）

### 待做：系统加固
- ~~启用 sandbox~~ ✅ 已改用 Docker sandbox（`tools.exec.host = "sandbox"`）
- ~~提醒机制换 native `cron.add()` RPC~~ ✅ 已完成
- `memory-lancedb-pro` 的 `scopes` 按用户隔离（agentAccess 已有配置，需验证生效）
- 详见 `docs/reports/2026-02-23-system-audit.md`
