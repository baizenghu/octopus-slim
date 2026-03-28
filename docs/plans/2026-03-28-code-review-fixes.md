# 代码审查问题修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复代码审查验证后的 6 个 Critical + 16 个 Important 问题，覆盖安全、数据一致性、架构合规、前端质量四个维度。

**Architecture:** 分 4 个 Phase 按依赖顺序执行。Phase 1 修复安全与数据完整性（无依赖，可并行）；Phase 2 修复架构与集成问题；Phase 3 修复可靠性与生命周期；Phase 4 修复前端问题。每个 Task 独立可提交。

**Tech Stack:** TypeScript, Express, Prisma, React, Vitest

---

## Phase 1: 安全与数据完整性（Critical 优先）

### Task 1: C2 — system-config API 脱敏 API Key

**Files:**
- Modify: `apps/server/src/routes/system-config.ts:69-74`

- [ ] **Step 1: 在 system-config.ts GET 路由中添加 apiKey 脱敏**

在 `res.json({ config })` 之前，递归遍历 `config.models.providers` 对 apiKey 脱敏：

```typescript
// apps/server/src/routes/system-config.ts — GET '/' 路由内, res.json 之前
// 脱敏 provider apiKey（只显示前4后4位）
if (config.models?.providers) {
  for (const provider of Object.values(config.models.providers) as any[]) {
    if (provider?.apiKey && typeof provider.apiKey === 'string') {
      const key = provider.apiKey;
      provider.apiKey = key.length > 12
        ? `${key.slice(0, 4)}****${key.slice(-4)}`
        : '********';
    }
  }
}
// 脱敏 plugin 中的敏感字段
if (config.plugins?.entries) {
  for (const entry of Object.values(config.plugins.entries) as any[]) {
    if (entry?.config?.embeddingApiKey) {
      const k = entry.config.embeddingApiKey;
      entry.config.embeddingApiKey = k.length > 12
        ? `${k.slice(0, 4)}****${k.slice(-4)}`
        : '********';
    }
  }
}
```

- [ ] **Step 2: 修改 PUT 路由保留完整 key**

PUT `/models` 和 `/plugins` 路由写入时，如果前端发来的 apiKey 匹配 `****` 模式，从磁盘读取原始值保留：

```typescript
// apps/server/src/routes/system-config.ts — PUT '/models' 路由内, 写入前
// 如果 apiKey 是脱敏值（含 ****），保留磁盘上的原始值
const oldConfig = await readConfigFromFile();
for (const [name, provider] of Object.entries(providers) as [string, any][]) {
  if (provider?.apiKey?.includes('****') && oldConfig.models?.providers?.[name]?.apiKey) {
    provider.apiKey = oldConfig.models.providers[name].apiKey;
  }
}
```

- [ ] **Step 3: 同时修复 authMiddleware 缺少 prisma 参数**

```typescript
// apps/server/src/routes/system-config.ts:62 — 修改函数签名和 authMiddleware 创建
export function createSystemConfigRouter(
  authService: AuthService,
  bridge: EngineAdapter,
  prisma?: any,   // 新增
): Router {
  const router = Router();
  const authMiddleware = createAuthMiddleware(authService, prisma);  // 注入 prisma
```

