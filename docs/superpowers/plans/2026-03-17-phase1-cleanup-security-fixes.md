# 阶段 1：清理 + 安全 + 快速修复 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除约 1800 行死代码、修复安全配置缺失、解决 20+ 个低风险具体问题

**Architecture:** 纯减法 + 配置修复 + 点状代码改进，不改变系统架构。所有改动独立且可回滚。

**Tech Stack:** TypeScript, React, Express, Prisma, OpenClaw 原生引擎配置

**Spec:** `docs/superpowers/specs/2026-03-17-system-rectification-plan.md` 阶段 1

---

## Chunk 1: 死代码删除 + 安全配置

### Task 1: 删除后端死代码

**Files:**
- Delete: `apps/server/src/services/OctopusBridge.ts`
- Delete: `apps/server/src/services/SkillTools.ts`
- Delete: `apps/server/src/services/HeartbeatForwarder.ts`
- Delete: `apps/server/src/services/__tests__/HeartbeatForwarder.test.ts`
- Modify: `apps/server/src/index.ts:56,248` (移除 HeartbeatForwarder import 和实例化)

- [ ] **Step 1: 确认 OctopusBridge 无运行时引用**

```bash
grep -r 'OctopusBridge' apps/server/src/ --include='*.ts' | grep -v '__tests__' | grep -v '.d.ts'
```
Expected: 只有 `index.ts` 中的 import（如果有）和自身定义。如果 `index.ts` 无 import，直接可删。

- [ ] **Step 2: 确认 SkillTools 无运行时引用**

```bash
grep -r 'SkillTools\|executeSkillToolCall' apps/server/src/ --include='*.ts' | grep -v 'SkillTools.ts'
```
Expected: 无结果或仅 import 未使用。

- [ ] **Step 3: 删除 OctopusBridge.ts**

```bash
rm apps/server/src/services/OctopusBridge.ts
```

- [ ] **Step 4: 删除 SkillTools.ts**

```bash
rm apps/server/src/services/SkillTools.ts
```

- [ ] **Step 5: 删除 HeartbeatForwarder 及其测试**

```bash
rm apps/server/src/services/HeartbeatForwarder.ts
rm apps/server/src/services/__tests__/HeartbeatForwarder.test.ts
```

- [ ] **Step 6: 移除 index.ts 中 HeartbeatForwarder 的 import 和实例化**

修改 `apps/server/src/index.ts`：
- 删除第 56 行 `import { HeartbeatForwarder } from './services/HeartbeatForwarder';`
- 删除第 248 行 `const heartbeatForwarder = new HeartbeatForwarder(imBridge, imService, prismaClient);` 及相关代码

- [ ] **Step 7: 清理所有残留 import**

```bash
grep -rn 'OctopusBridge\|SkillTools\|HeartbeatForwarder' apps/server/src/ --include='*.ts'
```
Expected: 无结果。如有残留 import，逐一删除。

- [ ] **Step 8: 类型检查**

