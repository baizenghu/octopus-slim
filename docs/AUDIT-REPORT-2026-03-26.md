# Octopus 全面审查报告 — 2026-03-26

> 项目总监级全面审查，覆盖安全、可靠性、数据一致性、运维成熟度、代码质量、依赖风险 6 大维度 16 个子项。

---

## 审查摘要

- 🔴 Critical: **21 项**
- 🟠 High: **34 项**
- 🟡 Medium: **30 项**
- 🟢 Low/Pass: **9 项**

### Top 10 紧急修复项

| # | 维度 | 发现 | 风险 | 涉及文件 |
|---|------|------|------|----------|
| 1 | 数据一致性 | heartbeat 告警 `user-${match[1]}` 双重拼接，**所有 IM 告警静默丢失** | 🔴 | `init-engine-events.ts:44` |
| 2 | 安全 | `.env` 文件权限 664，所有密钥可被同组/其他用户读取 | 🔴 | `.env` |
| 3 | 安全 | `octopus.json` 含明文 API Key 且已被 git 追踪 | 🔴 | `.octopus-state/octopus.json` |
| 4 | 安全 | `AUDIT_HMAC_KEY` 使用硬编码默认值，审计日志完整性保护失效 | 🔴 | `plugins/audit/src/file-writer.ts:7` |
| 5 | 可靠性 | 单进程无 `uncaughtException` 兜底，引擎崩溃全服务下线 | 🔴 | `index.ts`, `EngineAdapter.ts` |
| 6 | 可靠性 | MySQL 无定期备份策略 | 🔴 | 无备份脚本 |
| 7 | 运维 | SecurityMonitor `alert` 事件无消费者，安全告警进黑洞 | 🔴 | `SecurityMonitor.ts:121` |
| 8 | 运维 | QuotaManager 已实现但未集成，用户配额形同虚设 | 🔴 | `QuotaManager.ts`, `init-services.ts` |
| 9 | 代码质量 | 核心链路（认证→对话→IM）零自动化测试 | 🔴 | `vitest.config.ts` |
| 10 | 依赖 | 引擎 fork 无上游同步机制，4782 文件无安全补丁追踪 | 🔴 | `packages/engine/` |

---

## 一、安全审查

### 1.1 攻击面与端口暴露

**[发现 1.1.1] 企业 Gateway 默认绑定 0.0.0.0，暴露到所有网络接口**
[风险等级] 🔴
[发现] `.env` 第 32 行 `BIND_HOST=0.0.0.0`，企业服务器 18790 端口向所有网络接口暴露。`.env.example` 注释提示"生产环境 127.0.0.1"但实际未遵守。
[建议] 生产环境改为 `127.0.0.1`，通过反向代理对外暴露。
[涉及文件] `.env:32`, `apps/server/src/startup/init-routes.ts:206-208`

**[发现 1.1.2] 引擎端口 19791 已正确绑定 loopback**
[风险等级] 🟢
[发现] 引擎通过 `net.ts:225-227` 默认 loopback 模式绑定 127.0.0.1，安全。
[涉及文件] `packages/engine/src/gateway/net.ts:225-227`

**[发现 1.1.3] /health 端点无认证，泄露内部状态信息**
[风险等级] 🟡
[发现] `/health` 返回数据库状态、Redis 状态、插件信息、`mockLdap` 模式等内部细节，无认证保护。
[建议] 减少返回信息量或增加简单 token 认证。
[涉及文件] `apps/server/src/startup/init-routes.ts:89-129`

**[发现 1.1.4] 所有业务 API 路由均有 JWT 认证保护**
[风险等级] 🟢
[发现] 逐一检查所有路由：`/api/chat/*`、`/api/agents/*`、`/api/admin/*` 等均使用 `authMiddleware`，管理路由叠加 `adminOnly`。头像 GET 端点无认证但已有路径穿越防护。
[涉及文件] `apps/server/src/startup/init-routes.ts`

**[发现 1.1.5] 内部路由有双重保护（IP 白名单 + Token）**
[风险等级] 🟢
[发现] `im-internal.ts` 和 `chat-internal.ts` 实现 IP 白名单（仅 127.0.0.1）+ `x-internal-token` 认证，Token 未配置时自动禁用路由（503）。
[涉及文件] `apps/server/src/routes/im-internal.ts:32-42`, `chat-internal.ts:35-45`

---

### 1.2 IM Webhook 验签

**[发现 1.2.1] 企业层飞书使用 WebSocket 模式，无 webhook 入口**
[风险等级] 🟡
[发现] 企业层 `FeishuAdapter.ts` 使用 `WSClient` WebSocket 长连接，不走 HTTP webhook，SDK 内部处理认证。但 `EventDispatcher` 创建时传入空对象 `{}`，未来切换 webhook 模式将无法验签。引擎原生飞书 channel 在 webhook 模式下有完整验签。
[建议] 添加注释标注此限制。
[涉及文件] `apps/server/src/services/im/FeishuAdapter.ts:39`, `channels/feishu-native/src/client.ts:173-177`

**[发现 1.2.2] 微信使用 long-poll，无外部可达回调端点**
[风险等级] 🟢
[涉及文件] `apps/server/src/services/im/WeixinAdapter.ts:44-48`

**[发现 1.2.3] 伪造 webhook 消息无法触发 agent 执行**
[风险等级] 🟢

---

### 1.3 Docker Socket 权限

**[发现 1.3.1] start.sh 使用 sg docker 获取 docker 组权限——等价于 root**
[风险等级] 🟠
[发现] `start.sh:18-19` 通过 `sg docker -c` 获取 docker socket 访问权限，docker 组成员理论上等价于 root。这是 Docker sandbox 固有限制。
[建议] 考虑 rootless Docker 或 docker socket proxy 限制可用 API。
[涉及文件] `start.sh:18-19`