- [ ] **Step 4: 验证**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/routes/system-config.ts
git commit -m "fix(security): redact apiKey in system-config GET response, inject prisma into auth middleware"
```

---

### Task 2: C4 — 用户删除级联清理加事务

**Files:**
- Modify: `apps/server/src/routes/admin.ts:316-327`

- [ ] **Step 1: 将 7 个 deleteMany + user.delete 包入 $transaction，移除空 catch**

```typescript
// apps/server/src/routes/admin.ts:316-327 — 替换为事务
await prisma.$transaction(async (tx) => {
  await tx.agent.deleteMany({ where: { ownerId: id } });
  await tx.scheduledTask.deleteMany({ where: { userId: id } });
  await tx.databaseConnection.deleteMany({ where: { userId: id } });
  await tx.toolSource.deleteMany({ where: { ownerId: id } });
  await tx.generatedFile.deleteMany({ where: { userId: id } });
  await tx.iMUserBinding.deleteMany({ where: { userId: id } });
  await tx.mailLog.deleteMany({ where: { userId: id } });
  await tx.user.delete({ where: { userId: id } });
});
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/routes/admin.ts
git commit -m "fix(data): wrap user deletion cascade in $transaction, remove silent catch"
```

---

### Task 3: C5 — PrismaAgentStore allow/alsoAllow 映射修复

**Files:**
- Modify: `apps/server/src/services/PrismaAgentStore.ts:194`

- [ ] **Step 1: 修复 toDbRecord 的 tools 映射**

```typescript
// apps/server/src/services/PrismaAgentStore.ts:192-196
// 替换原来的三行为：
if (entry.tools !== undefined) {
  data.toolsProfile = entry.tools.profile ?? null;
  data.toolsAllow = entry.tools.alsoAllow ?? entry.tools.allow ?? null;  // 优先 alsoAllow
  data.toolsDeny = entry.tools.deny ?? null;
}
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/services/PrismaAgentStore.ts
git commit -m "fix(agent-store): map tools.alsoAllow to DB toolsAllow (was reading tools.allow)"
```

---

### Task 4: C8 — cron 事件名不匹配

**Files:**
- Modify: `apps/server/src/startup/init-engine-events.ts:21`

- [ ] **Step 1: 修改事件监听名**

```typescript
// apps/server/src/startup/init-engine-events.ts:21
// 将 'cron' 改为 'cron_finished'
bridge.on('cron_finished', (payload: any) => {
  if (payload?.action === 'started' || payload?.action === 'finished') {
    logger.info(`job ${payload.jobId} ${payload.action}`);
  }
});
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/startup/init-engine-events.ts
git commit -m "fix: listen for 'cron_finished' event (was 'cron', never fired)"
```

---

### Task 5: C3 — SSE 流添加限流和超时

**Files:**
- Modify: `apps/server/src/routes/chat.ts:319-321`

- [ ] **Step 1: 添加 per-user 并发连接限制和最大流时长**

在 `chat.ts` 文件顶部（模块级）添加并发追踪 Map：

```typescript
// apps/server/src/routes/chat.ts — 模块顶部（sessionPrefs 附近）
const activeStreams = new Map<string, number>(); // userId → 活跃 SSE 连接数
const MAX_CONCURRENT_STREAMS = 5;
const MAX_STREAM_DURATION_MS = 30 * 60 * 1000; // 30 分钟
```

在 `/stream` 路由内，`res.writeHead` 之前添加并发检查：

```typescript
// apps/server/src/routes/chat.ts — res.writeHead 之前
const currentStreams = activeStreams.get(user.id) || 0;
if (currentStreams >= MAX_CONCURRENT_STREAMS) {
  res.status(429).json({ error: '并发对话数超限，请关闭其他对话后重试' });
  return;
}
activeStreams.set(user.id, currentStreams + 1);
```

替换 `setTimeout(0)` 为最大流时长：

```typescript
// apps/server/src/routes/chat.ts:320-321 — 替换 setTimeout(0)
req.setTimeout(MAX_STREAM_DURATION_MS);
res.setTimeout(MAX_STREAM_DURATION_MS);
```

在 `res.on('close')` 回调中递减计数：

```typescript
// apps/server/src/routes/chat.ts — res.on('close') 回调内追加
const remaining = (activeStreams.get(user.id) || 1) - 1;
if (remaining <= 0) activeStreams.delete(user.id);
else activeStreams.set(user.id, remaining);
```

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/routes/chat.ts
git commit -m "fix(security): add per-user SSE concurrency limit (5) and max stream duration (30min)"
```

---

### Task 6: I4 — 另外 2 个路由 authMiddleware 注入 prisma

**Files:**
- Modify: `apps/server/src/routes/audit.ts:23-24`
- Modify: `apps/server/src/routes/files.ts:67`

- [ ] **Step 1: 修复 audit.ts**

