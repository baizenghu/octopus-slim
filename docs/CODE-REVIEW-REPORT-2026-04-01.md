# 代码审查报告

**生成时间**：2026-04-01  
**审查范围**：~150 个企业层源文件（排除 packages/engine fork），涵盖 apps/server、packages/auth|audit|mcp|skills|workspace、plugins/audit|email|mcp、channels/feishu-native|feishu-enterprise|discord|telegram  
**执行 Agent**：A（业务逻辑）/ B（代码质量）/ C（稳定性）/ D（安全）  
**方法论**：静态代码分析 + 人工文件审查 + grep 扫描，未运行完整测试套件

---

## 总览

| 级别 | 数量 | 说明 |
|------|------|------|
| 🔴 Critical | 5 | 需立即修复，影响正确性/安全/稳定性 |
| 🟠 Major    | 22 | 应在下一版本修复 |
| 🟡 Minor    | 20 | 代码质量问题，可排期处理 |

---

## 🔴 Critical 问题

### [C-001] LDAP 客户端无连接超时，服务将永久挂起
- **文件**：`packages/auth/src/AuthService.ts:118`
- **描述**：`ldap.createClient({ url })` 未设置 `connectTimeout` / `socketTimeout`。LDAP 服务器宕机或网络分区时，登录请求永久挂起，快速耗尽 Node.js Event Loop，整个服务无法响应任何请求。
- **修复建议**：
  ```typescript
  const client = ldap.createClient({
    url: this.config.url,
    connectTimeout: 5000,   // 5s 连接超时
    socketTimeout: 10000,   // 10s socket 超时
  });
  ```
- **来源**：Agent C

---

### [C-002] EngineAdapter.callAgent 全局事件监听器泄漏
- **文件**：`apps/server/src/services/EngineAdapter.ts:284`
- **描述**：每次 `callAgent` 调用都向全局 `listeners: Set` 注册监听器，仅在引擎发出 `lifecycle:end` 或 `lifecycle:error` 时才移除。客户端断开 SSE 连接但引擎未发出结束事件时（网络故障、引擎崩溃），监听器永久残留。长期运行后 `emitAgentEvent` 遍历成本 O(n) 退化，最终导致内存溢出。
- **修复建议**：在 SSE `close` 事件处理中显式调用 cleanup，或增加强制超时清理：
  ```typescript
  // chat.ts: res.on('close', ...) 中主动调用 callAgent 返回的 cleanup()
  // 或在 callAgent 中增加强制超时
  const forcedCleanupTimer = setTimeout(() => {
    if (!cleaned) cleanup();
  }, MAX_STREAM_DURATION_MS + 5000);
  ```
- **来源**：Agent C

---

### [C-003] configRetryLoop rate-limit 延迟无上限，互斥锁被挂起 5+ 分钟
- **文件**：`apps/server/src/services/EngineAdapter.ts:444-446`
- **描述**：引擎返回 `"retry after 300s"` 时，计算 `delay = 301000ms`，在 `configMutex.runExclusive` 内 `await setTimeout(301s)`，互斥锁持有超过 5 分钟。此期间所有 `configApply`、Agent 创建/更新操作全部排队阻塞，服务功能实质停止。
- **修复建议**：
  ```typescript
  const delay = msg.includes('rate limit')
    ? Math.min(
        (parseInt(msg.match(/retry after (\d+)s/)?.[1] || '10', 10) * 1000 + 1000),
        30_000  // 最多等 30s
      )
    : (500 * (attempt + 1));
  ```
- **来源**：Agent C

---

### [A-001] 登录 DB 同步失败后静默继续，返回不一致的用户状态
- **文件**：`apps/server/src/routes/auth.ts:68-77`
- **描述**：当 `prisma.user.update` 抛出异常（如 DB 故障），catch 块仅 `logger.warn` 后继续执行，代码走到 `workspaceManager.initWorkspace` 并返回登录成功响应，但 `result.user.id` 可能是 LDAP 返回的旧 id（与 DB 中的 userId 不一致），导致后续所有操作（Agent、审计、文件）指向错误用户。
- **修复建议**：DB 网络故障应返回 500；id 不一致但 update 成功的属正常路径，不需 catch。若选择容错，catch 中必须明确 `return res.status(500).json(...)` 而非静默跳过。
- **来源**：Agent A

---

