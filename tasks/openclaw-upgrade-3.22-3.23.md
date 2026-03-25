# OpenClaw 3.22 + 3.23 升级规划

> 生成时间：2026-03-23 | 目标：从当前引擎版本升级到 OpenClaw v2026.3.23

---

## 一、版本概览

| 版本 | 类型 | 发布日期 | 变更规模 |
|------|------|----------|----------|
| v2026.3.22 | **大版本** | 2026-03-23 | 18 项破坏性变更 + 大量新功能 + 安全加固 |
| v2026.3.23 | **热修复** | 2026-03-23 | 25+ bug 修复（修复 3.22 引入的问题）|

**建议**：直接升级到 v2026.3.23（包含 3.22 全部内容 + 热修复）

---

## 二、影响分析（按严重程度排序）

### 🔴 必须处理（Breaking Changes 直接影响）

#### 2.1 Plugin SDK 迁移
**变更**：公共接口从 `openclaw/extension-api` 迁移到 `openclaw/plugin-sdk/*`，旧接口移除，无兼容 shim
**影响范围**：全部 3 个企业插件 + memory-lancedb-pro
- `plugins/audit/src/index.ts` — enterprise-audit
- `plugins/mcp/src/index.ts` — enterprise-mcp
- `plugins/email/src/index.ts` — enterprise-email
- memory-lancedb-pro（第三方，需确认是否已适配）

**改动**：
- 审查每个插件的 `api` 对象用法（`registerTool`, `onAgentTurn`, `onToolCall`, `onLLMRequest`, `pluginConfig`, `logger`）
- 更新 import 路径到 `openclaw/plugin-sdk/*`
- 确认 `package.json` 中 `octopus.extensions` 入口格式是否变更
- **入口函数签名**可能有变化，需要验证

**风险**：高 — 插件不兼容直接导致功能丧失（审计、MCP 工具、邮件全部不可用）

#### 2.2 Provider 插件化
**变更**：OpenRouter、GitHub Copilot、**OpenAI Codex**、MiniMax 从核心提取为 bundled plugins
**影响范围**：
- `octopus.json` 中的 `models.providers.openai-codex` 配置
- `octopus.json` 中的 `models.providers.minimax-portal` 配置

**改动**：
- 确认 bundled plugin 是否自动加载，还是需要 `plugins.allow` 显式启用
- 检查 provider 配置格式是否变更（`api: "openai-codex-responses"` 等字段）
- 验证 `openai-codex` OAuth 代理初始化（3.23 已修复相关 bug）
- 如果 bundled plugin 需要额外依赖，确认 Docker sandbox 镜像包含

**风险**：高 — openai-codex 是主力模型之一，配置不兼容会导致 LLM 调用失败

#### 2.3 环境变量清理
**变更**：移除 `CLAWDBOT_*` 和 `MOLTBOT_*` 兼容变量名，统一使用 `OPENCLAW_*`
**影响范围**：
- `start.sh` — 使用 `OCTOPUS_STATE_DIR`（非 CLAWDBOT/MOLTBOT，可能不受影响）
- `.env` 文件
- EngineAdapter 内部引用的环境变量

**改动**：
- `grep -r "CLAWDBOT\|MOLTBOT" .` 全局搜索，替换为 `OPENCLAW_*`
- 确认 `OCTOPUS_STATE_DIR` 是否等价于新的 `OPENCLAW_STATE_DIR`
- 如果引擎改为只认 `OPENCLAW_STATE_DIR`，`start.sh` 需要同步更新

**风险**：中高 — 环境变量不识别会导致引擎无法找到配置/state

#### 2.4 State 目录变更
**变更**：移除 `.moltbot` state-dir 自动检测和迁移 fallback，必须使用 `~/.openclaw` 或 `OPENCLAW_STATE_DIR`
**影响范围**：
- 当前使用 `OCTOPUS_STATE_DIR=.octopus-state/`
- 引擎新版可能只认 `OPENCLAW_STATE_DIR`