找到 `createAuditRouter` 函数签名，增加 `prisma` 参数并传入 `createAuthMiddleware`：

```typescript
// audit.ts — 修改函数签名和 authMiddleware
export function createAuditRouter(authService: AuthService, prisma?: any): Router {
  const authMiddleware = createAuthMiddleware(authService, prisma);
```

- [ ] **Step 2: 修复 files.ts**

```typescript
// files.ts — 修改函数签名和 authMiddleware
// 在 createFilesRouter 参数中确保有 prisma，并传入 createAuthMiddleware
const authMiddleware = createAuthMiddleware(authService, prisma);
```

- [ ] **Step 3: 更新 init-routes.ts 中的调用方传入 prisma**

确认 `init-routes.ts` 中调用 `createAuditRouter`、`createFilesRouter`、`createSystemConfigRouter` 时传入 `prismaClient`。

- [ ] **Step 4: 验证编译并提交**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/routes/audit.ts apps/server/src/routes/files.ts apps/server/src/startup/init-routes.ts
git commit -m "fix(auth): inject prisma into audit/files/system-config auth middleware for DB validation"
```

---

### Task 7: I1 + I3 — Agent name 格式校验 + 消息长度限制

**Files:**
- Modify: `apps/server/src/routes/agents.ts:242-244`
- Modify: `apps/server/src/routes/chat.ts:239-241`

- [ ] **Step 1: agents.ts 添加 name 格式和长度校验**

```typescript
// apps/server/src/routes/agents.ts:242-244 — 替换原有校验
if (!name || typeof name !== 'string' || !name.trim()) {
  res.status(400).json({ error: 'name is required' });
  return;
}
const trimmedName = name.trim();
if (trimmedName.length > 50) {
  res.status(400).json({ error: 'Agent 名称不能超过 50 个字符' });
  return;
}
if (!/^[\w\u4e00-\u9fa5-]+$/.test(trimmedName)) {
  res.status(400).json({ error: 'Agent 名称只能包含字母、数字、中文、下划线和连字符' });
  return;
}
if (['default', 'system', 'admin'].includes(trimmedName.toLowerCase())) {
  res.status(400).json({ error: '不能使用保留名称' });
  return;
}
```

- [ ] **Step 2: chat.ts 添加消息长度限制**

```typescript
// apps/server/src/routes/chat.ts:239-241 — 在非空校验后追加
const MAX_MESSAGE_LENGTH = 100_000; // 100K 字符
if (message && message.length > MAX_MESSAGE_LENGTH) {
  res.status(400).json({ error: `消息长度不能超过 ${MAX_MESSAGE_LENGTH} 个字符` });
  return;
}
```

- [ ] **Step 3: 验证编译并提交**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/routes/agents.ts apps/server/src/routes/chat.ts
git commit -m "fix(validation): add agent name format check + chat message length limit (100K)"
```

---

### Task 8: I2 + I5 — execSync 注入 + db-connections SSRF

**Files:**
- Modify: `apps/server/src/routes/tool-sources.ts:255-257`
- Modify: `apps/server/src/routes/db-connections.ts:42-56`

- [ ] **Step 1: tool-sources.ts 替换 execSync 为 execFileSync**

```typescript
// apps/server/src/routes/tool-sources.ts:255-257 — 替换 execSync
// 原: execSync(`${venvPip} install "${depsDir}/"*.whl ...`)
// 新: 使用 glob 找到 whl 文件，用 execFileSync 避免 shell 注入
import { globSync } from 'fs';
const whlFiles = globSync(path.join(depsDir, '*.whl'));
if (whlFiles.length > 0) {
  execFileSync(venvPip, ['install', ...whlFiles, '--quiet', '--disable-pip-version-check', '--no-deps'], {
    timeout: 120000, stdio: 'pipe',
  });
}
```

- [ ] **Step 2: db-connections.ts 添加 host SSRF 校验**