### [A-003] 修改密码后旧 Token 不失效，密码泄露后无法止损
- **文件**：`apps/server/src/routes/auth.ts:176-198`
- **描述**：修改密码后未调用 `authService.logout(currentToken)` 或将 token 加入黑名单。持有旧 token 的攻击者在密码已修改后仍可无限制访问所有接口。
- **修复建议**：
  ```typescript
  // 密码修改成功后
  const currentToken = req.headers.authorization?.replace('Bearer ', '');
  if (currentToken) {
    await authService.logout(currentToken);
  }
  res.json({ message: '密码已修改，请重新登录' });
  ```
- **来源**：Agent A

---

## 🟠 Major 问题

### [A-002+D-001] SecurityMonitor 登录失败告警与实际失败路径脱节
- **文件**：`apps/server/src/routes/auth.ts:63-67, 98` / `packages/auth/src/AuthService.ts:337`
- **描述**：用户名不存在时（`User account not found`）直接 `return res.status(401)` 不抛异常，不触发外层 catch 的 `securityMonitor.recordLoginFailure()`，攻击者可无声探测用户名。另外 `SecurityMonitor` 5 分钟告警冷却期内，第 2-N 次失败无告警，监控数据失真。
- **修复建议**：在所有 401 返回前（含早期 return）显式调用 `securityMonitor.recordLoginFailure(ip, username)`；或统一抛 `AuthError` 由外层 catch 处理。
- **来源**：Agent A + D

---

### [A-004] 管理员更新不存在用户时直接 Prisma 异常（非 404）
- **文件**：`apps/server/src/routes/admin.ts:162-213`
- **描述**：`prisma.user.update` 未先查存在性，记录不存在时触发 P2025（已处理），但 email 重名触发 P2002 时进入 `next(err)` 返回 500，用户看不到友好提示。
- **修复建议**：catch 中显式处理 P2002 返回 409 Conflict：
  ```typescript
  if (err.code === 'P2002') {
    return res.status(409).json({ error: '邮箱已被其他用户使用' });
  }
  ```
- **来源**：Agent A

---

### [A-006] 删除 MCP 工具源时未检查 allowedToolSources 中的 Agent 引用
- **文件**：`apps/server/src/routes/tool-sources.ts:677-690`
- **描述**：MCP 删除前只检查旧字段 `mcpFilter`，忽略新字段 `allowedToolSources`。新创建的 Agent 均使用 `allowedToolSources`，导致删除 MCP 后相关 Agent 出现悬空引用（数据不一致），而 Skill 的删除路径（第 703 行）已正确处理了 `allowedToolSources`，MCP 未跟进。
- **修复建议**：补充检查 `allowedToolSources` 字段中是否包含该 MCP 的 name/id：
  ```typescript
  const newStyleRef = await prisma.agent.findFirst({
    where: { allowedToolSources: { path: '$', array_contains: source.name } }
  });
  if (newStyleRef) return res.status(409).json({ error: '仍有 Agent 引用此工具源' });
  ```
- **来源**：Agent A

---

### [A-010] checkDueReminders 每 30s 全量扫描 cron.list，性能随用户数线性劣化
- **文件**：`apps/server/src/routes/scheduler.ts:75`
- **描述**：`cron.list({ includeDisabled: true })` 返回全量数据，在内存中过滤 `ent-reminder:{userId}:` 前缀。每个在线用户每 30 秒触发一次全量遍历，`N` 个用户产生 `N×全量数据` 的内存+网络开销。
- **修复建议**：在 RPC 调用中传入前缀参数做服务端过滤，或为 cron.list 增加 `prefix` 参数仅返回目标用户的数据。
- **来源**：Agent A

---

### [A-011] FileCleanupService 路径拼接与实际写入路径不一致，文件永不被物理删除
- **文件**：`apps/server/src/services/FileCleanupService.ts:94`
- **描述**：清理路径为 `data/users/{userId}/workspace/{filePath}`，但 `files.ts` 实际写入路径为 `data/users/{userId}/agents/{agentName}/workspace/files/...`。路径不匹配导致 `fs.existsSync` 返回 false，过期文件仅 DB 状态标为 deleted，物理文件永久残留，磁盘持续泄漏。
- **修复建议**：对齐路径格式，或在 DB 中存储相对于 dataRoot 的完整路径，清理时直接使用存储的路径拼接。
- **来源**：Agent A

---

