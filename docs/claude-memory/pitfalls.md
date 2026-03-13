# 踩坑详录（从 MEMORY.md 拆分）

## Agent 创建与文件注入
- 原生 gateway `agentsCreate` 返回后**异步初始化 workspace**，紧接着调用 `agentFilesSet` 会报 "unknown agent id"
- **必须用重试机制**：首次失败后等 1.5 秒重试（`setFileWithRetry` 函数）
- `agents.ts` 的 `syncToNative()` 和 `chat.ts` 的 `ensureNativeAgent()` 两处都需要重试
- 实际有用的 workspace 文件只有 3 个：IDENTITY.md、SOUL.md、MEMORY.md

## Agent 删除清理
- `agentsDelete` 必须传 `deleteFiles: true`
- 原生 gateway 清内容但不删目录，需额外 `rm -rf` 清理 `.openclaw-state/agents/{agentId}/`
- **gateway cwd 是 `apps/gateway/`**，用 `process.cwd()` 必须 `path.resolve(cwd, '..', '..')` 上溯到项目根
- 延迟 2 秒后清理（等原生 gateway 异步处理完成）

## Agent 工作空间隔离
- 默认 agent workspace: `data/users/{userId}/workspace/`
- 专业 agent workspace: `data/users/{userId}/agents/{agentName}/workspace/`
- **必须隔离**：共享 workspace 会导致 IDENTITY.md/SOUL.md 互相覆盖

## MEMORY.md 铁律（通用版 2026-03-03）
新 agent 创建时自动写入 MEMORY.md，模板定义在 `chat.ts` 的 `MEMORY_RULES_TEMPLATE` 和 `agents.ts` 的 `buildInitialMemory()`。

## Native Gateway WebSocket 事件机制
- `agent` 事件按 `stream` 分类：`lifecycle`/`assistant`/`tool`
- **tool 事件需声明 `caps: ["tool-events"]`** 才能收到
- `chat` 事件（`state: "delta"/"final"`）是独立事件流，带 150ms 节流

## Session ID 格式一致性
- 前端用短 ID（`chat-xxx`），后端用完整 key（`agent:ent_xxx:session:chat-xxx`）
- SSE done 必须返回完整 sessionKey，History API 有短 ID 兜底转换

## Claude 模型 compat 配置
- antigravity 反代使用 Claude 时必须加 `compat` 字段
- `"compat": { "supportsStore": false, "supportsDeveloperRole": false, "maxTokensField": "max_tokens", "supportsReasoningEffort": false }`
- Personal MCP 工具名限制 ≤ 64 字符，`personalToolName()` 已做缩短

## config.set 替代 config.apply（2026-03-07）
- `config.apply` 无条件发 SIGUSR1 触发 full restart
- `config.set` 参数格式一致（`{ raw, baseHash }`），但不强制 SIGUSR1
- `[reload]` 模块智能评估：`agents.*` → 不重启，`plugins.*` → 仅在必要时重启
- `config.set` 无 rate limit，无 audit log（可接受）
- 调用前仍需检查数据是否实际变化

## Multi-Agent 协作（sessions_spawn）
- `subagents.allowAgents` 由 `syncAllowAgents()` 自动同步
- Native Gateway 的 subagent 是**两轮 turn 模型**：
  1. 第一轮：主 agent 调用 `sessions_spawn` → 立即 done → SSE 流关闭
  2. Subagent 异步执行（14-60 秒）
  3. Subagent 完成 → native gateway 将结果注入主 session → 主 agent 被唤醒
  4. 第二轮：主 agent 汇总结果（~12 秒）→ history 才包含完整内容
- 委派结果：SSE `delegated: true` → 前端轮询 history API → **持续更新 + 稳定后停止**
- `toolName` 匹配用 `includes('sessions_spawn')`，不用精确匹配
- 轮询 baseline 必须用**第一次 poll 的 histLen**（同源比较），不能用前端流式文本长度（清洗差异会误触发）
- 轮询策略：每次有新内容就更新 UI，连续 2 次无变化后停止（不能一检测到变化就停，第二轮可能还在生成）
- `delegationPollRef` + `currentSessionRef` 保护：切换会话自动停止轮询，组件卸载清理 timer

## 飞书 SDK 踩坑（2026-03-07）
- `WSClient` 的 `eventDispatcher` 是 `start()` 的参数，**不是构造函数的**
- `LoggerLevel.warn`（小写），不是 `WARN`
- `AuthService` 方法是 `login()`，不是 `authenticate()`
- `callAgent` 的 Promise 只在 RPC 被接受时 resolve，**不等 agent 完成**
  - IM 路由必须用 `new Promise` 包装，在 `done` 事件时 resolve
- 新用户首次 `agentsCreate` 后需等 1.5s
- `IMUserBinding` schema 无 imUserName 字段
- 飞书应用修改可用范围后必须**发布新版本**才生效