**改动**：
- 确认新版引擎的 state 目录环境变量名
- 更新 `start.sh`：`export OPENCLAW_STATE_DIR="$ROOT_DIR/.octopus-state"`
- 可能需要同时保留 `OCTOPUS_STATE_DIR`（企业层自己的代码引用）

**风险**：中 — 路径不对导致引擎创建新的空配置，覆盖现有数据

---

### 🟡 需要适配（功能性变更）

#### 2.5 Memory 插件增强
**变更**：
- 活跃 memory 插件可注册 system-prompt section
- `memory_search` 和 `memory_get` 独立注册

**影响范围**：
- `SystemPromptBuilder.ts` — 当前手动注入 `<relevant-memories>` 块
- `EngineAdapter.ts` — callAgent 事件处理
- `AgentConfigSync.ts` — tools.allow 中的 `memory_search`/`memory_get`

**改动**：
- 如果 memory-lancedb-pro 适配了新的 system-prompt section 注册 API：
  - `SystemPromptBuilder` 中的记忆注入逻辑可能需要调整，避免重复注入
  - 检查是否存在旧的手动注入与新的插件注入冲突
- `memory_search`/`memory_get` 独立注册后，tools.allow 中的条目可能需要更新
- 3.23 修复了 LanceDB 初始化 bootstrap 问题，需确认是否影响 lancedb-pro

**风险**：中 — 记忆重复注入或缺失会影响对话质量

#### 2.6 Message Discovery 机制变更
**变更**：必须使用 `ChannelMessageActionAdapter.describeMessageTool(...)` 发现共享 message 工具，旧方法移除
**影响范围**：
- `apps/server/src/services/im/` — IM 适配器（飞书、微信）
- 如果 IM 适配器使用了旧的 `listActions`/`getCapabilities`/`getToolSchema`

**改动**：
- 检查 IM 适配器是否调用了被移除的 API
- 如果使用了，迁移到新的 `describeMessageTool(...)` 接口

**风险**：中 — 仅在 IM 适配器使用了旧 API 时才有影响

#### 2.7 Agent 默认超时变更
**变更**：Agent 默认超时从 600s 提升至 48h
**影响范围**：
- 心跳检查机制（heartbeat）
- IM 30 分钟兜底超时
- 委派轮询（delegation polling）

**改动**：
- 评估 48h 超时对企业场景是否合适
- 可能需要在 agent config 中显式设置合理超时（如 30min/1h）
- IM 的 30 分钟兜底超时仍然是企业层控制，不受影响

**风险**：低 — 企业层有自己的超时控制，但需要评估资源占用

#### 2.8 exec 安全策略收紧
**变更**：
- `jq` 从默认 safe-bin 移除
- `time` 命令视为透明 wrapper
- SecretRef exec 写入需 `--allow-exec`
- JVM/glibc/.NET 注入阻断

**影响范围**：
- Docker sandbox 内的命令执行
- Skill 脚本中可能使用 `jq`
- `start.sh` 或部署脚本中的命令

**改动**：
- 检查 skill 脚本和 workspace 内是否依赖 `jq`
- 如需保留 `jq`，在引擎配置中显式 opt-in
- JVM 注入阻断对企业 Java 环境可能有影响（如果 agent 调用 Maven/Gradle）

**风险**：低中 — 主要影响特定 skill 脚本

#### 2.9 config set 扩展
**变更**：`config set` 扩展支持 SecretRef、provider builder 模式、JSON batch、`--dry-run`
**影响范围**：
- `EngineAdapter.ts` — configSet() / configApplyFull() / configApply()
- `AgentConfigSync.ts` — 所有配置写入操作

**改动**：
- 评估是否可以利用新的 batch 模式简化 `configApplyFull` 的 read-modify-write 流程
- 检查 configSet 参数格式是否有变化
- `--dry-run` 可用于升级前验证配置兼容性

**风险**：低 — 向后兼容的扩展，但需确认现有调用方式不受影响

---

### 🟢 受益项（无需改动即可获益）

#### 2.10 性能优化（自动获益）
- 启动延迟：channel add、root help、provider fallback 延迟加载
- Model catalog 缓存：按 config/auth state 缓存
- 启动预热：主 model prewarm
- Bundled plugin manifest 在 watch mode 下缓存
- Session cache 过期清理优化