```bash
cd apps/server && npx tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 9: 提交**

```bash
git add -A apps/server/src/services/OctopusBridge.ts apps/server/src/services/SkillTools.ts apps/server/src/services/HeartbeatForwarder.ts apps/server/src/services/__tests__/HeartbeatForwarder.test.ts apps/server/src/index.ts
git commit -m "chore: remove dead code (OctopusBridge, SkillTools, HeartbeatForwarder)"
```

---

### Task 2: 删除前端死代码

**Files:**
- Delete: `apps/console/src/pages/McpPage.tsx`
- Delete: `apps/console/src/pages/SkillsPage.tsx`

- [ ] **Step 1: 确认前端无路由引用**

```bash
grep -rn 'McpPage\|SkillsPage' apps/console/src/ --include='*.tsx' --include='*.ts' | grep -v 'McpPage.tsx\|SkillsPage.tsx'
```
Expected: 无结果（已被 McpSettingsPage / SkillsSettingsPage 替代）。

- [ ] **Step 2: 删除文件**

```bash
rm apps/console/src/pages/McpPage.tsx
rm apps/console/src/pages/SkillsPage.tsx
```

- [ ] **Step 3: 前端类型检查**

```bash
cd apps/console && npx tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add -A apps/console/src/pages/McpPage.tsx apps/console/src/pages/SkillsPage.tsx
git commit -m "chore: remove unused McpPage and SkillsPage (replaced by *SettingsPage)"
```

---

### Task 3: HMAC 默认密钥启动警告

**Files:**
- Modify: `plugins/audit/src/file-writer.ts:7`

- [ ] **Step 1: 读取当前 HMAC key 定义**

确认 `plugins/audit/src/file-writer.ts` 第 7 行：
```typescript
const AUDIT_HMAC_KEY = process.env.AUDIT_HMAC_KEY || 'default-audit-key-change-me';
```

- [ ] **Step 2: 添加启动警告**

在第 7 行后添加：
```typescript
if (AUDIT_HMAC_KEY === 'default-audit-key-change-me') {
  console.warn('[WARN] AUDIT_HMAC_KEY is using default value, audit signature chain is NOT secure. Set AUDIT_HMAC_KEY env var.');
}
```

- [ ] **Step 3: 提交**

```bash
git add plugins/audit/src/file-writer.ts
git commit -m "security: warn on default HMAC key at startup"
```

---

### Task 4: 恢复 skills.load.extraDirs + sandbox 配置 + 配置完整性校验

**Files:**
- Modify: `.octopus-state/octopus.json`
- Modify: `start.sh:177` (备份后插入校验)

- [ ] **Step 1: 确认当前配置缺失**

```bash
grep -c 'extraDirs\|exec.*sandbox\|sandbox.*mode' .octopus-state/octopus.json
```
Expected: 0（确认缺失）。

- [ ] **Step 2: 备份当前配置**

```bash
cp .octopus-state/octopus.json .octopus-state/octopus.json.pre-phase1
```

- [ ] **Step 3: 添加 skills.load.extraDirs 和 sandbox 配置**

使用 EngineAdapter 的 `configGetParsed()` + `configApply()` 或直接编辑 JSON，添加：
```json
{
  "skills": {
    "load": {
      "extraDirs": ["/home/baizh/octopus/data/skills"]
    }
  },
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

注意：必须与已有配置合并，不能覆盖。用 `json5` 库解析后 deep merge 再写回。

- [ ] **Step 4: Docker 前置验证**

```bash
docker images octopus-sandbox:enterprise --format '{{.Repository}}:{{.Tag}}'
docker network inspect octopus-internal --format '{{.Name}}' 2>/dev/null
docker run --rm --network octopus-internal octopus-sandbox:enterprise whoami
```
Expected: 镜像存在、网络就绪、输出 `sandbox`。如失败先运行 `docker/sandbox/build.sh` 和 `docker/sandbox/setup-network.sh`。

- [ ] **Step 5: 在 start.sh 中添加配置完整性校验**

在 `start.sh` 第 177 行（备份完成后）插入：

```bash
  # ─── 配置完整性校验（防止 vitest 覆盖丢失关键字段） ──────────────
  if [ -f "$CONFIG_FILE" ]; then
    local missing_fields=""
    grep -q '"host".*"sandbox"' "$CONFIG_FILE" || missing_fields="${missing_fields} tools.exec.host"
    grep -q '"extraDirs"' "$CONFIG_FILE" || missing_fields="${missing_fields} skills.load.extraDirs"
    grep -q '"mode".*"all"' "$CONFIG_FILE" || missing_fields="${missing_fields} agents.defaults.sandbox.mode"
    if [ -n "$missing_fields" ]; then
      echo -e "  ${RED}⚠ octopus.json 缺少关键配置:${missing_fields}${NC}"
      echo -e "  ${RED}  请检查 config-backups/ 并恢复配置${NC}"
    fi
  fi
```

- [ ] **Step 6: 提交**

```bash
git add .octopus-state/octopus.json start.sh
git commit -m "security: restore sandbox + skills config, add config integrity check"
```

---

### Task 5: 企业 MCP 环境变量泄露修复

**Files:**
- Modify: `plugins/mcp/src/executor.ts:147-150`

- [ ] **Step 1: 读取当前 env 传递代码**

确认 `plugins/mcp/src/executor.ts` 第 145-150 行：
```typescript
    } else {
      // 企业 MCP: 宿主机直接执行（管理员配置的受信基础设施）
      child = spawn(cfg.command!, cfg.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...mergedEnv },
      });
    }
```

- [ ] **Step 2: 替换为过滤后的环境变量**

```typescript
    } else {
      // 企业 MCP: 宿主机直接执行（管理员配置的受信基础设施）
      // 安全：不继承完整 process.env，只传递必要变量 + 管理员显式配置的变量
      child = spawn(cfg.command!, cfg.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME || '/tmp',
          NODE_ENV: process.env.NODE_ENV,
          LANG: process.env.LANG,
          ...mergedEnv,
        },
      });
    }
```

- [ ] **Step 3: 提交**

```bash
git add plugins/mcp/src/executor.ts
git commit -m "security: filter env vars for enterprise MCP spawn"
```

---

### Task 6: 前端禁用空转功能

**Files:**
- Modify: `apps/console/src/pages/ChatPage.tsx` (导出按钮和搜索框)

- [ ] **Step 1: 找到导出和搜索 UI 元素**

```bash
grep -n 'export\|导出\|Export\|search\|搜索\|Search' apps/console/src/pages/ChatPage.tsx | head -20
```

- [ ] **Step 2: 导出按钮加 disabled + tooltip**

找到导出按钮（通常是菜单项或 Button），添加 `disabled` 属性和 tooltip "功能开发中"。

- [ ] **Step 3: 搜索输入框加 disabled + placeholder**

找到搜索输入框，添加 `disabled` 属性和 `placeholder="功能开发中"`。

- [ ] **Step 4: 前端类型检查**

```bash
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/console/src/pages/ChatPage.tsx
git commit -m "ui: disable non-functional export and search features"
```

---

## Chunk 2: chat.ts 快速修复

### Task 7: loadAgent 去重 + 标题生成去重 + sleep 替换

**Files:**
- Modify: `apps/server/src/routes/chat.ts:259,509,552,576,769,935`
- Modify: `apps/console/src/pages/ChatPage.tsx` (删除 generateTitle 调用)

- [ ] **Step 1: loadAgent 单次查询**

在 `POST /api/chat/stream` 路由入口处（斜杠命令检测之前），将 `loadAgent` 调用提前到入口，结果存为 `const agent`，传递给后续所有函数（附件处理、斜杠命令、主流程）。删除后续重复的 `loadAgent` 调用。

非流式路由 `POST /api/chat` 同理。

- [ ] **Step 2: 类型检查确认无错误**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 3: 删除前端 generateTitle 调用**

在 `ChatPage.tsx` 中找到 SSE 完成后调用 `adminApi.generateTitle()` 的代码（约第 342 和 684 行），删除这些调用。只保留后端 `done` 事件中的 `autoGenerateTitle`。

- [ ] **Step 4: 前端类型检查**

```bash
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 5: 替换 ensureNativeAgent 的 sleep(2000)**

在 `chat.ts` 的 `ensureNativeAgent` 函数中，找到 `await new Promise(r => setTimeout(r, 2000));`，替换为轮询就绪：

```typescript
// 替换 sleep(2000)
for (let i = 0; i < 5; i++) {
  const agents = await bridge.agentsList();
  if (agents.some((a: any) => a.id === nativeAgentId || a.name === nativeAgentId)) break;
  await new Promise(r => setTimeout(r, 500));
}
```

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/routes/chat.ts apps/console/src/pages/ChatPage.tsx
git commit -m "fix: deduplicate loadAgent calls, title generation, replace sleep with polling"
```

---

### Task 8: 附件处理提取 + sessionPrefs TTL + SSE 行缓冲区

**Files:**
- Modify: `apps/server/src/routes/chat.ts:35,498-543,817-860`
- Modify: `apps/console/src/pages/ChatPage.tsx` (SSE 解析)

- [ ] **Step 1: 提取 processAttachments 函数**

从 `POST /stream` 和 `POST /` 路由中提取附件处理代码为共享函数：

```typescript
async function processAttachments(
  attachments: Array<{ name: string; content: string; type: string }>,
  workspacePath: string
): Promise<{ savedPaths: string[]; message: string }> {
  // 提取自两处路由的公共逻辑
}
```

两处路由改为调用此函数。

- [ ] **Step 2: sessionPrefs 加 TTL**

在 `chat.ts` 第 35 行附近的 `sessionPrefs` Map 定义处，改为带 TTL 的实现：

```typescript
const sessionPrefs = new Map<string, { mcpId?: string; skillId?: string; updatedAt: number }>();

// 清理过期条目（30 分钟 TTL）
function cleanExpiredPrefs() {
  const now = Date.now();
  for (const [key, val] of sessionPrefs) {
    if (now - val.updatedAt > 30 * 60 * 1000) sessionPrefs.delete(key);
  }
}
setInterval(cleanExpiredPrefs, 5 * 60 * 1000);
```

所有 `sessionPrefs.set()` 调用处添加 `updatedAt: Date.now()`。

- [ ] **Step 3: SSE 解析加行缓冲区**

在 `ChatPage.tsx` 的 SSE 解析代码处（`reader.read()` 循环），添加 line buffer：

```typescript
let sseBuffer = '';

// 在读取循环内：
sseBuffer += new TextDecoder().decode(value);
const parts = sseBuffer.split('\n');
sseBuffer = parts.pop() || '';  // 最后一个不完整的片段留到下次

for (const line of parts) {
  if (line.startsWith('data: ')) {
    // 处理事件...
  }
}
```

- [ ] **Step 4: 双端类型检查**

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/routes/chat.ts apps/console/src/pages/ChatPage.tsx
git commit -m "fix: extract attachment processing, add sessionPrefs TTL, SSE line buffer"
```

---

## Chunk 3: agents.ts 快速修复 + 其他修复

### Task 9: agents.ts 四项修复

**Files:**
- Modify: `apps/server/src/routes/agents.ts` (DELETE 路由、ensureDefaultAgent、GET /config)
- Modify: `apps/console/src/pages/AgentsPage.tsx` (乐观更新)

- [ ] **Step 1: 删除 Agent 时清理 agents.list config entry**

在 `DELETE /api/agents/:id` 路由中，`bridge.agentsDelete()` 之后添加：

```typescript
// 清理 octopus.json 中 agents.list 的残留 entry
try {
  const config = await bridge.configGetParsed();
  const agentsList = config?.agents?.list || [];
  const filtered = agentsList.filter((a: any) => a.id !== nativeAgentId);
  if (filtered.length !== agentsList.length) {
    config.agents.list = filtered;
    await bridge.configApplyFull(config);
  }
} catch (e) {
  console.warn('Failed to clean agents.list config entry:', e);
}
```

- [ ] **Step 2: ensureDefaultAgent 只执行一次**

在 `agents.ts` 中添加内存标记：

```typescript
const defaultCheckedUsers = new Set<string>();

async function ensureDefaultAgent(userId: string, ...) {
  if (defaultCheckedUsers.has(userId)) return;
  defaultCheckedUsers.add(userId);
  // ... 原有逻辑
}
```

- [ ] **Step 3: GET /config 支持 ?file 参数**

在 `GET /api/agents/:id/config` 路由中：

```typescript
const requestedFile = req.query.file as string | undefined;
const filesToLoad = requestedFile
  ? AGENT_CONFIG_FILES.filter(f => f === requestedFile)
  : AGENT_CONFIG_FILES;
```

- [ ] **Step 4: 前端乐观更新**

在 `AgentsPage.tsx` 中，所有操作后不再调用 `loadData()`：

创建后：`setAgents(prev => [...prev, res.agent])`
编辑后：`setAgents(prev => prev.map(a => a.id === id ? res.agent : a))`
删除后：`setAgents(prev => prev.filter(a => a.id !== id))`
设默认后：`setAgents(prev => prev.map(a => ({ ...a, isDefault: a.id === id })))`

- [ ] **Step 5: 双端类型检查**

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/routes/agents.ts apps/console/src/pages/AgentsPage.tsx
git commit -m "fix: clean config on agent delete, optimize ensureDefaultAgent, on-demand SOUL.md loading, optimistic UI updates"
```

---

### Task 10: 其他快速修复（5 项）

**Files:**
- Modify: `packages/auth/src/AuthService.ts:377`
- Modify: `apps/server/src/routes/admin.ts:430-443`
- Modify: `plugins/mcp/src/index.ts:194,721`
- Modify: `apps/server/src/index.ts:104-128`

- [ ] **Step 1: refreshToken 改查 MySQL**

在 `packages/auth/src/AuthService.ts`，`refreshToken` 方法中（约第 377 行），当前：
```typescript
let user = await this.userStore.findById(payload.userId);
```

需要在 AuthService 构造函数中接受可选的 `prisma` 参数，或在调用层面注入 DB 查询。由于 auth 包不应直接依赖 prisma，更好的方式是在 `apps/server/src/routes/auth.ts` 的 `/refresh` 路由中，refresh 成功后用 prisma 补查 DB 验证用户状态：

```typescript
// auth.ts refresh 路由中，refreshToken 成功后：
const dbUser = await prismaClient.user.findUnique({ where: { id: refreshed.user.id } });
if (!dbUser || dbUser.status !== 'active') {
  return res.status(401).json({ error: 'User disabled' });
}
```

- [ ] **Step 2: Dashboard dailyTrend 改 GROUP BY**

在 `apps/server/src/routes/admin.ts` 第 430-443 行，将 7 次串行 COUNT 改为：

```typescript
const dailyTrend = await prismaClient.$queryRaw<Array<{ date: string; count: bigint }>>`
  SELECT DATE(createdAt) as date, COUNT(*) as count
  FROM AuditLog
  WHERE createdAt >= ${sevenDaysAgo}
  GROUP BY DATE(createdAt)
  ORDER BY date ASC
`;
```

- [ ] **Step 3: MCP 信号文件路径统一**

在 `plugins/mcp/src/index.ts` 第 721 行附近，将：
```typescript
const REFRESH_SIGNAL_PATH = path.join(__dirname, '..', '..', '..', '.octopus-state', 'mcp-refresh-signal');
```
改为：
```typescript
const REFRESH_SIGNAL_PATH = path.join(
  process.env.OCTOPUS_STATE_DIR || path.join(__dirname, '..', '..', '..', '.octopus-state'),
  'mcp-refresh-signal'
);
```

- [ ] **Step 4: tools-cache.json 位置迁移**

在 `plugins/mcp/src/index.ts` 第 194 行，将：
```typescript
const TOOLS_CACHE_PATH = path.join(__dirname, '..', 'tools-cache.json');
```
改为：
```typescript
const TOOLS_CACHE_PATH = path.join(
  process.env.OCTOPUS_STATE_DIR || path.join(__dirname, '..', '..', '..', '.octopus-state'),
  'tools-cache.json'
);
```

- [ ] **Step 5: 密码迁移逻辑优化**

在 `apps/server/src/index.ts` 第 104-128 行的密码迁移逻辑外层，添加执行一次标记：

```typescript
let passwordMigrationDone = false;

// 在 startServer 中：
if (!passwordMigrationDone && prismaClient) {
  passwordMigrationDone = true;
  // ... 原有迁移逻辑
}
```

- [ ] **Step 6: 类型检查**

```bash
cd apps/server && npx tsc --noEmit
cd packages/auth && npx tsc --noEmit
```

- [ ] **Step 7: 提交**

```bash
git add packages/auth/src/AuthService.ts apps/server/src/routes/auth.ts apps/server/src/routes/admin.ts plugins/mcp/src/index.ts apps/server/src/index.ts
git commit -m "fix: refreshToken DB fallback, dashboard GROUP BY, MCP paths, password migration optimization"
```

---

## Chunk 4: 阶段 1 最终验证

### Task 11: 全面验证

- [ ] **Step 1: 后端类型检查**

```bash
cd apps/server && npx tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 2: 前端类型检查**

```bash
cd apps/console && npx tsc --noEmit
```
Expected: 无错误。

- [ ] **Step 3: 单元测试**

```bash
npx vitest run 2>&1 | tail -20
```
Expected: 无新增失败。

- [ ] **Step 4: 死代码验证**

```bash
grep -r 'OctopusBridge\|SkillTools\|HeartbeatForwarder' apps/server/src/ --include='*.ts' | grep -v node_modules
grep -r 'McpPage\|SkillsPage' apps/console/src/ --include='*.tsx' --include='*.ts' | grep -v node_modules
```
Expected: 均无结果。

- [ ] **Step 5: 配置验证**

```bash
grep -q 'extraDirs' .octopus-state/octopus.json && echo "skills OK" || echo "skills MISSING"
grep -q '"host"' .octopus-state/octopus.json && echo "sandbox OK" || echo "sandbox MISSING"
```
Expected: 两个 OK。

- [ ] **Step 6: 重启服务并验证功能**

```bash
./start.sh restart
```

验证清单：
- 发消息确认对话正常
- 确认后端日志无 `label already in use` 冲突
- 创建/编辑/删除 Agent 确认前端列表正确更新
- 查看 Dashboard 确认数据正常
- 重启后刷新页面确认不需要重新登录（refresh token 有效）
- 检查启动日志中 HMAC 默认密钥警告（如未设环境变量）
- 检查启动日志中配置完整性校验结果

- [ ] **Step 7: 更新 CLAUDE.md**

在 CLAUDE.md 的 Refactor History 中添加记录：

```markdown
### 阶段 1 整改 — 清理 + 安全 + 快速修复 (2026-03-17) ✅
- 删除死代码约 1800 行（OctopusBridge、SkillTools、HeartbeatForwarder、McpPage、SkillsPage）
- 恢复 sandbox + skills.load.extraDirs 配置（vitest 覆盖丢失）
- 企业 MCP spawn 环境变量过滤（不再继承完整 process.env）
- HMAC 默认密钥启动警告
- start.sh 配置完整性校验
- chat.ts: loadAgent 去重（3→1）、标题生成去重、sleep→轮询、附件函数提取、sessionPrefs TTL、SSE 行缓冲区
- agents.ts: 删除时清理 config entry、ensureDefaultAgent 只查一次、SOUL.md 按需加载、前端乐观更新
- refreshToken DB fallback、Dashboard GROUP BY、MCP 路径统一、密码迁移优化、tools-cache.json 位置迁移
```

- [ ] **Step 8: 最终提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with phase 1 rectification record"
```