```typescript
// apps/server/src/routes/db-connections.ts — 在 prisma.create 之前
import { validateMcpUrl } from '../utils/url-validator';

// 校验 host 不是内网地址
const hostCheck = validateMcpUrl(`http://${host}:${port}`);
if (!hostCheck.valid) {
  res.status(400).json({ error: `数据库主机地址不安全: ${hostCheck.error}` });
  return;
}
```

- [ ] **Step 3: 验证编译并提交**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/routes/tool-sources.ts apps/server/src/routes/db-connections.ts
git commit -m "fix(security): replace execSync with execFileSync, add SSRF check to db-connections"
```

---

## Phase 2: 架构与集成修复

### Task 9: I6 — configApply 添加 diff 跳过

**Files:**
- Modify: `apps/server/src/services/EngineAdapter.ts:463-466`

- [ ] **Step 1: 修改 configApply 方法**

```typescript
// apps/server/src/services/EngineAdapter.ts:463-466 — 替换
async configApply(patch: Record<string, unknown>): Promise<void> {
  return this.configRetryLoop('configApply', (config) => {
    const merged = deepMerge(config, patch);
    // diff: 无变化时跳过写入，避免不必要的引擎 reload
    if (JSON.stringify(merged) === JSON.stringify(config)) return null;
    return merged;
  });
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/services/EngineAdapter.ts
git commit -m "fix(engine): skip config write when configApply patch produces no diff"
```

---

### Task 10: I7 — currentDeny 从 DB 读取

**Files:**
- Modify: `apps/server/src/services/AgentConfigSync.ts:152-155`

- [ ] **Step 1: 从 DB 读取当前 agent 的 toolsDeny**

```typescript
// apps/server/src/services/AgentConfigSync.ts:152-155 — 替换硬编码空数组
let currentDeny: string[] = [];
if (opts.agentName) {
  const dbAgent = await prisma.agent.findFirst({
    where: { ownerId: userId, name: opts.agentName },
    select: { toolsDeny: true },
  });
  if (dbAgent?.toolsDeny && Array.isArray(dbAgent.toolsDeny)) {
    currentDeny = dbAgent.toolsDeny as string[];
  }
}
updateParams.tools = computeToolsUpdate(
  opts.agentName, opts.toolsFilter, opts.mcpFilter, opts.skillsFilter, currentDeny,
);
```

注意：需要确保 `prisma` 在 `syncAgentToEngine` 的作用域内可用（从函数参数或模块级引用获取）。

- [ ] **Step 2: 验证编译并提交**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/services/AgentConfigSync.ts
git commit -m "fix(agent-sync): read currentDeny from DB instead of hardcoded empty array"
```

---

### Task 11: I11 + I12 — Agent 删除清理心跳 + Skill 删除重算权限

**Files:**
- Modify: `apps/server/src/routes/agents.ts:413-478`
- Modify: `apps/server/src/routes/tool-sources.ts:633-652`

- [ ] **Step 1: agents.ts 删除 Agent 时清理关联心跳任务**

在 `prisma.agent.delete` 之前添加：

```typescript
// apps/server/src/routes/agents.ts — DELETE 路由, prisma.agent.delete 之前
// 清理关联的心跳定时任务
const heartbeatTasks = await prisma.scheduledTask.findMany({
  where: { userId: user.id, taskType: 'heartbeat' },
});
for (const task of heartbeatTasks) {
  const cfg = task.taskConfig as any;
  if (cfg?.agentId === id || cfg?.agentName === agentName) {
    // 从引擎 cron 移除
    if (cfg?.cronJobId && bridge?.isConnected) {
      await bridge.call('cron.remove', { id: cfg.cronJobId }).catch(() => {});
    }
    await prisma.scheduledTask.delete({ where: { id: task.id } });
    logger.info(`Cleaned heartbeat task ${task.id} for deleted agent ${id}`);
  }
}
```

- [ ] **Step 2: tool-sources.ts Skill 删除后重算 Agent 权限**

在清理 Agent 引用后（约 650 行），对受影响的 Agent 调用权限重算：

```typescript
// apps/server/src/routes/tool-sources.ts — 删除 Skill 清理 Agent 引用之后
// 重算受影响 Agent 的 tools deny
for (const agent of referencingAgents) {
  const updatedFilter = (agent[filterField as keyof typeof agent] as string[] || [])
    .filter(s => s !== id && s !== existing.name);
  // 重算 tools 配置并更新 DB
  const toolsUpdate = computeToolsUpdate(
    agent.name, agent.toolsFilter as string[] | undefined,
    agent.mcpFilter as string[] | undefined,
    updatedFilter.length > 0 ? updatedFilter : undefined,
    (agent.toolsDeny as string[]) || [],
  );
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      [filterField]: updatedFilter.length > 0 ? updatedFilter : Prisma.JsonNull,
      toolsProfile: toolsUpdate.profile ?? null,
      toolsAllow: toolsUpdate.alsoAllow ?? null,
      toolsDeny: toolsUpdate.deny ?? null,
    },
  });
}
```

- [ ] **Step 3: 验证编译并提交**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
git add apps/server/src/routes/agents.ts apps/server/src/routes/tool-sources.ts
git commit -m "fix(data): clean heartbeat tasks on agent delete, recompute permissions on skill delete"
```