### [A-012] 个人 MCP（stdio 模式）创建时未校验 command 必填
- **文件**：`apps/server/src/routes/tool-sources.ts:1052-1053`
- **描述**：企业级 MCP 创建（第 377 行）有 `if (transport === 'stdio' && !command)` 校验，个人级缺失，导致可以创建 command 为 null 的 stdio MCP，引擎实际执行时崩溃。
- **修复建议**：
  ```typescript
  if (transport === 'stdio' && !command) {
    return res.status(400).json({ error: 'stdio 模式需要 command' });
  }
  ```
- **来源**：Agent A

---

### [A-013] agents.ts 对 bridge 参数使用非空断言，引擎未连接时抛 TypeError
- **文件**：`apps/server/src/routes/agents.ts:327`
- **描述**：`TenantEngineAdapter.forUser(bridge!, userId)` 使用非空断言，当 `bridge` 为 undefined 时抛出运行时 TypeError，被 Express 错误处理捕获返回无语义的 500。
- **修复建议**：
  ```typescript
  if (!bridge) {
    return res.status(503).json({ error: '引擎未连接，请稍后重试' });
  }
  ```
- **来源**：Agent A

---

### [A-017] AuthService.verifyToken 向 InMemoryUserStore 查询（永远为空），逻辑僵死
- **文件**：`packages/auth/src/AuthService.ts:369-381`
- **描述**：`verifyToken` 调用 `this.userStore.findById(payload.userId)`，默认 `InMemoryUserStore` 为空，该查询无效。实际用户存在性检查依赖 `createAuthMiddleware` 中单独的 Prisma 查询"补丁"。双轨逻辑易在未来维护中产生误解。
- **修复建议**：`verifyToken` 只验证 token 签名和过期时间，不做用户存在性检查（已有 Prisma 查询负责），删除 `userStore.findById` 调用；或将 Prisma 实现 `UserStore` 接口并注入。
- **来源**：Agent A

---

### [A-018] 删除用户时引擎/Docker 清理在 DB 事务前执行，失败导致数据不一致
- **文件**：`apps/server/src/routes/admin.ts:257-330`
- **描述**：删除用户时先调用 `bridge.call('agents.delete', ...)` 和 `execFileSync('docker', ['rm', '-f', ...])` 清理外部资源，再执行 `prisma.$transaction`。若 Docker 命令超时抛异常，DB 事务不执行，但 Agent 已从引擎删除，形成引擎与 DB 不一致（DB 有记录但引擎无 Agent）。
- **修复建议**：将外部资源清理（引擎、Docker）移到 DB 事务成功后执行，或将其标记为最佳努力（fire-and-forget，允许失败）。
- **来源**：Agent A

---

### [A-019] PUT /tool-sources/:id 更新 name 时缺少唯一性校验
- **文件**：`apps/server/src/routes/tool-sources.ts:569-660`
- **描述**：创建时有同名检查，更新时无。两个工具源改为同名时 Prisma 抛 P2002，但 catch 中未处理，直接进入 `next(err)` 返回无语义的 500。
- **修复建议**：catch 中处理 P2002 返回 409，或更新前先做重名检查。
- **来源**：Agent A

---

### [B-001] SystemPromptBuilder.invalidatePromptCache 是空函数但有 5 处调用
- **文件**：`apps/server/src/services/SystemPromptBuilder.ts`（被 `agents.ts`、`tool-sources.ts` 共 5 处调用）
- **描述**：`invalidatePromptCache(_userId)` 函数体为空，注释说明"实际缓存刷新依赖 TTL 过期（5 分钟）"。5 处调用者误认为该调用会产生副作用，形成长期误导。
- **修复建议**：删除该模块及全部 5 处 import/调用；待将来有主动 invalidate 需求时再实现。
- **来源**：Agent B

---

### [B-002] deprecated 字段（skillsFilter/mcpFilter/toolsFilter）仍被大量读写
- **文件**：`prisma/schema.prisma:134-137`，`apps/server/src/routes/agents.ts`（30+ 处），`services/AgentConfigSync.ts`，`routes/tool-sources.ts:678,1510`
- **描述**：schema 注释 "remove after 2026-06-01"，但三个字段仍被广泛双写（创建时）和读取（DELETE 引用检查），且个人 MCP DELETE 路径已修复用 `allowedToolSources`，企业 MCP DELETE 路径未跟进（见 A-006）。
- **修复建议**：制定迁移计划：① 停止双写旧字段 → ② 新 API 不再接收旧字段 → ③ DB migration 删除三列 → ④ 删除 `resolveAllowedToolSources` 兼容层。
- **来源**：Agent B