#### 2.11 安全加固（自动获益）
- Windows file:///UNC 路径阻断（虽然企业是 Linux，但属于纵深防御）
- SSRF 加固
- Webhook/inbound 认证加强
- HMAC timing-safe compare
- Shell wrapper 位置参数 allowlist 强化（3.23 进一步修复）

#### 2.12 新功能可选采用
- `/btw` 侧问命令 — 快速无工具回答
- 自动压缩通知 — 用户可见
- ClawHub 生态（skills/plugins marketplace）— 内网环境不可用
- 新 web search providers（Exa/Tavily/Firecrawl）— 内网环境不可用
- 新 providers（anthropic-vertex、Chutes）— 可按需配置
- 可插拔 sandbox 后端（SSH/OpenShell）— 当前用 Docker，可评估

#### 2.13 飞书增强（可选采用）
- 结构化交互审批和快速操作启动卡片
- ACP 和 subagent session 绑定
- `onReasoningStream`/`onReasoningEnd` streaming card
- 扩展运行时 action：消息读/编辑、线程回复、置顶
- 完整线程上下文获取（含历史 bot 回复）

#### 2.14 3.23 修复（自动获益）
- `plugins.allow` 中未知/过期 ID 从 fatal 降为 warning — 降低升级风险
- OpenAI Codex OAuth 代理初始化修复
- Mistral max-token 默认值修正
- Gateway supervision 锁冲突修复
- Skills 配置 SecretRef 解析修复
- Anthropic thinking block 排序修复

---

## 三、升级步骤（建议执行顺序）

### Phase 0: 准备工作（预计 1-2 小时）
- [ ] 0.1 **完整备份**：`cp -r .octopus-state/ .octopus-state.bak-$(date +%Y%m%d)`
- [ ] 0.2 **备份数据库**：`mysqldump` 或等效命令
- [ ] 0.3 **记录当前状态**：`git stash` 或提交所有未提交变更
- [ ] 0.4 **下载新版本引擎**：获取 v2026.3.23 release 包
- [ ] 0.5 **创建升级分支**：`git checkout -b upgrade/openclaw-3.23`
- [ ] 0.6 **阅读完整 Release Notes**：确认无遗漏的破坏性变更

### Phase 1: Plugin SDK 迁移（核心，预计 3-4 小时）
- [ ] 1.1 **分析新 SDK 接口**：对比 `openclaw/extension-api` 与 `openclaw/plugin-sdk/*` 的 API 差异
- [ ] 1.2 **迁移 enterprise-audit**：更新 import 路径、验证 hook 注册 API（20 个 hook）
- [ ] 1.3 **迁移 enterprise-mcp**：更新 import 路径、验证 `registerTool()` API、检查工具缓存逻辑
- [ ] 1.4 **迁移 enterprise-email**：更新 import 路径、验证工具注册
- [ ] 1.5 **验证 memory-lancedb-pro**：确认第三方插件是否已发布 3.22 兼容版本，如未发布需 fork 修复
- [ ] 1.6 **验证插件加载**：确认 `package.json` 的 `octopus.extensions` 入口格式不变
- [ ] 1.7 **运行 TypeScript 编译**：`npx tsc --noEmit` 确保无类型错误

### Phase 2: 引擎替换 + 配置适配（预计 2-3 小时）
- [ ] 2.1 **替换引擎源码**：更新 `packages/engine/` 到 v2026.3.23
- [ ] 2.2 **环境变量迁移**：
  - `grep -r "CLAWDBOT\|MOLTBOT\|OCTOPUS_STATE_DIR\|OCTOPUS_HOME" .` 全局搜索
  - 确认新版引擎接受的环境变量名，更新 `start.sh` 和 `.env`
  - 如果引擎改认 `OPENCLAW_STATE_DIR`，添加映射：`export OPENCLAW_STATE_DIR="$OCTOPUS_STATE_DIR"`