---

### Task 12: I14 — mcpFilter null 语义统一

**Files:**
- Modify: `plugins/mcp/src/index.ts:70-73`

- [ ] **Step 1: 修改 isMcpServerAllowed 语义**

```typescript
// plugins/mcp/src/index.ts:70-73 — 替换
function isMcpServerAllowed(serverNameOrId: string, filter: string[] | null): boolean {
  // null/undefined = 未配置 = 允许所有（而非全部禁用）
  if (filter === null || filter === undefined) return true;
  // 空数组 = 显式禁用全部
  if (filter.length === 0) return false;
  return filter.includes(serverNameOrId);
}
```

- [ ] **Step 2: 提交**

```bash
git add plugins/mcp/src/index.ts
git commit -m "fix(mcp): null mcpFilter means 'allow all' (was incorrectly blocking all)"
```

---

### Task 13: I13 — Dashboard 审计日志聚合改用 SQL

**Files:**
- Modify: `apps/server/src/routes/admin.ts:450-457`

- [ ] **Step 1: 替换 findMany + 应用层聚合为 $queryRaw GROUP BY**

```typescript
// apps/server/src/routes/admin.ts:450-457 — 替换
const actionRows = await prisma.$queryRaw<Array<{ action: string; count: bigint }>>`
  SELECT action, COUNT(*) as count
  FROM audit_logs
  WHERE created_at >= ${weekAgo}
  GROUP BY action
  ORDER BY count DESC
  LIMIT 20
`;
const actionDistribution: Record<string, number> = {};
for (const row of actionRows) {
  actionDistribution[row.action] = Number(row.count);
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/routes/admin.ts
git commit -m "perf(admin): use SQL GROUP BY for audit log aggregation instead of full scan"
```

---

## Phase 3: 可靠性与生命周期

### Task 14: I9 + I10 — Graceful shutdown 完善

**Files:**
- Modify: `apps/server/src/index.ts:86-94`
- Modify: `apps/server/src/routes/chat.ts:52`
- Modify: `apps/server/src/routes/files.ts:36`

- [ ] **Step 1: chat.ts 和 files.ts 的 setInterval 调用 unref()**

```typescript
// apps/server/src/routes/chat.ts:52 — setInterval 后追加 .unref()
const prefsCleanup = setInterval(() => {
  // ... 已有逻辑
}, getRuntimeConfig().chat.sessionPrefsCleanupIntervalMs);
prefsCleanup.unref();

// apps/server/src/routes/files.ts:36 — 同样
const tokenCleanup = setInterval(() => {
  // ... 已有逻辑
}, 60 * 1000);
tokenCleanup.unref();
```

- [ ] **Step 2: 完善 index.ts shutdown**