---

### [B-003] Skill 上传逻辑在企业级和个人级存在 ~90 行重复代码
- **文件**：`apps/server/src/routes/tool-sources.ts:469-563`（企业），`1321-1427`（个人）
- **描述**：两段逻辑结构完全一致，仅 `scope` 和 `ownerId` 不同，且已出现功能分叉（个人版多出 `installSkillDeps` 调用，企业版缺失）。
- **修复建议**：提取 `handleSkillUpload(scope, ownerId, opts)` 内部函数，对齐两端的 `installSkillDeps` 调用。
- **来源**：Agent B

---

### [C-004] SecurityMonitor.sendImAlert 无 HTTP 超时，IM 服务宕机时告警线程挂起
- **文件**：`apps/server/src/services/SecurityMonitor.ts:124`
- **描述**：`fetch(webhookUrl, ...)` 未设置 AbortController + timeout。IM 服务无响应时告警任务永久挂起。
- **修复建议**：
  ```typescript
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  ```
- **来源**：Agent C

---

### [C-005] 管理员创建用户存在 race condition（findFirst + create 非原子）
- **文件**：`apps/server/src/routes/admin.ts:108,127`
- **描述**：两个并发创建同名用户的请求，都通过 `findFirst` 检查，之后都尝试 `create`，后者触发 MySQL unique key 冲突（P2002）并以未处理的 500 暴露给调用方。
- **修复建议**：捕获 P2002 并返回 409，或改用 `upsert`。
- **来源**：Agent C

---

### [C-007] enterprise-audit plugin 的 before_tool_call hook 使用 async，阻塞工具调用
- **文件**：`plugins/audit/src/index.ts:149-165`
- **描述**：`api.on('before_tool_call', async (...) => { await audit(...) })`。若引擎串行 await hook，每次工具调用都等待 DB 写入（可达数百毫秒），MySQL 慢时工具调用延迟叠加，严重影响用户体验。
- **修复建议**：将 DB 写入改为 fire-and-forget：
  ```typescript
  api.on('before_tool_call', (event, ctx) => {
    audit({ ... }).catch(err => api.logger.warn(`audit failed: ${err.message}`));
  });
  ```
- **来源**：Agent C

---

### [C-008] AUDIT_HMAC_KEY 未设置时模块顶层 throw 导致整个插件加载失败
- **文件**：`plugins/audit/src/file-writer.ts:9-11`
- **描述**：`throw new Error('[FATAL] AUDIT_HMAC_KEY ...')` 在模块顶层，插件加载时若环境变量未设置，`enterprise-audit` 插件崩溃，可能导致引擎 gateway 启动失败。
- **修复建议**：将检查移到构造函数或 `write()` 方法内，模块顶层改为 `console.warn` 降级：
  ```typescript
  if (!AUDIT_HMAC_KEY) {
    console.warn('[enterprise-audit] AUDIT_HMAC_KEY not set, HMAC signing disabled');
  }
  ```
- **来源**：Agent C

---

### [C-009] MCP plugin 与 audit plugin 各自创建独立 PrismaClient，连接数超限风险
- **文件**：`plugins/mcp/src/index.ts:383` + `plugins/audit/src/index.ts:62`
- **描述**：两个 plugin 在引擎进程内各创建 `new PrismaClient`（各 `connection_limit=3`），加上 enterprise server 自身单例，共 3 个 PrismaClient 实例连接同一 MySQL。高负载下可能超过 MySQL `max_connections` 上限，触发 `P1001`，整个平台宕机。
- **修复建议**：统一限制各 PrismaClient 连接池，确保总连接数 < MySQL `max_connections` × 80%。考虑将插件层的 PrismaClient 通过依赖注入共享。
- **来源**：Agent C

---