- [ ] 2.3 **配置文件兼容性**：
  - 运行 `openclaw doctor --fix`（如果 CLI 可用）检查配置兼容性
  - 检查 `octopus.json` 中已移除的配置项（`browser.relayBindHost` 等）
  - 确认 provider 配置格式（openai-codex、minimax-portal）
- [ ] 2.4 **Provider 插件化适配**：
  - 确认 openai-codex bundled plugin 是否需要 `plugins.allow` 启用
  - 验证 `models.providers.openai-codex` 配置是否仍然有效
  - 检查 minimax-portal 配置
- [ ] 2.5 **exec 安全策略**：
  - 检查 skill 脚本是否依赖 `jq`，如需要则配置显式 opt-in
  - 验证 Docker sandbox 命令执行不受新 allowlist 影响

### Phase 3: EngineAdapter 适配（预计 2-3 小时）
- [ ] 3.1 **动态导入路径**：确认 `packages/engine/src/gateway/server.js` 路径是否变更
- [ ] 3.2 **RPC 方法兼容性**：逐一验证所有 RPC 调用：
  - `config.get` / `config.set` — 参数格式、返回值
  - `sessions.*` — 会话管理 API
  - `agents.*` — Agent CRUD API
  - `cron.*` — 定时任务 API
  - `chat.*` — 对话 API
  - `tools.catalog` / `models.list` — 工具和模型查询
- [ ] 3.3 **事件格式**：检查引擎事件（text_delta、tool_call、lifecycle、thinking）的字段是否有变更
- [ ] 3.4 **configSet 参数**：验证 batch 模式是否影响现有 configApplyFull 逻辑

### Phase 4: 记忆系统适配（预计 1-2 小时）
- [ ] 4.1 **检查 memory-lancedb-pro 兼容性**：
  - 确认是否需要升级版本
  - 3.23 修复了 LanceDB 初始化 bootstrap，验证是否影响 pro 版
- [ ] 4.2 **System-prompt section 注册**：
  - 如果 memory 插件新增了 system-prompt section 注册能力
  - 检查 `SystemPromptBuilder.ts` 中的手动记忆注入是否与新机制冲突
  - 必要时调整为让插件自行注入，移除手动注入逻辑
- [ ] 4.3 **memory_search/memory_get 独立注册**：
  - 检查 `AgentConfigSync.ts` 中 tools.allow 的 `memory_search`/`memory_get` 是否需要更新
  - 确认引擎侧这两个工具的注册方式是否变化

### Phase 5: IM 适配器检查（预计 1 小时）
- [ ] 5.1 **Message Discovery API**：检查飞书/微信适配器是否使用了被移除的 `listActions`/`getCapabilities`/`getToolSchema`
- [ ] 5.2 **飞书新功能评估**：结构化卡片、线程上下文、streaming card — 判断是否值得集成
- [ ] 5.3 **飞书附件路由修复**（3.23）：验证媒体文件附件是否受影响

### Phase 6: 验证与测试（预计 2-3 小时）
- [ ] 6.1 **TypeScript 编译**：
  ```bash
  cd apps/server && npx tsc --noEmit
  ```
- [ ] 6.2 **启动测试**：
  ```bash
  ./start.sh start
  curl http://localhost:18790/health
  ```
- [ ] 6.3 **插件加载验证**：检查日志确认 4 个插件全部加载成功（audit、mcp、email、memory-lancedb-pro）
- [ ] 6.4 **对话测试**：发送一条消息，验证完整对话流程
- [ ] 6.5 **Agent CRUD**：创建/更新/删除 agent，验证配置同步
- [ ] 6.6 **工具调用**：测试 MCP 工具、Skill 执行、文件操作
- [ ] 6.7 **记忆系统**：验证记忆存取、隔离是否正常
- [ ] 6.8 **心跳检查**：确认 heartbeat cron 正常触发
- [ ] 6.9 **IM 测试**：微信/飞书发消息，验证收发正常
- [ ] 6.10 **Docker sandbox**：exec 命令在沙箱内正常执行
- [ ] 6.11 **回归检查**：运行 `npx vitest run`（如有测试）

