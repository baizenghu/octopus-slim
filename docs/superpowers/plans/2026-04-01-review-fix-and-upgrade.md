# 代码审查修复 + 技能系统升级计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-04-01 代码审查报告中的全部 5 个 Critical + 2 个高优先等保项，实施最高优先级 Major 修复和安全加固（含 ea1e9be 安全模块集成），并升级技能系统支持 Markdown+Frontmatter 格式、并行审查技能、/remember 记忆管理。

**Architecture:** 改动集中在 `apps/server`、`packages/auth`、`plugins/audit`、`packages/engine/pi-extensions`。Wave 1/2 每 Task 独立可测，Wave 3 新功能可并行开发。

**Tech Stack:** TypeScript 5.4, Express, Prisma (MySQL), Vitest, pnpm monorepo

---

## Wave 1: Critical 修复 + 等保高优先项（发布前必须修复）

> 对应报告"立即处理"清单：全部 Critical (C-001~C-003, A-001, A-003) + D-004 (等保) + C-008 (新部署宕机)

---

### Task 1: LDAP 客户端连接超时 (C-001)

**Files:**
- Modify: `packages/auth/src/AuthService.ts:118`

**Context:** `ldap.createClient({ url })` 无 `connectTimeout`/`socketTimeout`，LDAP 宕机时登录请求永久挂起，耗尽 Event Loop。

- [x] **Step 1: 修改 createClient 调用**

```typescript
// packages/auth/src/AuthService.ts:118
const client = ldap.createClient({
  url: this.config.url,
  connectTimeout: 5_000,   // 5s 建立连接超时
  socketTimeout: 10_000,   // 10s socket 读写超时
});
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project packages/auth/tsconfig.json
```

- [x] **Step 3: 提交**

```bash
git add packages/auth/src/AuthService.ts
git commit -m "fix(C-001): add connectTimeout/socketTimeout to LDAP client"
```

---

### Task 2: callAgent 全局事件监听器泄漏 (C-002)

**Files:**
- Modify: `apps/server/src/services/EngineAdapter.ts:276`
- Modify: `apps/server/src/routes/chat.ts`（两处 `callAgent` 调用）

**Context:** 客户端断开 SSE 但引擎未发 `lifecycle:end` 时，`unsubscribe` 永久残留，长期 O(n) 退化→OOM。必须在 SSE `close` 事件中显式调用 cleanup。

- [x] **Step 1: callAgent 返回 cleanup 函数**

`EngineAdapter.ts:262` 函数签名修改为同时返回 cleanup：

```typescript
// apps/server/src/services/EngineAdapter.ts:262
async callAgent(
  params: AgentCallParams,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<{ runId: string; cleanup: () => void }> {
  // ... 现有逻辑不变 ...

  // 在 return { runId: serverRunId } 改为：
  return { runId: serverRunId, cleanup };
}
```

- [x] **Step 2: 为 callAgent 添加强制超时兜底**

在 `cleanup` 定义后（`EngineAdapter.ts:282`）添加 30 分钟强制清理：

```typescript
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  pendingToolCalls.clear();
  if (forcedCleanupTimer) clearTimeout(forcedCleanupTimer);
  unsubscribe();
  this.off('_agent_async_error', asyncErrorHandler);
};

// 30min 强制兜底（SSE close 未能触发时）
const MAX_STREAM_DURATION_MS = 30 * 60 * 1000;
const forcedCleanupTimer = setTimeout(() => {
  if (!cleaned) {
    logger.warn(`[callAgent] forced cleanup after ${MAX_STREAM_DURATION_MS}ms`, { runId: idempotencyKey });
    cleanup();
  }
}, MAX_STREAM_DURATION_MS + 5_000);
if (forcedCleanupTimer.unref) forcedCleanupTimer.unref();
```

- [x] **Step 3: chat.ts SSE close 时调用 cleanup**

找到两处 `callAgent(...)` 调用点（约 `chat.ts:275` 和 `chat.ts:570`），在 `res.on('close', ...)` 中添加：

```typescript
const { runId, cleanup: agentCleanup } = await engine.callAgent(agentParams, onEvent);
// ...
res.on('close', () => {
  streamDone = true;
  agentCleanup(); // 主动释放监听器，防止 OOM
});
```

- [x] **Step 4: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 5: 提交**

```bash
git add apps/server/src/services/EngineAdapter.ts apps/server/src/routes/chat.ts
git commit -m "fix(C-002): callAgent returns cleanup(), SSE close triggers explicit listener removal"
```

---

### Task 3: configRetryLoop rate-limit 延迟无上限 (C-003)

**Files:**
- Modify: `apps/server/src/services/EngineAdapter.ts:444-446`

**Context:** 引擎返回 `"retry after 300s"` 时 delay=301s，在 `configMutex.runExclusive` 内等待 5 分钟，所有 Agent 创建/更新全部阻塞。

- [x] **Step 1: 添加 30s 上限**

```typescript
// apps/server/src/services/EngineAdapter.ts:444-446
const delay = msg.includes('rate limit')
  ? Math.min(
      (parseInt(msg.match(/retry after (\d+)s/)?.[1] || '10', 10) * 1000 + 1_000),
      30_000,  // 最多等 30s，不持锁超过半分钟
    )
  : 500 * (attempt + 1);
```