**[发现 1.3.2] 沙箱容器安全配置完善**
[风险等级] 🟢
[发现] cap-drop ALL、no-new-privileges、seccomp/apparmor 支持、非 root 用户（uid=2000）、独立网络、敏感端口封锁、环境变量清洗。
[涉及文件] `packages/engine/src/agents/sandbox/config.ts:105`, `docker.ts:379-387`, `docker/sandbox/Dockerfile:88-103`

**[发现 1.3.3] iptables 规则需手动执行，start.sh 不自动配置**
[风险等级] 🟠
[发现] `setup-network.sh` 需 `sudo` 手动执行。若忘记执行，沙箱容器可直接访问宿主机 MySQL/Redis/引擎端口。
[建议] `start.sh` 启动时检查 iptables DOCKER-USER 规则是否存在。
[涉及文件] `docker/sandbox/setup-network.sh:18-42`, `start.sh:204-213`

**[发现 1.3.4] .env 文件包含所有生产密钥明文**
[风险等级] 🔴
[发现] `.env` 包含 MySQL 密码、Redis 密码、JWT Secret、飞书 App Secret、API Key、DB 加密密钥等。
[建议] 确认文件权限 600；生产考虑 vault 方案。
[涉及文件] `.env`

**[发现 1.3.5] octopus.json 包含 API Key 明文**
[风险等级] 🔴
[发现] `.octopus-state/octopus.json:29` 含 DeepSeek API Key 明文。`GET /api/admin/config` 直接返回含明文 apiKey 的完整配置。CLAUDE.md Backlog P1 已记录此问题。
[建议] API Key 移至环境变量；admin API 返回时脱敏。
[涉及文件] `.octopus-state/octopus.json:29,54`, `apps/server/src/routes/system-config.ts:66-78`

---

### 1.4 认证与授权完整性

**[发现 1.4.1] auth 缓存窗口期——删除/禁用用户后仍可访问最长 5 分钟**
[风险等级] 🟠
[发现] `authMiddleware` 使用 `userIdCache`（TTL 5 分钟）缓存 userId→roles 映射，被删除/降权的用户在缓存过期前可继续访问。
[建议] 缩短 TTL 至 30-60 秒；删除用户时主动清除缓存条目。
[涉及文件] `apps/server/src/middleware/auth.ts:50-77`, `apps/server/src/config.ts:133`

**[发现 1.4.2] Refresh Token 在 prisma 未传入时跳过用户有效性检查**
[风险等级] 🟡
[发现] `prisma` 参数可选，为 `null` 时 refresh 端点完全跳过用户状态校验。
[建议] `prisma` 为 null 时拒绝 refresh 请求。
[涉及文件] `apps/server/src/routes/auth.ts:114-122`

**[发现 1.4.3] adminOnly 中间件覆盖所有管理路由**
[风险等级] 🟢
[涉及文件] `admin.ts`, `audit.ts`, `skills.ts`, `mcp.ts`, `system-config.ts`

**[发现 1.4.4] toolsFilter/skillsFilter/mcpFilter 后端未做白名单校验**
[风险等级] 🟠
[发现] `agents.ts` 的 POST/PUT 路由直接将前端传入的 filter 数组存入 DB，不校验值是否在允许范围内。`allowedConnections` 可包含其他用户的数据库连接名。
[建议] 对 `allowedConnections` 做归属校验；对 `mcpFilter` 验证 MCP Server 存在。
[涉及文件] `apps/server/src/routes/agents.ts:249-265,310-325`

**[发现 1.4.5] abort 端点存在 session 归属校验绕过**
[风险等级] 🟡
[发现] `sessions.ts` 的 abort 路由在 sessionId 不以 `agent:` 开头时跳过归属校验。由于使用 `tenantBridge` 自动带用户前缀，实际风险较低。
[涉及文件] `apps/server/src/routes/sessions.ts:552-578`

---

### 1.5 敏感信息暴露

**[发现 1.5.1] ecosystem.config.js 命令行参数暴露 Gateway Token**
[风险等级] 🔴
[发现] `--token ${GW_TOKEN}` 拼入 args 字符串，`ps aux` 和 `/proc/<pid>/cmdline` 完全可见。
[建议] 将 token 从命令行参数移至环境变量传递。
[涉及文件] `ecosystem.config.js:35`

**[发现 1.5.2] .env 文件权限过于宽松（664）**
[风险等级] 🔴
[发现] `.env` 权限 `rw-rw-r--`，同组可读写、其他可读，含所有核心密钥。
[建议] 执行 `chmod 600 .env`。
[涉及文件] `.env`

**[发现 1.5.3] 模型 API Key 明文存储在 octopus.json 且通过 admin API 返回**
[风险等级] 🔴
[发现] DeepSeek、MiniMax API Key 明文存储。`GET /api/admin/config` 注释明确说"含明文 apiKey"。且该文件已被 git 追踪（历史提交中留存明文密钥）。
[建议] `git rm --cached`；用 `git filter-repo` 清除历史；API Key 移至环境变量；admin API 返回时脱敏。
[涉及文件] `.octopus-state/octopus.json:29,54`, `apps/server/src/routes/system-config.ts:66-78`

**[发现 1.5.4] AUDIT_HMAC_KEY 使用默认值，审计日志完整性保护失效**
[风险等级] 🔴
[发现] `file-writer.ts:7` fallback 为 `'default-audit-key-change-me'`，`.env` 中未配置。HMAC 签名链的设计合理，但密钥问题使其失效。
[建议] `.env` 中添加 `AUDIT_HMAC_KEY=<openssl rand -hex 32>`；启动时校验非默认值。
[涉及文件] `plugins/audit/src/file-writer.ts:7-11`, `.env.example:66`

**[发现 1.5.5] DatabaseConnection.dbPassword 使用 AES-256-GCM 加密**
[风险等级] 🟢
[涉及文件] `apps/server/src/utils/crypto.ts`, `routes/db-connections.ts:56,84`

---

### 1.6 多租户隔离