### [D-002] 个人 Skill 安全扫描仅拦截 critical 级别，high/medium 漏洞可通过手动启用绕过
- **文件**：`apps/server/src/routes/tool-sources.ts:1385-1394`
- **描述**：只有 `scanReport.summary.critical > 0` 才拒绝上传；`passed === false`（含 high/medium）的 Skill 被存为 `enabled=false`，但用户可直接通过 `PUT /personal/:id` 将 `enabled` 改为 `true` 绕过拒绝状态，使含安全问题的代码上线运行。
- **修复建议**：在 `PUT /personal/:id` 中，当 `config.status === 'rejected'` 时禁止修改 `enabled=true`；或要求个人 Skill 也需管理员审批方可启用。
- **来源**：Agent D

---

### [D-004] auth.ts 错误响应直接返回 err.message，泄露用户枚举信息
- **文件**：`apps/server/src/routes/auth.ts:98, 125`
- **描述**：catch 块直接返回 `err.message`，消息如 `Authentication failed: user 'xxx' not found`、`账户已锁定，请 15 分钟后重试` 透传到客户端，使攻击者可枚举用户名是否存在并确认账户锁定状态。
- **修复建议**：对外统一返回固定字符串，具体原因写服务端日志：
  ```typescript
  res.status(401).json({ error: '用户名或密码错误' }); // 固定，不泄露原因
  logger.warn('[auth] login failed', { username, reason: err.message });
  ```
- **来源**：Agent D

---

## 🟡 Minor 问题

### [A-005] Agent name 空字符串校验依赖偶然的正则行为，语义不清晰
- **文件**：`apps/server/src/routes/agents.ts:300-303`
- **描述**：`!name.trim()` 用于拦截空字符串，但逻辑依赖链顺序，后续修改易误删。建议显式添加 `trimmedName.length === 0` 作为首项检查。
- **来源**：Agent A

---

### [A-007] 心跳任务引擎离线时更新直接返回 503，与创建时的 DB-only fallback 不一致
- **文件**：`apps/server/src/routes/scheduler.ts:287-290`
- **描述**：创建心跳任务时有 DB-only fallback，但更新时引擎离线直接 503，不支持离线修改元数据后等待重连。
- **建议**：引擎断开时至少更新 DB 中的 name/content，并附 `enabled: false`，等引擎重连后重建 cron。
- **来源**：Agent A

---

### [A-008] 审计日志 offset 参数未做非负数校验
- **文件**：`apps/server/src/routes/audit.ts:42`
- **描述**：`offset` 为负数时 parseInt 返回负数并传入查询，可能导致 SQL 异常。
- **建议**：`offset: Math.max(0, parseInt(...))`
- **来源**：Agent A

---

### [A-009] 审计统计 days 参数未限制上界，超大值导致查询超时
- **文件**：`apps/server/src/routes/audit.ts:131`
- **描述**：`days=99999` 会全量扫描审计表，可能导致 DB 超时或内存溢出。
- **建议**：`const days = Math.min(365, Math.max(1, parseInt(...) || 7))`
- **来源**：Agent A

---

### [A-016] ensureDefaultAgent 用内存 Set 缓存，新增工具源不更新已有 default agent
- **文件**：`apps/server/src/routes/agents.ts:222-272`
- **描述**：`defaultCheckedUsers` Set 缓存已创建的用户，首次后不再更新。新增 MCP/Skill 后，已有用户的 default agent `allowedToolSources` 不包含新工具源。
- **建议**：新增工具源后批量更新现有 default agent；或将 default agent 的 `allowedToolSources` 设为 `null`（全部放行）。
- **来源**：Agent A

---

### [A-020] 已拒绝（rejected）的 Skill 无法重新审批，形成业务死锁
- **文件**：`apps/server/src/routes/tool-sources.ts:901-904`
- **描述**：`config.status !== 'pending'` 时返回 400，rejected 的 Skill 无法重审，且没有"重置为 pending"的接口。
- **建议**：允许 `rejected` 状态进入审批，或新增 `POST /:id/resubmit` 接口。
- **来源**：Agent A

---

### [B-004] feishu-native/outbound.ts 使用 console.error 绕过统一日志体系
- **文件**：`channels/feishu-native/src/outbound.ts:101, 151`
- **描述**：同级文件均使用 `runtime.error?.()` 日志链路，此处用 `console.error` 无上下文无格式化。
- **建议**：改为 `getFeishuRuntime().error?.(...)`。
- **来源**：Agent B

---

### [B-005] engine.ts 中 _toolsFilter 字段从未被赋值或读取
- **文件**：`apps/server/src/types/engine.ts:95`
- **描述**：`_toolsFilter` 注释称"引擎忽略未知字段"，但全项目无任何赋值/读取，是完全死代码。
- **建议**：删除该字段声明。
- **来源**：Agent B