```typescript
// apps/server/src/index.ts:86-94 — 替换 shutdown 函数
const shutdown = async () => {
  logger.info('Shutting down gracefully...');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await services.bridge?.shutdown();
  await services.prismaClient?.$disconnect();
  process.exit(0);
};
```

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/index.ts apps/server/src/routes/chat.ts apps/server/src/routes/files.ts
git commit -m "fix(lifecycle): unref cleanup timers, await server.close in graceful shutdown"
```

---

### Task 15: I16 — audit 插件 Prisma 连接重试

**Files:**
- Modify: `plugins/audit/src/index.ts:56-73`

- [ ] **Step 1: 添加重连逻辑**

在 DB 写入失败时尝试重连：

```typescript
// plugins/audit/src/index.ts — 替换 $connect catch 分支
// 初始连接失败时启动定时重连
let retryTimer: ReturnType<typeof setInterval> | null = null;
p.$connect()
  .then(() => {
    prisma = p;
    api.logger.info('database connected');
  })
  .catch((err: any) => {
    api.logger.error(`database connection failed: ${err.message}`);
    api.logger.warn('falling back to file-only audit, retrying every 60s');
    retryTimer = setInterval(() => {
      p.$connect()
        .then(() => {
          prisma = p;
          api.logger.info('database reconnected');
          if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
        })
        .catch((e: any) => api.logger.warn(`DB reconnect failed: ${e.message}`));
    }, 60_000);
    retryTimer.unref();
  });