**[发现 1.6.1] userId 含 `.` 字符时 agentId 前缀碰撞**
[风险等级] 🟠
[发现] `admin.ts:291` 允许用户名含 `.`，但 `userAgentId()` 的 `replace(/[^a-z0-9_-]/g, '')` 会移除 `.`，可能导致 `user-a.b` 和 `user-ab` 映射到相同前缀。
[建议] 禁止用户名含 `.`，或非 ASCII 字符被移除时始终添加 hash 后缀。
[涉及文件] `EngineAdapter.ts:627-635`, `admin.ts:131,291`

**[发现 1.6.2] files.ts 路径穿越防护已正确实现**
[风险等级] 🟢
[发现] 多层防护：`..` 检查、`path.resolve` 前缀比对、符号链接检查。
[涉及文件] `apps/server/src/routes/files.ts`, `packages/workspace/src/WorkspaceManager.ts:109-142`

**[发现 1.6.3] session 归属校验依赖字符串前缀匹配（有效）**
[风险等级] 🟢
[涉及文件] `apps/server/src/utils/ownership.ts`

**[发现 1.6.4] sandbox Docker bind mount 共享 skills 目录为只读**
[风险等级] 🟡
[发现] `/data/skills` 以只读挂载到所有容器，个人 skill 在 `users/{userId}/workspace/skills/` 下未被共享，正确。
[涉及文件] `.octopus-state/octopus.json:111-114`

**[发现 1.6.5] workspace 目录权限 0o777**
[风险等级] 🟡
[发现] Docker sandbox uid=2000 需要写权限，777 是功能需要。
[建议] 考虑 ACL 替代 777。
[涉及文件] `packages/workspace/src/WorkspaceManager.ts:46`

**[发现 1.6.6] system-config API 允许 admin 修改全部引擎配置**
[风险等级] 🟡
[发现] admin 可通过 API 修改所有用户 agent 配置、禁用安全策略。符合设计意图但缺少变更审计。
[建议] config 变更时记录详细审计日志（变更前后 diff）。
[涉及文件] `apps/server/src/routes/system-config.ts`

---

## 二、可靠性审查

### 2.1 单点故障

**[发现 2.1.1] Engine 与 Enterprise Server 同进程——未捕获异常导致全服务崩溃**
[风险等级] 🔴
[发现] `EngineAdapter.initialize()` 在进程内启动引擎 gateway。全局未注册 `uncaughtException`/`unhandledRejection` 处理器。引擎内部异步调用抛出未捕获异常时，整个服务同时崩溃。
[建议] 注册全局异常兜底处理器；考虑将引擎拆为子进程实现故障隔离。
[涉及文件] `apps/server/src/index.ts:78-91`, `apps/server/src/services/EngineAdapter.ts:81-141`

**[发现 2.1.2] PM2 配置路径偏差、依赖检测靠 restart_delay**
[风险等级] 🟠
[发现] `ecosystem.config.js` 的 `gateway` 指向 `apps/gateway`（不存在），`native-gateway` 指向 `/home/baizh/octopus-main/octopus.mjs`（不存在）。PM2 不原生支持 `depends_on`。
[建议] 明确部署模式，修正路径。
[涉及文件] `ecosystem.config.js:33-99`

**[发现 2.1.3] MySQL 不可用时启动继续，但后续所有 DB 操作 500**
[风险等级] 🟠
[发现] Prisma 连接失败时仅 warn 继续，`prismaClient` 为 `undefined`，所有使用 `prisma` 的路由抛 TypeError。
[建议] DB 不可用时核心路由返回 503 而非 TypeError 500。
[涉及文件] `apps/server/src/startup/init-services.ts:70-136`

**[发现 2.1.4] Redis 断后永不重连，内存 fallback 重启丢失**
[风险等级] 🟡
[发现] `retryStrategy` 3 次后返回 `null` 彻底放弃重连。Redis 恢复后进程内也无法自动重连。
[建议] 支持 Redis 自动重连。
[涉及文件] `apps/server/src/startup/init-services.ts:41-55`

**[发现 2.1.5] Docker daemon 不可用无检测，execFileSync 阻塞事件循环**
[风险等级] 🟠
[发现] `admin.ts:299` 使用同步调用，阻塞 10 秒。无启动时 Docker 健康检查。
[建议] 启动时检测 Docker 可用性；同步调用改异步。
[涉及文件] `apps/server/src/routes/admin.ts:296-313`

**[发现 2.1.6] systemd Type=forking 与实际不符**
[风险等级] 🟠
[发现] `octopus.service` 配置 `Type=forking` + `RemainAfterExit=yes`，与实际启动方式不匹配。与 PM2 `autorestart` 混用语义冲突。
[建议] 改为 `Type=simple` 或统一使用 PM2。
[涉及文件] `deploy/octopus.service:28,56`

---

### 2.2 数据持久性

**[发现 2.2.1] MySQL 无自动备份策略**
[风险等级] 🔴
[发现] 仅 `scripts/migrate-pack.sh` 中有一次性 mysqldump，无定期备份、无备份验证、无告警。
[建议] 配置 cron 定期 mysqldump + 远程存储；至少保留 7 天。
[涉及文件] `scripts/migrate-pack.sh:129-138`

**[发现 2.2.2] .octopus-state LanceDB/cron 数据无备份**
[风险等级] 🟠
[发现] `start.sh` 仅备份 `octopus.json`（保留 10 份），LanceDB 向量记忆数据库、session transcript 无备份。
[建议] `.octopus-state/` 整体纳入每日备份。
[涉及文件] `start.sh:169-175`

**[发现 2.2.3] FileCleanupService 覆盖范围不完整**
[风险等级] 🟡
[发现] 不覆盖 LanceDB 记忆数据、session transcript；`cleanExpiredFromDB` 每次最多 100 条。无磁盘空间监控。
[建议] 增加 session TTL 清理；增加磁盘告警。
[涉及文件] `apps/server/src/services/FileCleanupService.ts:61-108`