## 心跳巡检踩坑（2026-03-07 ~ 2026-03-09）
- `heartbeat.prompt` 未配置时使用默认 prompt（只回复 HEARTBEAT_OK）
- HEARTBEAT.md 必须放在原生 agent 目录（`.openclaw-state/agents/{agentId}/agent/HEARTBEAT.md`），**不是** workspace 目录
- 心跳是 native gateway 内置机制，不经过 `scheduledTask` 表
- 区分心跳和普通对话：`OpenClawBridge.trackedRunIds` 记录 callAgent 的 runId
- **2026-03-09 修复**：HEARTBEAT.md 写入路径错误 + heartbeat 配置缺少 `prompt` 字段 + HEARTBEAT.md 内容为空，三个叠加原因导致心跳不执行
  - 改用 `bridge.agentFilesSet()` RPC 写入（不再直接写 workspace 文件系统）
  - heartbeat 配置必须包含 `prompt: 'HEARTBEAT.md'`
  - 原生 preflight gating：HEARTBEAT.md 仅含注释/空行时跳过执行
- **SchedulerPage 已重构为纯心跳配置页面**，去掉了普通定时任务功能
- **2026-03-09 追加修复**：
  - `heartbeat.model` 字段**不被 native gateway 识别**，必须在 agent 级别设置 `model` 字段
  - scheduler.ts 更新任务时会覆盖 heartbeat 配置，必须每次写入完整配置（含 `model`）
  - HeartbeatForwarder 依赖 WS `agent` 事件，但嵌入式心跳 runner 不广播这些事件，**实际不工作**
  - 改用 `send_im_message` 工具让 agent 在巡检任务中主动发送 IM 通知
  - 内部 API `POST /api/_internal/im/send`（localhost + INTERNAL_API_TOKEN）→ IMService.sendToUser()
  - HEARTBEAT.md prompt 需要强调"必须执行 send_im_message"，否则 DeepSeek 模型可能跳过

## Sandbox 工具可见性（2026-03-11 重大发现）
- `tools.sandbox.tools.allow` 是原生 Gateway 有效配置，控制 sandbox 模式下哪些工具可用
- **必须配置为 `["*"]`**，否则会出现以下问题：
  - 不配置（缺失）：核心工具有（exec/read/write/edit/image 等），但 ToolFactory 注册的 plugin 工具全部不可见
  - 配置为数组列表：只有列表中的工具可见，遗漏任何工具名都会导致该工具消失
  - 配置为字符串 `"*"`：native gateway 启动失败（`expected array, received string`）
  - 配置为 `["*"]`：所有工具可见（核心 + plugin ToolFactory + MCP）✅

## Skill 执行架构（2026-03-11）
- **run_skill 工具**：由 enterprise-mcp 插件通过 `api.registerTool()` 注册到原生 Gateway
- **企业 Skill 在宿主机子进程执行**（`process` 模式），个人 Skill 在 Docker 容器执行
- **不走 sandbox exec**：`tools.exec.host = "sandbox"` 只影响原生的 exec 工具，run_skill 在插件进程内 spawn
- **SkillsInfo.ts**：系统提示只告诉 Agent 用 `run_skill(skill_name="xxx")`，不再暴露脚本路径
- **SkillTools.ts** 已废弃（旧的 OpenAI function call 方式），由 plugin 替代
- **闭包陷阱**：ToolFactory 函数中 `_prisma` 引用必须在 execute 时重新取（不能在外层闭包捕获），否则 gateway 重启后 prisma 被重置为 null 导致 `findFirst` 报错
- **已解决（2026-03-11）**：`_prisma.skill.findFirst()` 报 `Cannot read properties of undefined` 的**真正根因**是 plugin Prisma schema 缺 `Skill` 模型，不是 `_prisma` 为 null。生成的 PrismaClient 没有 `.skill` 属性，`undefined.findFirst()` 报错。修复：补全 `Skill` + `DatabaseConnection` 模型到 `plugins/enterprise-mcp/prisma/schema.prisma` 并重新 generate
- **Skill 脚本路径**：企业 Skill 在 `data/skills/{skill.id}/scripts/` 下，不在 sandbox 容器中

## Python Skill 运行环境（2026-03-11）
- 企业 Skill 通过 `executeSkillInProcess` 在**宿主机**子进程执行（`inDocker: false` 已验证）
- 宿主机系统 Python 有 PEP 668 限制，脚本内 `pip install` 会被拦截
- **解决方案：共享虚拟环境** `data/skills/.venv/`
  - `getInterpreter()` 优先使用 `data/skills/.venv/bin/python3`
  - 新增 Python 依赖：`data/skills/.venv/bin/pip install <package>`
  - 当前已安装：python-pptx、pandas、openpyxl
- Plugin 的 `_dataRootGlobal` 模块级变量存储 dataRoot 路径供 `getInterpreter()` 使用
- **Plugin Prisma schema 规则**：给 plugin 加新 DB 查询时，必须同步更新 schema 并 `npx prisma generate`

## TOOLS.md 动态同步（2026-03-11）
- Admin Console 修改 agent 的 mcpFilter/toolsFilter 时，`routes/agents.ts` 的 `syncToolsMd()` 自动生成 TOOLS.md 写入 agent workspace
- TOOLS.md 是**信息性**文件（告诉模型有哪些工具），不控制实际工具可用性
- 实际可用性由 ToolFactory 动态可见性 + mcpFilter + `tools.sandbox.tools.allow` 控制