---

## 四、风险矩阵

| 风险项 | 影响 | 可能性 | 缓解措施 |
|--------|------|--------|----------|
| Plugin SDK 不兼容导致插件全部失效 | 🔴 严重 | 高 | 提前在隔离环境测试；保留旧版引擎可快速回滚 |
| openai-codex provider 配置失效 | 🔴 严重 | 中 | 3.23 已修复 OAuth 初始化；升级前确认配置格式 |
| 环境变量名变更导致 state 目录丢失 | 🔴 严重 | 中 | 完整备份 .octopus-state/；`start.sh` 同时导出新旧变量名 |
| memory-lancedb-pro 不兼容 | 🟡 中等 | 中 | 检查第三方发布情况；准备 fork 方案 |
| IM 适配器 API 变更 | 🟡 中等 | 低 | 企业 IM 适配器是自研，不直接使用被移除的 API |
| exec allowlist 收紧影响 skill 执行 | 🟡 中等 | 低 | Docker sandbox 内执行，allowlist 可能不完全适用 |
| configSet RPC 参数格式变化 | 🟡 中等 | 低 | 渐进测试，保留 configApplyFull 重试机制 |

---

## 五、回滚方案

1. **快速回滚**（< 5 分钟）：
   ```bash
   ./start.sh stop
   # 恢复引擎源码
   git checkout main -- packages/engine/
   # 恢复配置
   cp -r .octopus-state.bak-YYYYMMDD/* .octopus-state/
   ./start.sh start
   ```

2. **完整回滚**（< 15 分钟）：
   ```bash
   git checkout main
   # 恢复数据库
   mysql < backup.sql
   ./start.sh start
   ```

---

## 六、新功能采用评估

### 值得在后续版本采用的

| 功能 | 价值 | 优先级 | 备注 |
|------|------|--------|------|
| `/btw` 侧问命令 | 快速无工具回答，不污染上下文 | P2 | 企业层可直接透传 |
| 自动压缩通知 | 用户体验改善 | P2 | 无需改动，引擎自动支持 |
| Memory system-prompt section 注册 | 简化 SystemPromptBuilder | P1 | 可消除手动记忆注入 |
| 飞书结构化卡片 | 交互体验升级 | P2 | 需要 IM 适配器配合 |
| config set --dry-run | 升级验证工具 | P1 | 立即可用 |
| 可插拔 sandbox 后端 | 扩展执行环境选择 | P3 | 当前 Docker 方案够用 |

### 内网环境不可用的

- ClawHub 生态（需外网）
- Web search providers（Exa/Tavily/Firecrawl）
- anthropic-vertex provider（需 Google Cloud）
- Chutes provider（需外网）

---

## 七、时间估算

| 阶段 | 估计耗时 | 依赖 |
|------|----------|------|
| Phase 0: 准备 | 1-2h | 无 |
| Phase 1: Plugin SDK 迁移 | 3-4h | Phase 0 |
| Phase 2: 引擎替换 + 配置 | 2-3h | Phase 0 |
| Phase 3: EngineAdapter 适配 | 2-3h | Phase 2 |
| Phase 4: 记忆系统 | 1-2h | Phase 1, 3 |
| Phase 5: IM 检查 | 1h | Phase 2 |
| Phase 6: 验证测试 | 2-3h | Phase 1-5 |
| **总计** | **12-18h**（约 2-3 天） | |

---

## 八、前置确认清单

升级前必须确认的信息：

- [ ] 获取 v2026.3.23 引擎源码包
- [ ] 确认 memory-lancedb-pro 是否有 3.22 兼容版本
- [ ] 确认新版引擎的 state 目录环境变量名（`OPENCLAW_STATE_DIR` vs `OCTOPUS_STATE_DIR`）
- [ ] 确认 Plugin SDK 新接口文档位置（`openclaw/plugin-sdk/*` 的具体模块结构）
- [ ] 确认 openai-codex bundled plugin 的配置方式
- [ ] 确认是否需要更新 Docker sandbox 镜像（`octopus-sandbox:enterprise`）