---

### 2.3 并发与竞态

**[发现 2.3.1] configApply/configApplyFull/configTransaction mutex 交互风险**
[风险等级] 🔴
[发现] `skills.ts:67` 调用 `configApply`，`admin.ts:379` 调用 `configApplyFull`，均独立持有 `configMutex`。`ConfigBatcher.flush()` 不持有 mutex 直接调用 `applyFn`，batcher 批处理窗口与 `configTransaction` 争用 mutex，可能导致串行化降级。
[建议] 审查 mutex 层级关系，统一写入路径。
[涉及文件] `skills.ts:67`, `admin.ts:379`, `config-batcher.ts:45-62`, `EngineAdapter.ts:486-576`

**[发现 2.3.2] ConfigBatcher flush 失败全量 reject**
[风险等级] 🟠
[发现] `applyFn` 抛异常时，批次内所有 `PendingPatch` 同时 reject，无论哪个 patch 无害。
[建议] 失败后将合并 patch 重新入队（带退避）。
[涉及文件] `apps/server/src/utils/config-batcher.ts:45-62`

**[发现 2.3.3] trackedRunIds 全局 Set 存在事件错位和内存泄漏**
[风险等级] 🟠
[发现] SSE 提前断开而引擎未发 lifecycle end 时，runId 永久留在 Set 中。
[建议] 用 Map 替代 Set；SSE close 后强制 cleanup；增加大小监控。
[涉及文件] `apps/server/src/services/EngineAdapter.ts:69,249,319,352`

**[发现 2.3.4] 启动时 agent 同步失败仅 warn，配置不完整无重试**
[风险等级] 🟡
[发现] 串行同步 for 循环中某个 agent 失败后，后续全部跳过。失败 agent 在引擎中存在但配置不完整。
[建议] 记录"待同步队列"，后台退避重试。
[涉及文件] `apps/server/src/startup/init-services.ts:193-219`

**[发现 2.3.5] skills.entries 无启动时 DB→引擎对账**
[风险等级] 🟠
[发现] 启动同步逻辑仅同步 agent 配置，不包含 skills.entries 对账。`octopus.json` 从备份恢复后，skill enabled 状态可能与 DB 不一致。
[建议] 启动时增加 skills.entries 对账。
[涉及文件] `apps/server/src/routes/skills.ts:64-72`, `init-services.ts:180-295`

---

### 2.4 错误恢复

**[发现 2.4.1] SSE 断开后 chatAbort 是 fire-and-forget**
[风险等级] 🟡
[发现] `res.on('close')` 回调中 `chatAbort.catch(() => {})`，abort 失败时引擎继续消耗 token。
[涉及文件] `apps/server/src/routes/chat.ts:330-337`

**[发现 2.4.2] 引擎崩溃时活跃对话无恢复，health() 永远返回 ok**
[风险等级] 🔴
[发现] 单进程崩溃全服务死亡。`EngineAdapter.health()` 单进程模式硬编码返回 ok。`sessionPrefs` Map 全清。
[建议] SSE 增加超时机制；`sessionPrefs` 持久化到 Redis。
[涉及文件] `chat.ts:49,325-337`, `EngineAdapter.ts:620-623`

**[发现 2.4.3] cron job 执行失败无重试策略，普通 cron 无通知**
[风险等级] 🟠
[发现] 仅心跳任务失败有 IM 告警推送（但受 3.3.2 bug 影响实际无法送达），普通 cron 失败无任何通知。
[建议] 监听 cron 失败事件，记录 DB 并推送 IM 告警。
[涉及文件] `apps/server/src/startup/init-engine-events.ts:21-25`

**[发现 2.4.4] 心跳 cron + DB 双写非原子，可产生孤儿 cron**
[风险等级] 🟡
[发现] `cronAdd` 成功但 DB 更新失败时，引擎孤儿 cron 持续运行。下次重启再创建新 cron，导致重复触发。
[建议] 采用"先写 DB→再创建引擎 cron→再更新 DB"三阶段提交。
[涉及文件] `init-services.ts:267-281`, `scheduler.ts:186-208`

---

## 三、数据一致性审查

### 3.1 DB ↔ 引擎双写

**[发现 3.1.1] Agent 删除在引擎断连时静默跳过，孤儿残留 octopus.json**
[风险等级] 🟠
[发现] `agents.ts:441-454` 中引擎清理被 `if (bridge?.isConnected)` 包裹，断连时仅 warn。重启时孤儿清理可补救，但存在窗口期。
[建议] 将删除操作写入待处理队列，引擎重连后重放。
[涉及文件] `apps/server/src/routes/agents.ts:441-454`

**[发现 3.1.2] 孤儿清理正则在 hash agentName 场景下反向解析错误**
[风险等级] 🔴
[发现] `init-services.ts:236` 正则 `^ent_(user-[^_]+)_(.+)$` 在中文 agentName（hash 后缀）时，`nameMatch[2]` 捕获的是哈希串而非 agentName，`syncAgentToEngine` 内对 hash 值再次 hash，最终 ID 不匹配，孤儿永远不会被删除。
[建议] 孤儿清理直接使用 `validIds` 过滤，不通过反向解析 agentId。
[涉及文件] `init-services.ts:236-241`, `EngineAdapter.ts:627-636`

**[发现 3.1.3] Skill 禁用后 agent 级别 skills 白名单不同步**
[风险等级] 🟠
[发现] `syncSkillEnabledToEngine` 仅更新引擎全局 `skills.entries`，不调用 `syncAgentToEngine` 刷新各 agent 的 `skills` 字段。
[建议] skill 禁用时同时遍历引用该 skill 的 agent 更新白名单。
[涉及文件] `apps/server/src/routes/skills.ts:64-72,518-542`