---

### [B-006] sendMessageFeishu 和 sendCardFeishu 有 ~30 行重复的 try-catch + fallback 逻辑
- **文件**：`channels/feishu-native/src/send.ts:278-367`
- **描述**：两个函数核心流程完全一致，差异仅在 content 构建和 msg_type。
- **建议**：提取 `sendFeishuMessageCore(content, msgType, ...)` 内部函数消除重复。
- **来源**：Agent B

---

### [B-007] monitor.ts re-export 了三个测试专用 ForTest 函数泄露到公开接口
- **文件**：`channels/feishu-native/src/monitor.ts:10-28`
- **描述**：`clearFeishuWebhookRateLimitStateForTest` 等 ForTest 函数只在 `.test.ts` 中使用，不应出现在 `monitor.ts` 公开接口中。
- **建议**：移除 re-export；测试文件直接从 `monitor.state.ts` 导入。
- **来源**：Agent B

---

### [B-008] toJsonValue 是只被调用一次的无意义包装函数
- **文件**：`apps/server/src/routes/agents.ts:38-40`
- **描述**：`function toJsonValue(v) { return v === null ? Prisma.JsonNull : v; }` 全文件仅调用一次，完全可内联。
- **建议**：内联并删除函数。
- **来源**：Agent B

---

### [B-009] 删除 Agent 后用 setTimeout(2000ms) 等待引擎异步清理，逻辑脆弱
- **文件**：`apps/server/src/routes/agents.ts:551-559`
- **描述**：固定延迟 2s 无法保证引擎一定完成清理，无声失败时目录不被删除。
- **建议**：依赖引擎在 `agents.delete { deleteFiles: true }` 中彻底清理；或改为定期扫描孤儿目录的后台任务。
- **来源**：Agent B

---

### [B-010] ContentSanitizer 中两个时间戳正则使用不同匹配模式，行为可能不一致
- **文件**：`apps/server/src/utils/ContentSanitizer.ts:13-14`
- **描述**：`TIMESTAMP_PREFIX_RE`（用于用户消息）和 `TIMESTAMP_PREFIX_GLOBAL_RE`（用于响应）的 pattern 不同，可能导致两个方向的清理行为不一致。
- **建议**：统一使用带 `gm` flag 的单一正则，或注释说明两者为何需要不同规则。
- **来源**：Agent B

---

### [C-010] loadAgentFromDb 空 catch 块静默吞掉 DB 错误
- **文件**：`apps/server/src/routes/sessions.ts:127-129`
- **描述**：DB 不可用时 catch 返回 `null`，上层降级为 default agent 继续执行，无任何错误日志，故障无法排查。
- **建议**：catch 中至少添加 `logger.warn('[sessions] loadAgentFromDb failed', { error })`。
- **来源**：Agent C

---

### [C-011] EngineAdapter.call() 每次 RPC 调用都 await opaqueImport（高频 GC 压力）
- **文件**：`apps/server/src/services/EngineAdapter.ts:183-184`
- **描述**：每次 `call()` 产生两个冗余 Promise（虽然 Node.js 有模块缓存），高并发时增加 GC 压力。
- **建议**：缓存为实例变量，首次调用时 lazy init，后续复用。
- **来源**：Agent C

---

### [C-012] 删除 Agent 时循环逐个 delete 关联心跳任务，N+1 DB 操作
- **文件**：`apps/server/src/routes/agents.ts:527-538`
- **描述**：`for (const task of heartbeatTasks)` 内逐个 `prisma.scheduledTask.delete`，N 个任务 = N 次 DB 往返。
- **建议**：改用批量删除：`await prisma.scheduledTask.deleteMany({ where: { id: { in: taskIds } } })`
- **来源**：Agent C

---

### [D-003] AuditMiddleware 直接读 X-Forwarded-For 原始值，可被伪造
- **文件**：`packages/audit/src/AuditMiddleware.ts:365`
- **描述**：攻击者可伪造 `X-Forwarded-For: 1.2.3.4` 头，使审计日志 `ipAddress` 不可信，等保 IP 溯源失效。
- **建议**：优先使用 `req.ip`（已经过 Express trust proxy 过滤）：
  ```typescript
  ipAddress: req.ip || (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown',
  ```