```

- [ ] **Step 2: 在 gateway_stop 清理重连定时器**

```typescript
// plugins/audit/src/index.ts — gateway_stop hook 内追加
if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
```

- [ ] **Step 3: 提交**

```bash
git add plugins/audit/src/index.ts
git commit -m "fix(audit-plugin): add 60s DB reconnect retry on initial connection failure"
```

---

## Phase 4: 前端修复

### Task 16: C7 — 上传方法添加 token 刷新

**Files:**
- Modify: `apps/console/src/api.ts`

- [ ] **Step 1: 抽取 fetchWithAuth 方法，复用 401 刷新逻辑**

在 `AdminApi` 类中添加一个 `fetchWithAuth` 方法：

```typescript
// apps/console/src/api.ts — AdminApi 类内，request 方法之后
private async fetchWithAuth(url: string, options: RequestInit): Promise<Response> {
  let res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${this.token}`, ...options.headers },
  });
  if (res.status === 401 && this.refreshToken) {
    const refreshed = await this.tryRefreshToken();
    if (refreshed) {
      res = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${this.token}`, ...options.headers },
      });
    } else {
      if (this.onAuthFailure) this.onAuthFailure();
    }
  }
  return res;
}
```

- [ ] **Step 2: 将 6 个上传方法的 fetch 替换为 fetchWithAuth**

对 `uploadFile`、`uploadSkill`、`uploadPersonalSkill`、`uploadUserAvatar`、`uploadAgentAvatar`、`uploadPersonalMcpServer` 每个方法，将：

```typescript
const res = await fetch(`${API_BASE}/...`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${this.token}` },
  body: formData,
});
```

替换为：

```typescript
const res = await this.fetchWithAuth(`${API_BASE}/...`, {
  method: 'POST',
  body: formData,
});
```

- [ ] **Step 3: 提交**

```bash
git add apps/console/src/api.ts
git commit -m "fix(frontend): add token refresh to all upload methods via fetchWithAuth"
```

---

### Task 17: I17 — SSE 流式更新添加节流

**Files:**
- Modify: `apps/console/src/pages/ChatPage.tsx:345-357`

- [ ] **Step 1: 使用 ref 累积增量，用 requestAnimationFrame 批量更新**

在组件顶部添加 ref：

```typescript
// apps/console/src/pages/ChatPage.tsx — 组件内，useState 区域之后
const pendingContentRef = useRef('');
const pendingThinkingRef = useRef('');
const rafIdRef = useRef<number | null>(null);
```

替换 SSE 处理中的直接 setMessages：

```typescript
// apps/console/src/pages/ChatPage.tsx:345-357 — 替换
const content = parsed.choices?.[0]?.delta?.content || parsed.content || '';
const thinking = parsed.thinking || '';
if (content || thinking) {
  pendingContentRef.current += content;
  pendingThinkingRef.current += thinking;
  if (!rafIdRef.current) {
    rafIdRef.current = requestAnimationFrame(() => {
      const c = pendingContentRef.current;
      const t = pendingThinkingRef.current;
      pendingContentRef.current = '';
      pendingThinkingRef.current = '';
      rafIdRef.current = null;
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            content: last.content + c,
            ...(t ? { thinking: (last.thinking || '') + t } : {}),
          };
        }
        return updated;
      });
    });
  }
}
```

- [ ] **Step 2: 在流结束时清理未处理的 raf**

在 SSE `done` 处理逻辑中追加：

```typescript
// done 事件处理中
if (rafIdRef.current) {
  cancelAnimationFrame(rafIdRef.current);
  rafIdRef.current = null;
}
// flush 剩余内容
if (pendingContentRef.current || pendingThinkingRef.current) {
  const c = pendingContentRef.current;
  const t = pendingThinkingRef.current;
  pendingContentRef.current = '';
  pendingThinkingRef.current = '';
  setMessages((prev) => { /* 同上 */ });
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/console/src/pages/ChatPage.tsx
git commit -m "perf(chat): throttle SSE stream updates with requestAnimationFrame batching"
```

---

### Task 18: I18 — 文件选择大小限制

**Files:**
- Modify: `apps/console/src/pages/ChatInput.tsx:156-187`

- [ ] **Step 1: 在 handleFileSelect 开头添加大小检查**

```typescript
// apps/console/src/pages/ChatInput.tsx — handleFileSelect 函数内, forEach 之前
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const oversized = Array.from(files).filter(f => f.size > MAX_FILE_SIZE);
if (oversized.length > 0) {
  alert(`以下文件超过 20MB 限制：${oversized.map(f => f.name).join(', ')}`);
  return;
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/console/src/pages/ChatInput.tsx
git commit -m "fix(frontend): add 20MB file size limit check in ChatInput"
```

---

### Task 19: I8 — 标注 deprecated 字段迁移 TODO

**Files:**
- Modify: `apps/server/src/routes/agents.ts:201-208`

- [ ] **Step 1: 在使用 deprecated 字段处添加 TODO 注释**

此项为大范围重构（需要前后端同改 + 数据迁移脚本），本计划标注 TODO 而非立即修复：

```typescript
// apps/server/src/routes/agents.ts:263-265 — 添加注释
// TODO(P2): 迁移到 allowedToolSources 统一白名单，删除 skillsFilter/mcpFilter/toolsFilter
// 参见 docs/plans/2026-03-27-enterprise-plugin-architecture.md Phase 4
skillsFilter: skillsFilter ?? [],
mcpFilter: mcpFilter ?? [],
toolsFilter: toolsFilter ?? [],
```

- [ ] **Step 2: 提交**

```bash
git add apps/server/src/routes/agents.ts
git commit -m "chore: annotate deprecated filter fields with migration TODO"
```

---

## 验证

### Task 20: 全量验证

- [ ] **Step 1: TypeScript 编译检查**

```bash
npx tsc --noEmit -p apps/server/tsconfig.json
npx tsc --noEmit -p apps/console/tsconfig.json
```

- [ ] **Step 2: 启动服务验证**

```bash
bash start.sh
curl -s localhost:18790/health | jq .
```

Expected: `{ "status": "ok", ... }`

- [ ] **Step 3: 手动功能验证**

- 登录控制台，创建/删除 Agent
- 发送一条消息验证 SSE 流
- 管理员查看系统配置页面（确认 API Key 已脱敏）
- 管理员删除用户（确认事务原子性）

---

## 风险与回退

| 风险 | 缓解 |
|------|------|
| C2 脱敏可能导致前端保存时丢失 API Key | PUT 路由保留磁盘原始值（Task 1 Step 2） |
| C3 限流可能影响正常多窗口用户 | 限制 5 个并发足够正常使用 |
| C4 事务可能因单表锁导致性能下降 | MySQL InnoDB 行级锁，deleteMany 影响有限 |
| I14 mcpFilter null 语义变更可能导致现有 Agent 权限变化 | 需检查 DB 中实际 null 值的 Agent 数量 |