**[发现 3.1.4] MCP 变更通知为单向 fire-and-forget，无确认机制**
[风险等级] 🟡
[发现] `notifyMCPRegistryChanged` 通过写信号文件通知 plugin，写失败仅 warn，plugin file watcher 未触发时 `tools-cache.json` 过时。
[涉及文件] `apps/server/src/routes/mcp.ts:61-71`

---

### 3.2 cron 一致性

**[发现 3.2.1] cron 先写引擎内存后写 DB，DB 失败时引擎孤儿 cron 持续运行**
[风险等级] 🟠
[发现] `scheduler.ts:186-206` 先 `cronAdd` 后 `prisma.create`，步骤 2 失败时引擎孤儿 cron 无 DB 记录、用户不可见、无法删除。
[建议] 改为先写 DB、后注册引擎 cron。
[涉及文件] `apps/server/src/routes/scheduler.ts:186-206,303-336`

**[发现 3.2.2] 用户删除时 cron 清理失败静默，DB 已删但引擎孤儿 cron 持续运行**
[风险等级] 🟡
[发现] `admin.ts:250-263` cron 清理 try-catch 包裹，异常仅打日志。`listMyCrons` 调用失败时所有 cron 残留引擎内存。
[建议] 引入清理失败记录表；重启时全量比对引擎 cron。
[涉及文件] `apps/server/src/routes/admin.ts:250-263,317-318`

**[发现 3.2.3] 重启后 cronJobId 更新失败时 DB 存储失效 ID**
[风险等级] 🟡
[发现] `init-services.ts:276-280` DB 更新失败时保留旧 cronJobId，后续"立即执行"操作静默 400。
[涉及文件] `init-services.ts:276-285`, `scheduler.ts:443-448`

---

### 3.3 heartbeat 事件处理

**[发现 3.3.1] heartbeat 正则在 agentName 含下划线时 userId 提取错误**
[风险等级] 🔴
[发现] `init-engine-events.ts:41` 使用 `^ent_(.+?)_[^_]+$`，非贪婪 `(.+?)` 在 agentName 含下划线时将 agentName 部分误捕获为 userId。Agent 名称无下划线限制（`agents.ts:242` 仅要求非空字符串）。
[建议] 正则改为 `^ent_(user-[^_]+)_(.+)$`；或在 admin.ts 层面强制 agentName 禁止下划线。
[涉及文件] `init-engine-events.ts:41-44`, `agents.ts:242-244`

**[发现 3.3.2] `user-${match[1]}` 双重拼接——所有心跳 IM 告警静默丢失**
[风险等级] 🔴
[发现] `match[1]` 已包含 `user-` 前缀（如 `user-alice`），代码再拼接 `user-` 变成 `user-user-alice`，DB 中永远无此 userId。**结果：所有心跳告警 IM 推送目标不存在，告警 100% 丢失。**
[建议] 改为 `userIds = [match[1]]`，去掉 `user-` 前缀拼接。
[涉及文件] `apps/server/src/startup/init-engine-events.ts:41-44`

---

## 四、运维成熟度审查

### 4.1 可观测性

**[发现 4.1.1] 日志为纯文本格式，无法零配置接入 ELK/Loki**
[风险等级] 🟠
[发现] `formatLog()` 输出人类可读文本，非标准 JSON Lines。
[建议] 增加 `LOG_FORMAT=json` 环境变量开关。
[涉及文件] `apps/server/src/utils/logger.ts:19-22`

**[发现 4.1.2] 无 Prometheus/metrics 端点**
[风险等级] 🟠
[发现] 无 `prom-client` 依赖，无 `/metrics` 路由。
[建议] 引入 `prom-client`，采集 HTTP QPS/延迟、SSE 连接数、RPC 耗时。
[涉及文件] `apps/server/src/startup/init-routes.ts`

**[发现 4.1.3] 无 Request ID，跨层追踪断链**
[风险等级] 🟠
[发现] 无 `requestId`/`traceId` 注入机制，并发请求日志无法聚合为链路。
[建议] Express 入口生成 UUID，注入 `req.requestId`，EngineAdapter 透传。
[涉及文件] `apps/server/src/startup/init-routes.ts`, `utils/logger.ts`

**[发现 4.1.4] SecurityMonitor alert 事件无任何消费者——告警进黑洞**
[风险等级] 🔴
[发现] `raiseAlert` 通过 `this.emit('alert', event)` 发出事件，但全代码库无 `securityMonitor.on('alert', ...)` 注册。`sendImAlert()` 依赖 `INTERNAL_API_TOKEN`，未设置时直接 return。安全告警仅在日志里打一行 warn。
[建议] 显式注册 alert 事件消费者；确保 `INTERNAL_API_TOKEN` 强制配置。
[涉及文件] `apps/server/src/services/SecurityMonitor.ts:121,133`

---

### 4.2 部署流程

**[发现 4.2.1] 项目无任何 CI/CD 配置**
[风险等级] 🟠
[发现] 无 `.github/workflows/`、Jenkinsfile 等。
[建议] 建立基础 CI：tsc 类型检查 + vitest 测试。
[涉及文件] 项目根目录

**[发现 4.2.2] 无零停机部署方案**
[风险等级] 🟠
[发现] PM2 单实例模式，reload 有中断。`start.sh` 使用硬终止。
[建议] PM2 配置 `cluster` 模式。
[涉及文件] `ecosystem.config.js:67-99`, `start.sh:47-81`

**[发现 4.2.3] 无多环境配置管理**
[风险等级] 🟠
[发现] 仅一份 `.env`。`ecosystem.config.js` gateway 写死 `production`，admin-console 写死 `development`。
[建议] 建立分层配置。
[涉及文件] `ecosystem.config.js:75,109`

**[发现 4.2.4] 数据库迁移无版本管理**
[风险等级] 🟠
[发现] 仅有 `001_init.sql`，Prisma 无 migrations 目录。`schema.prisma` 字段与 SQL 已分叉。
[建议] 执行 `prisma migrate init` 纳入管理。
[涉及文件] `database/migrations/001_init.sql`, `prisma/schema.prisma`