- **来源**：Agent D

---

### [D-005] SSRF 防护仅校验主机名字符串，存在 DNS Rebinding 绕过风险
- **文件**：`apps/server/src/utils/url-validator.ts`
- **描述**：`validateMcpUrl()` 用正则匹配 hostname，不做 DNS 解析。攻击者可注册域名先通过校验，创建后切换 DNS 到内网 IP（DNS Rebinding），访问内网资源。
- **建议**：MCP 建立连接时增加 DNS 解析结果校验；或维护 allowlist 替代 denylist。
- **来源**：Agent D

---

### [D-006] 密码修改接口验证旧密码失败时不触发 SecurityMonitor 告警
- **文件**：`apps/server/src/routes/auth.ts:164-167`
- **描述**：拥有有效 JWT 的攻击者可无限猜测旧密码修改密码，不会触发安全告警。
- **建议**：验证失败时调用 `securityMonitor.recordLoginFailure(ip, username)`，或对此接口增加独立 rate limiter。
- **来源**：Agent D

---

### [D-008] validateSessionOwnership 对短 ID 恒返回 false，导致合法用户操作 403
- **文件**：`apps/server/src/utils/ownership.ts:17`
- **描述**：`sessionId` 不以 `agent:` 开头时直接返回 `false`，导致传入短格式 ID 的合法请求被拒绝。注释已知但未修复。
- **建议**：在所有调用点统一规范化 sessionId（补全为完整 key 格式）后再传入此函数。
- **来源**：Agent D

---

## 需要人工确认的疑问

| 编号 | 文件 | 疑问描述 | 需确认方向 |
|------|------|---------|-----------|
| ?-001 | `apps/server/src/routes/sessions.ts:231` | DB-less fallback 的用户隔离依赖 `ent_{userId}_` 前缀过滤，但 `nativeAgentId` 为 undefined 时会发全量 sessions.list | 确认引擎是否在 `agentId=undefined` 时做服务端隔离，或确认客户端过滤是否足够安全 |
| ?-002 | `apps/server/src/routes/admin.ts:423,444` | `$queryRaw` 使用 Prisma 参数绑定（安全），但 `BigInt → Number` 在超大记录数时精度丢失 | 当前内网场景审计量是否可能超过 `Number.MAX_SAFE_INTEGER`？预计不会，记录备忘 |
| ?-003 | `apps/server/src/routes/agents.ts:222` | `ensureDefaultAgent` 内存 Set 缓存在多进程/重启后失效（已知），default agent 是否需要幂等 re-check | 确认重启后 default agent 是否仍由其他机制保证存在 |

---

## 等保 2.0 合规状态汇总

| 要求 | 状态 | 备注 |
|------|------|------|
| 操作审计日志 | ✅ 已实现 | `AuditMiddleware` 全局挂载，DB + 文件双写，含 HMAC 签名 |
| 登录失败锁定 | ⚠️ 已实现但存在缺陷 | `AuthService` 5 次/15 分钟，但 SecurityMonitor 告警路径存在脱节（见 A-002+D-001）|
| 会话超时 | ✅ 已实现 | JWT `accessTokenExpiresIn`（短期）+ `refreshTokenExpiresIn`（7天） |
| 密码复杂度 | ✅ 已实现 | `validatePassword`：8 位 + 3 类字符，创建/修改均校验 |
| Token 主动吊销 | ✅ 已实现 | `blacklistToken` SHA-256 hash 存 Redis + 内存 LRU |

---

## 修复优先级建议

### 立即处理（本次发布前必须修复）
所有 Critical 问题（C-001 ~ C-003，A-001，A-003），以及：
- **D-004**（错误信息泄露，等保要求）
- **C-008**（AUDIT_HMAC_KEY 模块顶层 throw，新部署即宕机）

### 短期处理（两周内）
- A-003（密码修改后 token 未失效）— 已在 Critical 中，重申
- A-006（MCP 删除引用检查遗漏）
- A-011（文件清理路径不一致，磁盘持续泄漏）
- A-018（删除用户事务顺序错误）
- C-002（事件监听器泄漏）
- C-003（configRetryLoop 延迟上限）
- D-002（个人 Skill 安全扫描绕过）
- B-002（deprecated 字段迁移，排期 2026-06-01 前完成）

### 迭代处理
其余 Major 问题（稳定性/性能）和全部 Minor 问题。