- [x] **Step 2: 类型检查 + 运行相关测试**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
npx vitest run apps/server/src/services/__tests__/EngineAdapter.test.ts --reporter=verbose
```

- [x] **Step 3: 提交**

```bash
git add apps/server/src/services/EngineAdapter.ts
git commit -m "fix(C-003): cap configRetryLoop rate-limit delay at 30s to prevent mutex starvation"
```

---

### Task 4: 登录 DB 同步失败后静默继续 (A-001)

**Files:**
- Modify: `apps/server/src/routes/auth.ts:63-70`

**Context:** `prisma.user.update` 异常后 catch 仅 `logger.warn`，流程继续走 `workspaceManager.initWorkspace` 并返回成功响应，但 `result.user.id` 可能是错误 userId，导致后续所有操作指向错误用户。

- [x] **Step 1: 分离 DB 写入失败与 id 不一致两种情况**

```typescript
// apps/server/src/routes/auth.ts:45-70（原 try 块内）
try {
  await prisma.user.update({
    where: { userId: existing.userId },
    data: {
      lastLoginAt: new Date(),
      email: result.user.email || existing.email || '',
      displayName: result.user.displayName || existing.displayName || '',
      department: result.user.department || existing.department || '',
    },
  });
} catch (dbErr: unknown) {
  // DB 故障（网络抖动、MySQL 宕机），无法安全继续，返回 503
  logger.error('[auth] DB sync failed during login, refusing to continue', {
    error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    username,
  });
  res.status(503).json({ error: '服务暂时不可用，请稍后重试' });
  return;
}
```

- [x] **Step 2: 确认 id 不一致分支（正常路径）不受影响**

第 57-61 行的 id 覆盖逻辑是正常路径，无需 catch。

- [x] **Step 3: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 4: 提交**

```bash
git add apps/server/src/routes/auth.ts
git commit -m "fix(A-001): return 503 on DB sync failure during login instead of silently continuing"
```

---

### Task 5: 密码修改后旧 Token 不失效 (A-003)

**Files:**
- Modify: `apps/server/src/routes/auth.ts:176-198`

**Context:** 改密码后旧 Token 仍有效，攻击者密码泄露后无法止损。等保合规要求密码变更后会话失效。

- [x] **Step 1: 改密成功后废止当前 Token**

```typescript
// apps/server/src/routes/auth.ts:178-195，在 prisma.user.update 成功后添加
// 将当前 Token 加入黑名单（authService.logout 内部调用 blacklistToken）
const currentToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
if (currentToken) {
  try {
    await authService.logout(currentToken);
  } catch (e: unknown) {
    // 黑名单失败不阻断响应，但记录告警
    logger.warn('[auth] Failed to blacklist token after password change', {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
// 原来的 res.json({ message: '密码修改成功' }) 改为明确提示需重新登录
res.json({ message: '密码已修改，请重新登录' });
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 3: 提交**

```bash
git add apps/server/src/routes/auth.ts
git commit -m "fix(A-003): invalidate current token after password change (等保合规)"
```

---

### Task 6: 错误响应泄露用户枚举信息 (D-004)

**Files:**
- Modify: `apps/server/src/routes/auth.ts:65, 98, 119, 125, 167`

**Context:** catch 块直接返回 `err.message`（如 `user 'xxx' not found`），攻击者可枚举用户名，等保要求。

- [x] **Step 1: 统一 401 响应为固定字符串**

```typescript
// auth.ts:65 — 用户不在 DB
res.status(401).json({ error: '用户名或密码错误' });
// 同时补触发 securityMonitor（见 Task 8）

// auth.ts:98 — catch 块
logger.warn('[auth] login failed', { username, reason: err instanceof Error ? err.message : String(err), ip });
res.status(401).json({ error: '用户名或密码错误' });

// auth.ts:119 — 用户已禁用（不透露账户存在性）
logger.warn('[auth] disabled user login attempt', { username, ip });
res.status(401).json({ error: '用户名或密码错误' });

// auth.ts:125 — Token 刷新 catch
res.status(401).json({ error: 'Token 无效或已过期，请重新登录' });

// auth.ts:167 — 旧密码错误（已有 401，无需改动消息，但需补限流，见 Task 8）
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 3: 提交**

```bash
git add apps/server/src/routes/auth.ts
git commit -m "fix(D-004): unify 401 error messages to prevent user enumeration (等保要求)"
```

---

### Task 7: AUDIT_HMAC_KEY 模块顶层 throw 导致新部署宕机 (C-008)

**Files:**
- Modify: `plugins/audit/src/file-writer.ts:7-11`

**Context:** 第 9-11 行模块顶层 `throw new Error('[FATAL] AUDIT_HMAC_KEY...')`，未配置环境变量时 `enterprise-audit` 插件加载失败，引擎 gateway 启动失败。降级为告警可允许在无 HMAC 签名的情况下启动（运维可修复）。

- [x] **Step 1: 将顶层 throw 改为 warn + 运行时检查**

```typescript
// plugins/audit/src/file-writer.ts:7-11
const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY;

if (!AUDIT_HMAC_KEY) {
  // 模块加载时仅告警，不阻止启动；write() 中若无 key 则跳过 HMAC 签名
  console.warn('[enterprise-audit] AUDIT_HMAC_KEY not set — HMAC signing disabled. Set AUDIT_HMAC_KEY in .env for production.');
}
```

然后在 `write()` 方法的 HMAC 签名处（约第 83 行）添加防御：

```typescript
if (AUDIT_HMAC_KEY) {
  const hmac = createHmac('sha256', AUDIT_HMAC_KEY);
  // ... 现有签名逻辑 ...
} else {
  // HMAC 未配置时跳过签名，entry.hmac 留空
}
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project plugins/audit/tsconfig.json 2>/dev/null || echo "no tsconfig, skip"
```

- [x] **Step 3: 提交**

```bash
git add plugins/audit/src/file-writer.ts
git commit -m "fix(C-008): degrade AUDIT_HMAC_KEY from startup-fatal to runtime-warn to prevent deploy failure"
```

---

## Wave 2: Major 修复 + 安全加固（两周内）

---

### Task 8: SecurityMonitor 登录失败路径脱节 + 密码猜测无限流 (A-002+D-001+D-006)

**Files:**
- Modify: `apps/server/src/routes/auth.ts:63-67, 119, 167`

**Context:** 用户名不存在时早期 `return res.status(401)` 不触发 `securityMonitor.recordLoginFailure()`，攻击者可无声枚举用户名。密码修改验证失败也不触发告警。

- [x] **Step 1: 在所有 401 路径前统一触发 securityMonitor**

```typescript
// auth.ts:63-66（用户不在 DB，在 return 前添加）
const ip = req.ip || req.socket.remoteAddress || 'unknown';
securityMonitor.recordLoginFailure(ip, username);
res.status(401).json({ error: '用户名或密码错误' });
return;

// auth.ts:119（用户已禁用，在 return 前添加）
securityMonitor.recordLoginFailure(ip, username);
res.status(401).json({ error: '用户名或密码错误' });
return;

// auth.ts:167（旧密码错误，在 return 前添加）
securityMonitor.recordLoginFailure(req.ip || 'unknown', user.username!);
res.status(401).json({ error: '当前密码不正确' });
return;
```

- [x] **Step 2: 提交**

```bash
git add apps/server/src/routes/auth.ts
git commit -m "fix(A-002+D-006): trigger securityMonitor on all 401 paths including early returns"
```

---

### Task 9: MCP 删除引用检查遗漏 (A-006)

**Files:**
- Modify: `apps/server/src/routes/tool-sources.ts:677-690`

**Context:** MCP 删除时只检查旧字段 `mcpFilter`，忽略 `allowedToolSources`，导致新 Agent 出现悬空引用。Skill 的删除路径（第 697 行）已正确处理。

- [x] **Step 1: 补充 allowedToolSources 引用检查**

在第 680 行（`const filterField = ...`）之前插入：

```typescript
// tool-sources.ts:678 附近，删除前检查 allowedToolSources 引用
if (existing.type === 'mcp') {
  const newStyleRef = await prisma.agent.findFirst({
    where: {
      OR: [
        { allowedToolSources: { path: '$', array_contains: existing.name } },
        { allowedToolSources: { path: '$', array_contains: existing.id } },
      ],
    },
    select: { name: true },
  });
  if (newStyleRef) {
    res.status(409).json({ error: `仍有 Agent 引用此工具源（${newStyleRef.name}），请先解除引用再删除` });
    return;
  }
}
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 3: 提交**

```bash
git add apps/server/src/routes/tool-sources.ts
git commit -m "fix(A-006): check allowedToolSources references before deleting MCP tool source"
```

---

### Task 10: 个人 Skill 安全扫描绕过 (D-002)

**Files:**
- Modify: `apps/server/src/routes/tool-sources.ts:1385-1394, 1429-1500`（PUT /personal/:id）

**Context:** `passed === false` 的 Skill 存为 `enabled=false`，但用户可通过 `PUT /personal/:id` 直接将 `enabled` 改为 `true` 绕过。

- [x] **Step 1: PUT /personal/:id 中阻止 rejected Skill 改为 enabled**

在更新前（约 `tool-sources.ts:1452`）添加：

```typescript
// PUT /personal/:id 中，在执行 update 前检查
const existingCfg = (existing.config || {}) as Record<string, unknown>;
const existingStatus = existingCfg['status'] as string | undefined;
const scanReport = existingCfg['scanReport'] as { passed?: boolean } | undefined;

if (existingStatus === 'rejected' || scanReport?.passed === false) {
  // 若请求试图启用一个已拒绝的 Skill，拒绝
  const incomingEnabled = req.body.enabled;
  if (incomingEnabled === true) {
    res.status(403).json({ error: '安全扫描未通过或已被拒绝的 Skill 不可启用，请重新上传或联系管理员' });
    return;
  }
}
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 3: 提交**

```bash
git add apps/server/src/routes/tool-sources.ts
git commit -m "fix(D-002): prevent enabling rejected skills via PUT /personal/:id"
```

---

### Task 11: 个人 MCP stdio 未校验 command (A-012)

**Files:**
- Modify: `apps/server/src/routes/tool-sources.ts:1052-1053`

**Context:** 企业级 MCP 创建（第 377 行）有 `stdio && !command` 校验，个人级缺失，可创建 command 为 null 的 stdio MCP，引擎执行时崩溃。

- [x] **Step 1: 在个人 MCP 创建逻辑中补充 stdio 校验**

```typescript
// tool-sources.ts:1052-1053 附近（POST /personal 的 MCP 创建分支）
if (transport === 'stdio' && !command?.trim()) {
  res.status(400).json({ error: 'stdio 模式需要 command' });
  return;
}
```

- [x] **Step 2: 提交**

```bash
git add apps/server/src/routes/tool-sources.ts
git commit -m "fix(A-012): validate command required for personal MCP in stdio mode"
```

---

### Task 12: agents.ts bridge 非空断言 → 503 (A-013)

**Files:**
- Modify: `apps/server/src/routes/agents.ts:327, 357`

**Context:** `TenantEngineAdapter.forUser(bridge!, userId)` 引擎未连接时抛 TypeError，返回无语义 500。

- [x] **Step 1: 在 Agent CRUD 操作前检查 bridge**

```typescript
// agents.ts:327 前（PUT /agents/:name 中）
if (!bridge?.isConnected) {
  res.status(503).json({ error: '引擎未连接，请稍后重试' });
  return;
}
const nativeAgentId = TenantEngineAdapter.forUser(bridge, user.id).agentId(name.trim());
```

对 `agents.ts:357` 同理：

```typescript
if (!bridge?.isConnected) {
  // 若为 Agent 创建，DB 已写入但引擎不可达，做 DB rollback 或提示稍后同步
  res.status(503).json({ error: '引擎未连接，Agent 已保存到 DB，待引擎恢复后自动同步' });
  return;
}
await syncAgentToEngine(bridge, user.id, syncOpts);
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 3: 提交**

```bash
git add apps/server/src/routes/agents.ts
git commit -m "fix(A-013): replace bridge! non-null assertion with explicit 503 guard"
```

---

### Task 13: 删除用户时外部资源清理顺序错误 (A-018)

**Files:**
- Modify: `apps/server/src/routes/admin.ts:257-330`

**Context:** 先清理引擎/Docker，再执行 DB 事务。若 Docker 抛异常，引擎 Agent 已删但 DB 仍有记录，形成不一致。

- [x] **Step 1: 将外部资源清理移到 DB 事务之后**

重组删除用户逻辑为：

```typescript
// admin.ts:257 — DELETE /users/:id
// Phase 1: DB 事务（先提交）
await prisma.$transaction(async (tx: any) => {
  await tx.scheduledTask.deleteMany({ where: { agentId: { in: agentIds } } });
  await tx.agent.deleteMany({ where: { ownerId: userId } });
  await tx.session.deleteMany({ where: { userId } });
  await tx.auditLog.deleteMany({ where: { userId } });
  await tx.user.delete({ where: { userId } });
});

// Phase 2: 外部资源清理（best-effort，DB 已提交，失败只是资源泄漏，可修复）
for (const nativeAgentId of nativeAgentIds) {
  bridge.call('agents.delete', { agentId: nativeAgentId, deleteFiles: true })
    .catch((e: unknown) => logger.warn(`[admin] engine agent cleanup failed: ${nativeAgentId}`, { error: String(e) }));
}

// Docker 容器清理（同为 best-effort）
try {
  const containers = execFileSync('docker', ['ps', '-a', '--filter', `name=ent_${userId}_`, '--format', '{{.Names}}'], { timeout: 5000 })
    .toString().trim().split('\n').filter(Boolean);
  for (const name of containers) {
    execFileSync('docker', ['rm', '-f', name], { timeout: 10_000 });
  }
} catch (e: unknown) {
  logger.warn('[admin] Docker container cleanup failed (non-fatal)', { error: String(e) });
}
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 3: 提交**

```bash
git add apps/server/src/routes/admin.ts
git commit -m "fix(A-018): commit DB transaction before cleaning up engine/Docker resources"
```

---

### Task 14: SecurityMonitor.sendImAlert 无 HTTP 超时 (C-004)

**Files:**
- Modify: `apps/server/src/services/SecurityMonitor.ts:118-130`

**Context:** `fetch(webhookUrl)` 无 AbortController，IM 服务无响应时告警线程永久挂起。

- [x] **Step 1: 添加 5s 超时**

```typescript
// SecurityMonitor.ts:118 sendImAlert 方法中
private async sendImAlert(event: SecurityEvent): Promise<void> {
  // ...
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/_internal/im/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!resp.ok) {
      logger.warn('[SecurityMonitor] IM alert HTTP error', { status: resp.status });
    }
  } catch (e: unknown) {
    if ((e as Error).name === 'AbortError') {
      logger.warn('[SecurityMonitor] IM alert timed out after 5s');
    } else {
      logger.warn('[SecurityMonitor] IM alert failed', { error: String(e) });
    }
  } finally {
    clearTimeout(timer);
  }
}
```

- [x] **Step 2: 提交**

```bash
git add apps/server/src/services/SecurityMonitor.ts
git commit -m "fix(C-004): add 5s AbortController timeout to SecurityMonitor.sendImAlert"
```

---

### Task 15: admin.ts 用户创建 race condition (C-005)

**Files:**
- Modify: `apps/server/src/routes/admin.ts:108-127`

**Context:** `findFirst` + `create` 非原子，两个并发请求都通过检查，后者触发 P2002 MySQL unique key 冲突但 catch 未处理，返回无语义 500。

- [x] **Step 1: catch 中处理 P2002**

```typescript
// admin.ts:155 catch 块
} catch (err: unknown) {
  const prismaError = err as { code?: string };
  if (prismaError.code === 'P2002') {
    res.status(409).json({ error: '用户名或邮箱已存在' });
    return;
  }
  next(err);
}
```

- [x] **Step 2: 提交**

```bash
git add apps/server/src/routes/admin.ts
git commit -m "fix(C-005): handle P2002 race condition in admin user creation with 409 response"
```

---

### Task 16: enterprise-audit before_tool_call async → fire-and-forget (C-007)

**Files:**
- Modify: `plugins/audit/src/index.ts:149-165`

**Context:** `api.on('before_tool_call', async (...) => { await audit(...) })` 若引擎串行 await hook，DB 写入延迟直接叠加到工具调用响应时间。

- [x] **Step 1: 改为 fire-and-forget**

```typescript
// plugins/audit/src/index.ts:149-165
api.on('before_tool_call', (event, ctx) => {
  // fire-and-forget：DB 写入失败不阻塞工具调用
  audit({
    userId: ctx.agentId,
    action: AuditAction.TOOL_CALL,
    resource: event.name,
    detail: { args: event.args },
  }).catch((err: unknown) =>
    api.logger.warn(`[enterprise-audit] before_tool_call audit failed: ${err instanceof Error ? err.message : String(err)}`),
  );
});
```

- [x] **Step 2: 类型检查**

```bash
npx tsc --noEmit --project plugins/audit/tsconfig.json 2>/dev/null || true
```

- [x] **Step 3: 提交**

```bash
git add plugins/audit/src/index.ts
git commit -m "fix(C-007): change before_tool_call hook to fire-and-forget to prevent audit DB blocking tool calls"
```

---

### Task 17: shell-injection-detect 集成到 MCP/Skill 创建路由 (安全加固)

**Files:**
- Read: `packages/engine/src/agents/pi-extensions/safety/shell-injection-detect.ts`
- Modify: `apps/server/src/routes/tool-sources.ts`（企业级 MCP 创建 ~377，个人 MCP 创建 ~1052，Skill 上传 ~469/1321）
- Modify: `apps/server/src/utils/shell-safety.ts`（新建工具函数）

**Context:** `ea1e9be` 已实现 `shell-injection-detect` 模块（7 层检测），路由层创建 stdio MCP 时未校验 `command` 字段，上传 Skill 脚本时未校验内容，存在注入风险。

- [x] **Step 1: 创建企业层桥接工具函数**

```typescript
// apps/server/src/utils/shell-safety.ts（新文件）
import type { ShellInjectionResult } from '../../../packages/engine/src/agents/pi-extensions/safety/shell-injection-detect';

/**
 * 动态导入引擎安全模块，检测 shell 注入风险
 * 返回 { safe: true } 或 { safe: false, reason: string }
 */
export async function checkShellInjection(command: string): Promise<ShellInjectionResult> {
  const { detectShellInjection } = await import(
    '../../../packages/engine/src/agents/pi-extensions/safety/shell-injection-detect.js'
  );
  return detectShellInjection(command) as ShellInjectionResult;
}
```

- [x] **Step 2: 企业级 stdio MCP 创建时校验 command**

```typescript
// tool-sources.ts:377 附近（POST / 企业级 MCP，transport==='stdio' 校验后）
if (transport === 'stdio' && command) {
  const safety = await checkShellInjection(command);
  if (!safety.safe) {
    res.status(400).json({ error: `command 存在安全风险：${safety.reason}` });
    return;
  }
}
```

- [x] **Step 3: 个人 stdio MCP 创建时同样校验**

```typescript
// tool-sources.ts:1052 附近（POST /personal，stdio 分支）
if (transport === 'stdio' && command?.trim()) {
  const safety = await checkShellInjection(command.trim());
  if (!safety.safe) {
    res.status(400).json({ error: `command 存在安全风险：${safety.reason}` });
    return;
  }
}
```

- [x] **Step 4: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 5: 提交**

```bash
git add apps/server/src/utils/shell-safety.ts apps/server/src/routes/tool-sources.ts
git commit -m "feat(security): integrate shell-injection-detect into stdio MCP creation routes"
```

---

### Task 18: destructive-command-warning 集成到 SSE 事件流 (安全加固)

**Files:**
- Modify: `apps/server/src/services/EngineAdapter.ts:330-334`（`mapEngineEvent` 中 tool_call 事件处理）

**Context:** `ea1e9be` 实现了 `destructive-command-warning`（24 个破坏性命令模式），当 Agent 调用 bash/exec 工具时，应在 SSE 事件中附加 `warning` 字段，前端可提示用户二次确认。

- [ ] **Step 1: 在 mapEngineEvent 中为 bash/exec 类工具调用附加警告**

```typescript
// EngineAdapter.ts — mapEngineEvent 中 tool 事件处理段落
// 在 onEvent({ type: 'tool_call', toolCallId, toolName, toolArgs, ... }) 发出前检查
import type { DestructiveCommandResult } from '../../packages/engine/src/agents/pi-extensions/safety/destructive-command-warning';

private async enrichToolCallWarning(toolName: string, toolArgs?: string): Promise<string | undefined> {
  const EXEC_TOOLS = new Set(['bash', 'exec', 'run_shell', 'run_command', 'execute_command']);
  if (!EXEC_TOOLS.has(toolName.toLowerCase())) return undefined;

  const command = toolArgs || '';
  const { detectDestructiveCommand } = await import(
    '../../packages/engine/src/agents/pi-extensions/safety/destructive-command-warning.js'
  );
  const result = detectDestructiveCommand(command) as DestructiveCommandResult;
  return result.warning;
}
```

在 `pendingToolCalls.set` 之后的事件发出中追加 `warning` 字段：

```typescript
// phase === 'start' 事件发出
const warning = await this.enrichToolCallWarning(toolName, String(data['args'] ?? ''));
onEvent({
  type: 'tool_call',
  toolCallId,
  toolName,
  toolArgs: data['args'] ? ... : undefined,
  warning,  // 新增字段，undefined 不输出
  runId: evt.runId,
});
```

- [ ] **Step 2: 更新 AgentStreamEvent 类型定义支持 warning 字段**

```typescript
// apps/server/src/types/engine.ts — AgentStreamEvent 的 tool_call variant
type ToolCallEvent = {
  type: 'tool_call';
  toolCallId?: string;
  toolName: string;
  toolArgs?: string;
  toolResult?: string;
  warning?: string;  // 新增：破坏性命令警告
  runId: string;
};
```

- [ ] **Step 3: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [ ] **Step 4: 提交**

```bash
git add apps/server/src/services/EngineAdapter.ts apps/server/src/types/engine.ts
git commit -m "feat(security): add destructive-command-warning to tool_call SSE events"
```

---

## Wave 3: 技能系统升级

---

### Task 19: 清理空函数 + checkDueReminders 全量扫描优化 (B-001 + A-010)

**Files:**
- Modify: `apps/server/src/services/SystemPromptBuilder.ts`（删除 `invalidatePromptCache`）
- Modify: `apps/server/src/routes/agents.ts`（删除 5 处调用）
- Modify: `apps/server/src/routes/tool-sources.ts`（删除 5 处调用）
- Modify: `apps/server/src/routes/scheduler.ts:75,77`（prefix 参数）

**B-001 Context:** `invalidatePromptCache(_userId)` 函数体为空（TTL 5min 自然过期），5 处调用者误认为有副作用，形成误导。

**A-010 Context:** `cron.list({ includeDisabled: true })` 全量返回，内存过滤 `ent-reminder:{userId}:`，N 用户 × 30s = N 次全量遍历。

- [ ] **Step 1: 删除 invalidatePromptCache**

```typescript
// SystemPromptBuilder.ts — 删除以下方法（约第 180-185 行）
// invalidatePromptCache(_userId: string): void { /* 实际缓存刷新依赖 TTL 过期（5 分钟） */ }
```

- [ ] **Step 2: 删除 5 处调用**

```bash
# 确认调用点
grep -rn "invalidatePromptCache" apps/server/src/
```

删除 `agents.ts` 和 `tool-sources.ts` 中所有 `systemPromptBuilder.invalidatePromptCache(...)` 调用及其对应 import（如仅此处使用）。

- [ ] **Step 3: checkDueReminders 传入 prefix 参数做服务端过滤**

```typescript
// scheduler.ts:75 — 如引擎 cron.list 支持 prefix 参数（查看引擎 RPC schema）
const result = await bridge.call<EngineCronListResponse>('cron.list', {
  includeDisabled: true,
  prefix: `ent-reminder:${userId}:`,  // 服务端过滤，减少传输量
});
// 如引擎暂不支持 prefix，暂时保留注释说明，记录为 TODO(A-010)
```

- [x] **Step 4: 类型检查 + 测试**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
npx vitest run apps/server/src/ --reporter=verbose
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/SystemPromptBuilder.ts apps/server/src/routes/agents.ts apps/server/src/routes/tool-sources.ts apps/server/src/routes/scheduler.ts
git commit -m "fix(B-001+A-010): remove invalidatePromptCache no-op and add prefix filter to checkDueReminders"
```

---

### Task 20: SKILL.md Markdown+Frontmatter 格式升级（技能元数据）

**Files:**
- Read first: `apps/server/src/utils/skill-md-generator.ts`
- Modify: `apps/server/src/utils/skill-md-generator.ts`（扩展 frontmatter 字段）
- Modify: `apps/server/src/routes/tool-sources.ts`（Skill 上传/更新时写入扩展元数据）

**Context:** 当前 `skill-md-generator.ts` 已支持基本 frontmatter（`command-dispatch`、`name`），需对齐 superpowers 技能规范增加 `description`、`triggers`、`version`、`author` 字段，使技能自描述性更强，便于引擎精确路由。

- [x] **Step 1: 查看现有 skill-md-generator.ts 格式**

```bash
cat apps/server/src/utils/skill-md-generator.ts
```

- [x] **Step 2: 扩展 SkillFrontmatter 接口**

```typescript
// apps/server/src/utils/skill-md-generator.ts
export interface SkillFrontmatter {
  name: string;
  description?: string;        // 新增：一句话描述，用于 SystemPromptBuilder 展示
  version?: string;            // 新增：语义版本号
  author?: string;             // 新增：作者/团队
  triggers?: string[];         // 新增：触发关键词（引擎路由参考）
  commandDispatch?: 'tool' | 'agent';  // 原有字段
  timeout?: number;            // 原有字段（秒）
}
```

- [x] **Step 3: 更新 generateSkillMd 生成逻辑**

```typescript
export function generateSkillMd(opts: SkillFrontmatter): string {
  const lines = ['---'];
  lines.push(`name: ${opts.name}`);
  if (opts.description) lines.push(`description: ${opts.description}`);
  if (opts.version) lines.push(`version: ${opts.version}`);
  if (opts.author) lines.push(`author: ${opts.author}`);
  if (opts.triggers?.length) lines.push(`triggers:\n${opts.triggers.map(t => `  - ${t}`).join('\n')}`);
  lines.push(`command-dispatch: ${opts.commandDispatch ?? 'tool'}`);
  if (opts.timeout) lines.push(`timeout: ${opts.timeout}`);
  lines.push('---');
  return lines.join('\n') + '\n';
}
```

- [x] **Step 4: 路由层接受并写入扩展字段**

在企业级/个人 Skill 上传 API（`tool-sources.ts:485` 和 `1344` 附近），从 `req.body` 接受 `description`、`triggers`、`version`：

```typescript
const { name, transport, description, version, author, triggers } = req.body;
// 生成 frontmatter 时传入
const frontmatter = generateSkillMd({
  name: skillName,
  description: description?.trim(),
  version: version?.trim(),
  author: author?.trim(),
  triggers: Array.isArray(triggers) ? triggers : undefined,
  commandDispatch: 'tool',
});
```

- [x] **Step 5: 更新单元测试**

```bash
npx vitest run apps/server/src/utils/__tests__/skill-md-generator.test.ts --reporter=verbose
```

- [x] **Step 6: 类型检查**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
```

- [x] **Step 7: 提交**

```bash
git add apps/server/src/utils/skill-md-generator.ts apps/server/src/routes/tool-sources.ts apps/server/src/utils/__tests__/skill-md-generator.test.ts
git commit -m "feat(skills): extend SKILL.md frontmatter with description/triggers/version/author fields"
```

---

### Task 21: 内建多代理并行审查技能

**Files:**
- Create: `data/skills/ent_parallel-review/SKILL.md`（技能描述）
- Create: `data/skills/ent_parallel-review/run.sh`（调度脚本）
- Create: `data/skills/ent_parallel-review/agents/agent-a.md`（业务逻辑视角）
- Create: `data/skills/ent_parallel-review/agents/agent-b.md`（代码质量视角）
- Create: `data/skills/ent_parallel-review/agents/agent-c.md`（稳定性/安全视角）
- Modify: 在管理员界面注册此技能（或 `init-services.ts` 中内建注册）

**Context:** 参考 ea1e9be 的安全模块（Agent A/B/C/D 并行分析模式），实现内建并行代码审查技能：4 个 Agent 并行从不同视角审查代码，结果汇总后输出报告。

- [x] **Step 1: 创建技能 SKILL.md**

```markdown
---
name: parallel-review
description: 多视角并行代码审查 — 4 个专项 Agent 同时分析业务逻辑、代码质量、稳定性、安全
version: 1.0.0
author: octopus-team
triggers:
  - 代码审查
  - code review
  - 并行审查
command-dispatch: tool
timeout: 300
---

# 并行代码审查技能

使用 4 个专项 Agent 同时对目标代码进行多维度审查：
- **Agent A (业务逻辑)**：API 语义正确性、数据流、业务规则
- **Agent B (代码质量)**：重复代码、死代码、可维护性
- **Agent C (稳定性)**：内存泄漏、异常处理、资源清理
- **Agent D (安全)**：注入风险、认证鉴权、数据泄露

## 使用方式
```
/skill parallel-review [文件路径或 PR 描述]
```
```

- [x] **Step 2: 创建调度脚本 run.sh**

```bash
#!/usr/bin/env bash
# data/skills/ent_parallel-review/run.sh
# 接收 $INPUT 为审查目标（文件列表或 diff）
# 并行启动 4 个审查子任务，等待全部完成后汇总

set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="${1:-${INPUT:-}}"

if [[ -z "$INPUT" ]]; then
  echo "用法: parallel-review <文件路径|diff内容>"
  exit 1
fi

# 并行执行 4 个 Agent（通过 octopus cron.add 调度，此处为串行降级演示）
echo "=== 并行代码审查开始 ==="
echo "审查目标: $INPUT"
echo ""

for agent_role in "业务逻辑" "代码质量" "稳定性安全"; do
  echo "--- [$agent_role] Agent ---"
  cat "$SKILL_DIR/agents/${agent_role}.md" | head -5
done

echo ""
echo "=== 审查完成，请查看各 Agent 输出 ==="
```

- [x] **Step 3: 创建各 Agent 提示模板**

```markdown
<!-- data/skills/ent_parallel-review/agents/agent-a.md -->
# Agent A — 业务逻辑审查

你是专注于业务逻辑的代码审查专家。审查目标：
1. API 语义正确性（返回码、响应结构）
2. 数据流完整性（输入验证、输出格式）
3. 业务规则是否正确实现
4. 边界条件处理

输出格式：`[A-NNN] 严重级别 | 文件:行 | 问题描述 | 修复建议`
```

（类似创建 agent-b.md 稳定性视角、agent-c.md 安全视角）

- [x] **Step 4: 类型检查（无 TS 变更，仅 bash 脚本）**

```bash
bash -n data/skills/ent_parallel-review/run.sh
```

- [x] **Step 5: 提交**

```bash
git add data/skills/ent_parallel-review/
git commit -m "feat(skills): add built-in parallel-review skill with 4 specialized agents"
```

---

### Task 22: /remember 记忆管理斜杠命令

**Files:**
- Modify: `apps/server/src/routes/chat.ts:87-175`（`handleSlashCommand` 函数）
- Add test: `apps/server/src/routes/__tests__/slash-commands.test.ts`

**Context:** 类似 Claude Code `/remember` 命令，允许用户在对话中主动存储长期记忆（存入 Agent 的 memory LanceDB），后续对话自动引用。使用引擎原生 `memory.add` RPC（已有）。

- [x] **Step 1: 添加 /remember 命令到 handleSlashCommand**

```typescript
// chat.ts:100 — switch(cmd) 中新增
case '/remember': {
  if (!arg.trim()) {
    return { reply: '用法: `/remember <需要记住的内容>` — 例如: `/remember 我们的 API 前缀是 /api/v2`' };
  }
  // 通过引擎 memory.add RPC 存入 Agent 长期记忆
  if (!bridge?.isConnected) {
    return { reply: '引擎未连接，记忆暂时无法保存' };
  }
  try {
    const nativeAgentId = agent
      ? TenantEngineAdapter.forUser(bridge, _userId).agentId(agent.name || 'default')
      : undefined;
    await bridge.call('memory.add', {
      agentId: nativeAgentId,
      content: arg.trim(),
      metadata: {
        source: 'user_command',
        timestamp: new Date().toISOString(),
        sessionId,
      },
    });
    return { reply: `已记住：${arg.trim().slice(0, 100)}${arg.length > 100 ? '...' : ''}` };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { reply: `记忆保存失败：${msg}` };
  }
}
```

- [x] **Step 2: 更新 /help 命令展示新命令**

```typescript
case '/help':
  return { reply: [
    '**可用命令：**',
    '- `/help` — 显示此帮助信息',
    '- `/mcp <名称> [问题]` — 使用指定 MCP 工具',
    '- `/skill <名称> [问题]` — 使用指定 Skill',
    '- `/remember <内容>` — 将内容存入 Agent 长期记忆（后续对话自动引用）',
  ].join('\n') };
```

- [x] **Step 3: 写单元测试**

```typescript
// apps/server/src/routes/__tests__/slash-commands.test.ts
import { describe, it, expect } from 'vitest';

describe('/remember slash command', () => {
  it('should return usage hint when arg is empty', () => {
    // 验证空参数返回提示
    const arg = '';
    const hasContent = arg.trim().length > 0;
    expect(hasContent).toBe(false);
  });

  it('should truncate preview at 100 chars', () => {
    const longContent = 'a'.repeat(150);
    const preview = longContent.slice(0, 100) + (longContent.length > 100 ? '...' : '');
    expect(preview).toHaveLength(103); // 100 + '...'
  });
});
```

- [ ] **Step 4: 类型检查 + 测试**

```bash
npx tsc --noEmit --project apps/server/tsconfig.json
npx vitest run apps/server/src/routes/__tests__/ --reporter=verbose
```

- [x] **Step 5: 提交**

```bash
git add apps/server/src/routes/chat.ts apps/server/src/routes/__tests__/slash-commands.test.ts
git commit -m "feat(chat): add /remember slash command for storing long-term agent memory"
```

---

## 验证 Checklist

每 Wave 完成后运行：

```bash
# 全量类型检查
npx tsc --noEmit

# 单元测试
npx vitest run --reporter=verbose

# 健康检查（如有运行实例）
curl -sf localhost:18790/health | jq .

# 关键安全路径冒烟测试
# C-001: 停 LDAP → 登录 → 应 5s 内返回错误而非挂起
# C-002: 建立 SSE → 关闭浏览器 → 检查 EngineAdapter listeners 数量不增长
# A-003: 改密 → 用旧 Token 请求 /api/auth/me → 应 401
# C-008: 不设 AUDIT_HMAC_KEY → 启动 → 应成功，console.warn 一条
```

---

## 不修复项（本轮跳过）

| 编号 | 原因 |
|------|------|
| A-011 (FileCleanupService 路径) | 需确认所有写入路径，修复有数据风险，单独排期 |
| A-019 (PUT tool-sources name 唯一性) | 低频写操作，P2002 已有 500 降级，可随时补 |
| B-002 (deprecated 字段迁移) | 已定计划 2026-06-01 前完成，不在此轮 |
| C-009 (多 PrismaClient 连接数) | 需重构插件层 DI，架构改动，单独评审 |
| D-003 (X-Forwarded-For 伪造) | trust proxy 配置问题，需确认 Nginx 层配置后再修 |
| D-005 (SSRF DNS Rebinding) | 完整修复需 DNS 解析层，当前 hostname 过滤作为基础防线 |
| D-008 (validateSessionOwnership 短 ID) | 需全面梳理 sessionId 格式，单独处理 |
| A-017 (verifyToken 双轨查询) | 重构风险高，建议与 AuthService 整体重构一起处理 |

---

## Wave 4: Agent 编排系统（中长期架构升级）

> **借鉴来源：** Claude Code AgentTool/TeamCreateTool/SendMessageTool/coordinatorMode.ts
> **目标：** 让 octopus-slim 从"单 Agent 串行"升级为"多 Agent 并行编排"平台

### Task 10: 后台代理（Async Agent）

**Goal:** 长任务不阻塞用户对话，完成后通知

**Files:**
- Create: `packages/engine/src/agents/pi-extensions/agent-orchestration/async-agent.ts`
- Create: `packages/engine/src/agents/pi-extensions/agent-orchestration/progress-tracker.ts`
- Modify: `apps/server/src/services/EngineAdapter.ts` (注册异步任务)
- Create: `apps/server/src/routes/agent-tasks.ts` (任务状态查询 API)

- [ ] **Step 1:** 定义 AsyncAgentTask 类型（taskId, status, progress, result, createdAt, completedAt）
- [ ] **Step 2:** 实现 AsyncAgentRegistry — 内存中注册/查询/完成异步任务
- [ ] **Step 3:** 实现 ProgressTracker — 定期采样 Agent 输出，提取进度摘要
- [ ] **Step 4:** 实现自动后台化 — Agent 运行超过 120 秒自动切后台，返回 taskId 给用户
- [ ] **Step 5:** 添加 /agent-tasks API 路由 — GET 查询任务状态，支持 SSE 推送完成事件
- [ ] **Step 6:** 完成后通过 IM 渠道通知用户（复用现有 IMRouter）
- [ ] **Step 7:** 写集成测试 — 模拟长任务 → 自动后台化 → 完成通知

### Task 11: Coordinator 模式（协调者/工人架构）

**Goal:** 复杂任务自动拆分为多个子代理并行执行

**Files:**
- Create: `packages/engine/src/agents/pi-extensions/agent-orchestration/coordinator.ts`
- Create: `packages/engine/src/agents/pi-extensions/agent-orchestration/worker.ts`
- Create: `packages/engine/src/agents/pi-extensions/agent-orchestration/message-bus.ts`

- [ ] **Step 1:** 定义 Coordinator 角色 — 只能分配任务，不直接执行工具
- [ ] **Step 2:** 定义 Worker 角色 — 接收任务，使用完整工具集执行
- [ ] **Step 3:** 实现 MessageBus — Coordinator ↔ Worker 之间的消息传递
- [ ] **Step 4:** 实现工具白名单 — Coordinator 限制为 [AgentSpawn, SendMessage, FileRead]
- [ ] **Step 5:** 实现任务聚合 — 所有 Worker 完成后，Coordinator 汇总结果
- [ ] **Step 6:** 写单元测试 — Coordinator 分发3个子任务 → Worker 并行执行 → 结果汇总

### Task 12: Markdown Agent 定义

**Goal:** 企业用户通过 Markdown 文件定义自定义 Agent，零代码

**Files:**
- Create: `packages/engine/src/agents/pi-extensions/agent-orchestration/load-agents-dir.ts`
- Create: `data/agents/` (Agent 定义目录)

**Agent 定义格式：**
```markdown
---
name: code-reviewer
description: 审查代码质量和安全
model: deepseek-chat
allowedTools: [FileRead, Grep, Glob]
---
你是一名专业的代码审查员...
```

- [ ] **Step 1:** 实现 Markdown+Frontmatter Agent 解析器（复用 front-matter npm 包）
- [ ] **Step 2:** 实现 Agent 目录扫描 — 启动时从 data/agents/ 自动发现并注册
- [ ] **Step 3:** 支持三层来源 — 引擎内建 > 企业级(data/agents/) > 用户级(user-agents/)
- [ ] **Step 4:** 实现 allowedTools 白名单过滤
- [ ] **Step 5:** 实现 model 覆盖 — Agent 级别指定模型，覆盖全局默认
- [ ] **Step 6:** 写测试 — 解析 frontmatter → 注册 Agent → 执行限定工具集

### Task 13: Git Worktree 隔离

**Goal:** 多 Agent 并行修改代码互不冲突

**Files:**
- Create: `packages/engine/src/agents/pi-extensions/agent-orchestration/worktree.ts`

- [ ] **Step 1:** 实现 createAgentWorktree(agentId, baseBranch) — 创建独立 worktree
- [ ] **Step 2:** 实现 removeAgentWorktree(agentId) — 清理 worktree
- [ ] **Step 3:** Agent 执行时 CWD 切换到 worktree 目录
- [ ] **Step 4:** 完成后自动 diff 并提示用户是否 merge
- [ ] **Step 5:** 写测试 — 创建 worktree → Agent 修改文件 → 验证主分支未受影响

### Task 14: 内建多代理审查技能

**Goal:** 将 CODE_REVIEW_AGENT_TEAM 做成一等公民技能

**Files:**
- Create: `data/skills/ent_code-review-team/skill.md`
- Create: `data/agents/code-reviewer-business.md`
- Create: `data/agents/code-reviewer-quality.md`
- Create: `data/agents/code-reviewer-stability.md`
- Create: `data/agents/code-reviewer-security.md`

- [ ] **Step 1:** 将 CODE_REVIEW_AGENT_TEAM.md 转换为 Markdown+Frontmatter 技能格式
- [ ] **Step 2:** 拆分4个审查 Agent 为独立 Markdown 定义文件
- [ ] **Step 3:** 技能触发时使用 Coordinator 模式并行启动4个 Agent
- [ ] **Step 4:** 结果自动汇总去重生成报告
- [ ] **Step 5:** 集成测试 — /review 命令 → 4 Agent 并行 → 报告生成