---

### 4.3 部署配置一致性

**[发现 4.3.1] ecosystem.config.js gateway cwd 指向不存在的 apps/gateway**
[风险等级] 🔴
[发现] 第 71 行 `cwd: path.join(ROOT_DIR, 'apps', 'gateway')`，实际目录为 `apps/server`。PM2 无法启动。
[建议] 修正为 `apps/server`。
[涉及文件] `ecosystem.config.js:71`

**[发现 4.3.2] 硬编码 /home/baizh/octopus-main/octopus.mjs 路径不存在**
[风险等级] 🟠
[发现] `native-gateway` 进程脚本路径绑定特定用户家目录，当前环境不存在。
[建议] 改为相对路径或环境变量注入。
[涉及文件] `ecosystem.config.js:34`

**[发现 4.3.3] start.sh 与 ecosystem.config.js 启动模型互不兼容**
[风险等级] 🟡
[发现] 两套工具互不感知（PID 文件 vs PM2 内部 ID），均使用 tsx 开发模式运行。
[建议] 统一到一种部署工具。
[涉及文件] `start.sh:243,267`, `ecosystem.config.js:70-71,106`

---

### 4.4 容量规划

**[发现 4.4.1] QuotaManager 已实现但未被 server 集成——配额形同虚设**
[风险等级] 🔴
[发现] `packages/quota/src/QuotaManager.ts` 实现了 Redis 限流（token_daily、token_monthly、request_hourly），但 `init-services.ts` 中未实例化，所有路由未调用 `checkQuota`/`consumeQuota`。
[建议] 集成到 chat.ts SSE 入口。
[涉及文件] `packages/quota/src/QuotaManager.ts`, `apps/server/src/startup/init-services.ts`

**[发现 4.4.2] Docker sandbox 容器无 CPU/内存上限**
[风险等级] 🟠
[发现] `octopus.json` 的 `sandbox.docker` 未配置 `memory`/`cpus`/`pidsLimit`。多用户并发可堆积大量容器耗尽宿主机资源。
[建议] 补充 `"memory": "512m", "cpus": 0.5, "pidsLimit": 256`。
[涉及文件] `.octopus-state/octopus.json:105-116`

**[发现 4.4.3] 单进程架构无多核利用**
[风险等级] 🟡
[发现] PM2 单实例模式，Node.js 单线程。CPU 密集操作阻塞事件循环。
[建议] 短期 PM2 cluster 模式；长期评估引擎拆分独立进程。
[涉及文件] `ecosystem.config.js:63-99`

---

## 五、代码质量审查

### 5.1 类型安全

**[发现 5.1.1] EngineAdapter 动态导入返回 any**
[风险等级] 🟠
[发现] `EngineAdapter.ts:26` 使用 `new Function()` 返回 `Promise<any>`，`534` 行链式 any。
[涉及文件] `apps/server/src/services/EngineAdapter.ts:26,534`

**[发现 5.1.2] FeishuAdapter wsClient 声明为 any**
[风险等级] 🟠
[发现] `FeishuAdapter.ts:20` `private wsClient: any`，SDK 类型完全丢失。
[涉及文件] `apps/server/src/services/im/FeishuAdapter.ts:20,41,57,105`

**[发现 5.1.3] init-engine-events.ts 引擎事件 payload 全部 any**
[风险等级] 🟠
[发现] 心跳/cron 事件字段在 CLAUDE.md 已明确记录，但无接口定义。
[建议] 在 `types/engine.ts` 补充 `EngineCronPayload`、`EngineHeartbeatEvent` 接口。
[涉及文件] `apps/server/src/startup/init-engine-events.ts:21,33,50-51`

**[发现 5.1.4] auth.ts 中间件 prisma 参数含 any**
[风险等级] 🟠
[涉及文件] `apps/server/src/middleware/auth.ts:47`

**[发现 5.1.5] chat.ts prisma 参数声明为 any**
[风险等级] 🟡
[涉及文件] `apps/server/src/routes/chat.ts:69`

**[发现 5.1.6] Prisma JSON 字段无运行时校验，直接 as 转型**
[风险等级] 🟡
[发现] `Agent.identity`（JSON 类型）在 `SystemPromptBuilder.ts:132`、`IMRouter.ts:376,435` 通过 `as { name?: string }` 断言，无形状校验。
[建议] 封装 `parseIdentity()` 工具函数。
[涉及文件] `SystemPromptBuilder.ts:132`, `IMRouter.ts:376,435`

**[发现 5.1.7] 前端 55 处 any 使用**
[风险等级] 🟡
[涉及文件] `apps/console/src/pages/` 多文件

**[发现 5.1.8] tsconfig.json exclude 排除企业层代码**
[风险等级] 🟠
[发现] 根 `tsconfig.json:22` exclude 了 `packages`、`apps`、`channels`、`plugins`，根级 strict 规则不覆盖业务代码。
[建议] 验证 CI 在各子包分别执行 `tsc --noEmit`。
[涉及文件] `tsconfig.json:22`

---

### 5.2 大文件拆分

| 文件 | 行数 | 拆分优先级 | 建议 |
|------|------|-----------|------|
| `mcp.ts` | 869 | 🟠 高 | 拆为 `mcp-enterprise.ts` + `mcp-personal.ts` |
| `AgentsPage.tsx` | 795 | 🟡 | 提取 `AgentEditDrawer.tsx` + `AgentToolsSelector.tsx` |
| `skills.ts` | 738 | 🟡 | Skill 扫描逻辑提取到 `services/SkillDiscovery.ts` |
| `agents.ts` | 736 | 🟡 | MCP 工具列表构建提取到 `services/AgentToolsBuilder.ts` |
| `ChatMessages.tsx` | 712 | 🟡 | 提取 `ToolCallBlock.tsx` + `CodeBlock.tsx` |
| `EngineAdapter.ts` | 647 | 🟡 | 事件处理拆分到 `EngineEventHandler.ts` |
| `IMRouter.ts` | 646 | 🟡 | 命令处理拆分到 `IMCommandHandler.ts` |
| `chat.ts` | 592 | 🟡 | SSE 流处理拆分到 `SSEStream.ts` |
| `AgentConfigSync.ts` | 577 | 🟡 | 相对内聚，暂不拆 |

---

### 5.3 测试覆盖

**[发现 5.3.1] 企业层核心链路零自动化测试**
[风险等级] 🔴
[发现] 59 个源文件对应 4 个测试文件。`EngineAdapter`、`AgentConfigSync`、`IMRouter`、`SystemPromptBuilder`、`auth.ts` 均无测试。
[建议] 优先补充：`AgentConfigSync.test.ts`、`auth.middleware.test.ts`、`IMRouter.test.ts`。
[涉及文件] `apps/server/src/services/__tests__/`

**[发现 5.3.2] 覆盖率阈值 80% 但实际远未达标**
[风险等级] 🔴
[发现] `vitest.config.ts:38-43` 设置 80%/80%/70%/80% 阈值，但核心文件实际覆盖率 ~0%。无 CI 强制执行。
[建议] `test` 脚本加 `--coverage`，使 CI 直接失败。
[涉及文件] `vitest.config.ts:38-43`

**[发现 5.3.3] smoke.test.ts 仅验证环境变量**
[风险等级] 🟠
[发现] 3 个 case 仅验证 `process.env` 和 async 语法，无业务逻辑冒烟。
[建议] 转换 `TEST_PLAN.md` 中的 TC-AUTH-001、TC-AGENT-001 为 vitest + supertest 集成测试。
[涉及文件] `tests/smoke.test.ts`, `tests/TEST_PLAN.md`

**[发现 5.3.4] TenantEngineAdapter 2 个测试 case 当前失败**
[风险等级] 🟠
[发现] Mock 返回裸数组，实现期待 `{ agents: [...] }` 对象，两个 case 断言失败（已通过 `vitest run` 确认）。
[建议] 修正 mock：`vi.fn().mockResolvedValue({ agents })`。
[涉及文件] `apps/server/src/services/__tests__/TenantEngineAdapter.test.ts:50,62`

**[发现 5.3.5] 引擎 fork 企业层修改无回归测试**
[风险等级] 🟠
[发现] `vitest.config.ts` exclude 了引擎原生测试。企业层对引擎 `opaqueImport` 加载的模块无契约测试。
[建议] 为引擎 RPC 接口编写契约测试。
[涉及文件] `vitest.config.ts:17-23`

---

### 5.4 错误处理

**[发现 5.4.1] admin.ts 完全空 catch 块**
[风险等级] 🟠
[发现] `admin.ts:357` `catch { }` 无任何处理，状态目录删除失败完全静默。
[涉及文件] `apps/server/src/routes/admin.ts:357`

**[发现 5.4.2] sessions.ts catch 吞掉 DB 错误**
[风险等级] 🟡
[发现] `loadAgentFromDb` 第 130 行 catch 直接 `return null`；第 209 行 catch 返回空模型列表。
[涉及文件] `apps/server/src/routes/sessions.ts:125-132,207-211`

**[发现 5.4.3] IMRouter 三处空 catch**
[风险等级] 🟠
[发现] 第 41 行（loadActiveAgents）、第 304 行（解绑失败无日志）、第 449 行（listOutputFiles）。
[涉及文件] `apps/server/src/services/im/IMRouter.ts:41,304,449`

**[发现 5.4.4] init-engine-events.ts DB 查询失败仅注释说明**
[风险等级] 🟡
[发现] 第 58 行 `.catch(() => { /* DB 查询失败不阻塞 */ })`，心跳告警推送悄然跳过。
[涉及文件] `apps/server/src/startup/init-engine-events.ts:58`

**[发现 5.4.5] AgentConfigSync tools-cache 解析错误静默返回空数组**
[风险等级] 🟡
[发现] `tools-cache.json` 格式损坏时所有 agent MCP 工具白名单变空，功能无预警降级。
[涉及文件] `apps/server/src/services/AgentConfigSync.ts:49`

**[发现 5.4.6] chat.ts auditLogger 使用 as any 调用**
[风险等级] 🟡
[涉及文件] `apps/server/src/routes/chat.ts:308`

---

### 5.5 文档

**[发现 5.5.1] 无 OpenAPI/Swagger 文档**
[风险等级] 🔴
[发现] 15+ 路由文件、60+ HTTP endpoint，无机器可读 API 规范，无 JSDoc 注解。
[建议] 至少为认证、对话、Agent 管理核心接口生成 OpenAPI spec。
[涉及文件] `apps/server/src/routes/`

**[发现 5.5.2] 运维手册已过期**
[风险等级] 🟠
[发现] `deployment-guide.md` 最后更新 2026-03-03，近期多项变更未反映。
[涉及文件] `docs/deployment-guide.md`

**[发现 5.5.3] 无架构决策记录（ADR）**
[风险等级] 🟡
[发现] 关键决策（单进程架构、SystemPromptBuilder 不迁移、LanceDB 选型）仅以一句话记录在 CLAUDE.md。
[建议] 在 `docs/adr/` 补充 ADR。
[涉及文件] `CLAUDE.md`

**[发现 5.5.4] skill/MCP 开发文档不完整**
[风险等级] 🟡
[发现] 个人 MCP 上传（`.tar.gz/.zip` 解压、Python 项目结构）无文档。
[涉及文件] `docs/skill-development-guide.md`

---

## 六、依赖与供应链审查

### 6.1 依赖安全

**[发现 6.1.1] 漏洞扫描基础设施缺失**
[风险等级] 🟠
[发现] `pnpm audit` 无法执行（npmmirror 不提供 audit 端点）。
[建议] 配置 `audit-registry=https://registry.npmjs.org`，或引入 snyk/socket.dev。
[涉及文件] `.npmrc`

**[发现 6.1.2] 4 个预发布版本依赖**
[风险等级] 🟠
[发现]
| 包名 | 版本 | 阶段 |
|------|------|------|
| `@buape/carbon` | `0.0.0-beta-20260216184201` | beta（0.0.0 极不稳定）|
| `@lydell/node-pty` | `1.2.0-beta.3` | beta |
| `@whiskeysockets/baileys` | `7.0.0-rc.9` | RC |
| `sqlite-vec` | `0.1.7-alpha.2` | alpha |

[涉及文件] `packages/engine/package.json:22,31,41,68`

---

### 6.2 维护风险

**[发现 6.2.1] 引擎核心依赖 @mariozechner/* 为个人维护包**
[风险等级] 🔴
[发现] `@mariozechner/pi-agent-core`、`pi-ai`、`pi-coding-agent`、`pi-tui` 全部由单一个人维护者（badlogic/Mario Zechner）发布，锁定在 0.57.1（上游已到 0.62.0）。
[建议] 确认关键代码已 fork 到 `packages/engine`；建立上游版本监控。
[涉及文件] `packages/engine/package.json:32-35`

**[发现 6.2.2] License 合规——状态良好**
[风险等级] 🟢
[发现] `jszip` 为 `MIT OR GPL-3.0-or-later` 双许可，企业可选 MIT。其余均为宽松许可。
[涉及文件] `packages/engine/package.json:57`

**[发现 6.2.3] Express 版本分裂**
[风险等级] 🟡
[发现] 引擎 Express 5（`^5.2.1`），企业层 Express 4（`^4.18.0`），API 存在不兼容变更。
[建议] 评估统一到 Express 5。
[涉及文件] `packages/engine/package.json:50`, `apps/server/package.json:17`

---

### 6.3 引擎 Fork 维护

**[发现 6.3.1] 4782 个 .ts 文件的大型 fork 无上游同步机制**
[风险等级] 🔴
[发现] 无 upstream remote、无 fork 来源记录、核心包锁定旧版本（0.57.1 vs 0.62.0）。
[建议] 添加 upstream remote；定期 diff 审查；CI 添加依赖版本检查。
[涉及文件] `packages/engine/`

**[发现 6.3.2] 企业层对引擎修改范围可控（+42/-11 行）**
[风险等级] 🟡
[发现] 修改集中在 7 个文件：models-config（添加模型）、embedded runner（bug fix + skill 白名单）、auto-reply、commands。
[建议] 维护 `FORK_CHANGES.md`；将模型配置提取为外部配置。
[涉及文件] `packages/engine/src/agents/models-config.providers.static.ts`, `pi-embedded-runner/skills-runtime.ts` 等

---

## 风险矩阵总览

| 维度 | 🔴 | 🟠 | 🟡 | 🟢 | 合计 |
|------|-----|-----|-----|-----|------|
| 一、安全审查 | 6 | 5 | 7 | 8 | 26 |
| 二、可靠性 | 4 | 7 | 5 | 0 | 16 |
| 三、数据一致性 | 3 | 3 | 3 | 0 | 9 |
| 四、运维成熟度 | 3 | 7 | 2 | 0 | 12 |
| 五、代码质量 | 3 | 10 | 11 | 0 | 24 |
| 六、依赖供应链 | 2 | 2 | 2 | 1 | 7 |
| **合计** | **21** | **34** | **30** | **9** | **94** |

---

## 修复优先级路线图

### P0 — 立即修复（1-2 天）

| # | 发现 | 修复动作 |
|---|------|---------|
| 1 | 3.3.2 heartbeat 告警双重拼接 | `init-engine-events.ts:44` 删除 `user-` 前缀 |
| 2 | 1.5.2 .env 权限 664 | `chmod 600 .env` |
| 3 | 1.5.4 AUDIT_HMAC_KEY 默认值 | `.env` 添加随机 HMAC key |
| 4 | 1.5.1 命令行暴露 token | `ecosystem.config.js` token 改环境变量传递 |
| 5 | 1.5.3 octopus.json git 追踪 | `git rm --cached` + filter-repo 清除历史 |
| 6 | 4.3.1 PM2 cwd 路径错误 | `ecosystem.config.js:71` 修正为 `apps/server` |
| 7 | 5.3.4 测试 mock 签名不匹配 | 修正 TenantEngineAdapter.test.ts mock |

### P1 — 短期修复（1-2 周）

| # | 发现 | 修复动作 |
|---|------|---------|
| 8 | 2.1.1 无全局异常兜底 | 注册 uncaughtException/unhandledRejection |
| 9 | 1.1.1 BIND_HOST=0.0.0.0 | 生产环境改 127.0.0.1 |
| 10 | 2.2.1 MySQL 无备份 | 配置 cron 定期 mysqldump |
| 11 | 3.1.2 孤儿清理正则 | 改用 validIds 直接过滤 |
| 12 | 4.1.4 告警黑洞 | 注册 SecurityMonitor alert 消费者 |
| 13 | 4.4.1 QuotaManager 集成 | init-services 实例化，chat.ts 调用 |
| 14 | 2.4.2 health() 永远 ok | 增加真实健康检查 |

### P2 — 中期改进（1-2 月）

- 补充核心链路自动化测试（5.3.1/5.3.2）
- 建立 CI/CD pipeline（4.2.1）
- 生成 OpenAPI 文档（5.5.1）
- 引擎 fork 上游同步机制（6.3.1）
- 结构化日志 + Request ID（4.1.1/4.1.3）
- Prometheus metrics 端点（4.1.2）
- 数据库迁移版本管理（4.2.4）
- Docker sandbox 资源限制（4.4.2）
- API Key 移至环境变量（1.5.3 长期方案）

---

_审查完成时间: 2026-03-26 | 审查工具: Claude Opus 4.6 + 7 个专业审计 agent 并行_
