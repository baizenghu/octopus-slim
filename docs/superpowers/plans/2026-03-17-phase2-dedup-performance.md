# 阶段 2：消除重复代码 + 性能优化 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 降低维护成本，消除 ~800 行重复代码，chat.ts 从 1460 行瘦身至 ~600 行，解决启动串行和委派轮询性能瓶颈。

**Architecture:** 纯重构 + 性能优化，不改变外部 API 接口。chat.ts 拆分为 4 个模块，enterprise-mcp 4 个 execute 函数提取工厂，agents.ts 3 处 config RMW 合并为 1 个函数。中文 agentName 用 hash 后缀解决冲突。

**Tech Stack:** TypeScript, Express, React, Prisma, OpenClaw 原生引擎 RPC

**Spec:** `docs/superpowers/specs/2026-03-17-system-rectification-plan.md` 阶段 2

---

## 文件结构规划

### 新建文件

| 文件 | 职责 |
|------|------|
| `apps/server/src/utils/ContentSanitizer.ts` | 统一内容净化（正则集中管理，替代 4 处分散的净化逻辑） |
| `apps/server/src/routes/sessions.ts` | 会话管理路由（列表/历史/删除/重命名/导出/搜索/用量/压缩/中止） |
| `apps/server/src/services/SystemPromptBuilder.ts` | 企业级系统提示构建（含缓存） |
| `apps/server/src/services/ChatUtils.ts` | 斜杠命令处理 + session 偏好 + 标题生成 + session key 解析 |
| `apps/server/src/services/AgentConfigSync.ts` | 统一 agent 原生配置同步（合并 syncAllowAgents + syncAgentNativeConfig + ensureNativeAgent） |
| `apps/console/src/components/PersonalMcpManager.tsx` | 个人 MCP CRUD 共享组件 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `apps/server/src/routes/chat.ts` | 从 ~1460 行瘦身至 ~600 行，只保留流式/非流式对话入口 |
| `apps/server/src/routes/agents.ts` | 替换 syncAllowAgents + syncAgentNativeConfig → AgentConfigSync |
| `apps/server/src/services/EngineAdapter.ts` | userAgentId() 中文字符用 hash 后缀 |
| `apps/server/src/index.ts` | 启动时并发同步 + 完整配置恢复 |
| `plugins/mcp/src/index.ts` | 4 个 execute 函数提取工厂 + 合并缓存查询 |
| `apps/console/src/pages/ChatPage.tsx` | 委派轮询优化（轻量检查替代全量拉取） |
| `apps/console/src/pages/McpSettingsPage.tsx` | 引用 PersonalMcpManager 组件 |
| `apps/console/src/pages/PersonalSettingsPage.tsx` | 引用 PersonalMcpManager 组件 |

---

## Chunk 1: 基础设施（无外部依赖，并行安全）

### Task 1: 内容净化统一 (spec 2.2)

**背景:** 内容净化正则分散在 4 处：chat.ts 的 /history 路由(1129-1142)、autoGenerateTitle(1281-1289)、前端 ChatPage.tsx(88-103)、非流式路由的 purified(928-932)。正则各自维护，不同步。

**Files:**
- Create: `apps/server/src/utils/ContentSanitizer.ts`
- Modify: `apps/server/src/routes/chat.ts` (4 处净化逻辑替换)

- [ ] **Step 1: 创建 ContentSanitizer.ts**

```typescript
// apps/server/src/utils/ContentSanitizer.ts

/** 集中管理所有内容净化正则，确保后端各处一致 */

const MEMORY_TAG_RE = /<relevant-memories>[\s\S]*?<\/relevant-memories>/g;
const UNTRUSTED_DATA_RE = /\[UNTRUSTED DATA[\s\S]*?\[END UNTRUSTED DATA\]/g;
const TIMESTAMP_PREFIX_RE = /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s\d{4}-\d{2}-\d{2}[^\]]*\]\s*/m;
const SKILL_INJECT_RE = /^\[请(?:使用|严格按照|优先使用)\s+[^\]]*(?:\]|\S*…)\s*/m;
const LESSON_PREFIX_RE = /^\/lesson\s+/m;
const ATTACHMENT_PREFIX_RE = /^\[用户上传了 \d+ 个文件，已保存到工作空间\]\n(?:- .+\n?)+\n?/m;
const REMINDER_TAG_RE = /<enterprise-reminder[^>]*\/?>(<\/enterprise-reminder>)?/g;
const RUNTIME_CONTEXT_RE = /Octopus runtime context/;
const INTERNAL_EVENT_RE = /\[Internal task completion event\]/;
const THINK_TAG_RE = /<think>([\s\S]*?)<\/think>/;

/** 净化用户消息（history 和 title 共用） */
export function sanitizeUserContent(content: string): string {
  return content
    .replace(MEMORY_TAG_RE, '')
    .replace(UNTRUSTED_DATA_RE, '')
    .replace(TIMESTAMP_PREFIX_RE, '')
    .replace(SKILL_INJECT_RE, '')
    .replace(LESSON_PREFIX_RE, '')
    .replace(ATTACHMENT_PREFIX_RE, '')
    .trim();
}

/** 净化助手消息 */
export function sanitizeAssistantContent(content: string): { content: string; thinking?: string } {
  let cleaned = content.replace(REMINDER_TAG_RE, '').trim();
  const thinkMatch = cleaned.match(THINK_TAG_RE);
  let thinking: string | undefined;
  if (thinkMatch) {
    thinking = thinkMatch[1].trim();
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>\s*/, '').replace(/<\/?final>/g, '').trim();
  }
  return { content: cleaned, thinking };
}

/** 检测应完全隐藏的内部消息 */
export function isInternalMessage(content: string): boolean {
  return RUNTIME_CONTEXT_RE.test(content) || INTERNAL_EVENT_RE.test(content);
}
```

- [ ] **Step 2: 在 chat.ts 的 /history 路由中引用 ContentSanitizer**

替换 chat.ts 第 1129-1158 行的内联净化逻辑：
```typescript
import { sanitizeUserContent, sanitizeAssistantContent, isInternalMessage } from '../utils/ContentSanitizer';
```
调用 `isInternalMessage(content)` 替代内联 includes 检测，`sanitizeUserContent(content)` 替代 6 行 replace 链，`sanitizeAssistantContent(content)` 替代助手净化逻辑。

- [ ] **Step 3: 在 autoGenerateTitle 中引用 ContentSanitizer**

替换 chat.ts 第 1281-1289 行的净化逻辑为 `sanitizeUserContent(content)`。

- [ ] **Step 4: 在非流式路由的 purified 变量中引用 ContentSanitizer**

替换非流式路由 `POST /` 中 `fullContent` 的净化逻辑（`const purified = fullContent.replace(...)` 附近）为 `sanitizeUserContent(fullContent)` + `sanitizeAssistantContent()` 的组合。（行号因阶段 1 修改已偏移，以 `purified` 变量名搜索定位。）

- [ ] **Step 5: 类型检查**

```bash
cd apps/server && npx tsc --noEmit
```
Expected: 无新增错误。

- [ ] **Step 6: 提交**

```bash
git add apps/server/src/utils/ContentSanitizer.ts apps/server/src/routes/chat.ts
git commit -m "refactor: unify content sanitization into ContentSanitizer"
```

---

### Task 2: 中文 agentName 冲突修复 (spec 2.5)

**背景:** `userAgentId()` 将非 ASCII 字符替换为 `_`，中文 agent 名如"财务助手"和"营销策略"都变成 `ent_user_____`，产生 ID 碰撞。当前 octopus.json 中已有冲突实例。

**Files:**
- Modify: `apps/server/src/services/EngineAdapter.ts:475-477`
- Modify: `.octopus-state/octopus.json` (修复已存在的冲突 ID)

- [ ] **Step 1: 修改 userAgentId 使用 hash 后缀**

在 `EngineAdapter.ts` 中修改 `userAgentId()`:

```typescript
import { createHash } from 'crypto';

static userAgentId(userId: string, agentName: string): string {
  const raw = `ent_${userId}_${agentName}`.toLowerCase();
  const ascii = raw.replace(/[^a-z0-9_-]/g, '');
  // 如果替换后丢失了字符（含非 ASCII），加 hash 后缀保证唯一性
  if (ascii.length < raw.length) {
    const hash = createHash('md5').update(raw).digest('hex').slice(0, 8);
    return `ent_${userId}_${hash}`;
  }
  return ascii;
}
```

- [ ] **Step 2: 确认 userSessionKey 和 parseSessionKeyUserId 不受影响**

这两个函数依赖 `ent_` 前缀格式，hash 后缀不改变前缀结构。`grep` 确认无其他依赖 agentName 拼接规则的代码。

- [ ] **Step 3: 修复 octopus.json 中已有的冲突 ID**

读取当前 octopus.json，找到 `ent_user-admin_____` 条目，用新的 hash 函数重新计算正确 ID 并更新。同时更新对应的 agentDir 路径。

**注意：** 需要同时迁移以下关联数据：
- `.octopus-state/agents/` 下的目录重命名
- `octopus.json` 中 `agents.list` 的 ID 和 agentDir 更新
- 引擎中的 session keys（旧 ID 格式的 session 会成为孤立数据，但不影响新会话）
- memory-lancedb-pro 的 agentAccess 配置（如果有配置的话）
- cron jobs 引用的 agentId

**迁移策略：** 由于当前只有 1 个受影响的中文 agent（`财务助手` → `ent_user-admin_____`），手动迁移即可。如果用户有重要的旧 session 历史，提前告知会话数据不会自动迁移。

- [ ] **Step 4: 类型检查**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/services/EngineAdapter.ts
git commit -m "fix: use hash suffix for non-ASCII agentName to prevent ID collision"
```

---

### Task 3: Agent config 写入合并 (spec 2.4)

**背景:** agents.ts 中 3 处 read-modify-write 模式（syncAllowAgents:52-114, syncAgentNativeConfig:121-178, 删除 agent 的 config 清理:648-662）各自独立做 configGetParsed → modify → configApplyFull，共 6 次 RPC，且并发有 hash 冲突风险。

**Files:**
- Create: `apps/server/src/services/AgentConfigSync.ts`
- Modify: `apps/server/src/routes/agents.ts`

- [ ] **Step 1: 创建 AgentConfigSync.ts**

```typescript
// apps/server/src/services/AgentConfigSync.ts
import type { EngineAdapter } from './EngineAdapter';

// 引擎 tools.allow 映射：企业语义名 → 引擎原生名
const TOOL_NAME_TO_ENGINE: Record<string, string> = {
  list_files: 'read', read_file: 'read',
  write_file: 'write',
  execute_command: 'exec', search_files: 'exec',
};

/**
 * 统一 agent 原生配置同步。
 * 合并 syncAllowAgents + syncAgentNativeConfig + 删除清理，
 * 只做 1 次 config read + 1 次 config write。
 */
export async function syncAgentToEngine(
  bridge: EngineAdapter,
  userId: string,
  opts: {
    agentName?: string;
    model?: string;
    toolsFilter?: string[];
    enabledAgentNames?: string[];  // 当前用户所有启用的 agent 名（用于 allowAgents）
    deleteAgentName?: string;      // 要删除的 agent 名
  },
): Promise<void> {
  if (!bridge.isConnected) return;
  const { config } = await bridge.configGetParsed() as any;
  const agentsList: any[] = config?.agents?.list || [];
  let changed = false;

  const { EngineAdapter: EA } = await import('./EngineAdapter');

  // 1. 删除 agent entry
  if (opts.deleteAgentName) {
    const deleteId = EA.userAgentId(userId, opts.deleteAgentName);
    const before = agentsList.length;
    config.agents.list = agentsList.filter((a: any) => a.id !== deleteId);
    if (config.agents.list.length !== before) changed = true;
  }

  // 2. 更新 model + tools.allow
  if (opts.agentName && (opts.model !== undefined || opts.toolsFilter !== undefined)) {
    const targetId = EA.userAgentId(userId, opts.agentName);
    const entry = config.agents.list.find((a: any) => a.id === targetId);
    if (entry) {
      if (opts.model !== undefined) {
        const old = entry.model;
        entry.model = opts.model || undefined;
        if (JSON.stringify(old) !== JSON.stringify(entry.model)) changed = true;
      }
      if (opts.toolsFilter !== undefined) {
        const engineNames = [...new Set(
          opts.toolsFilter.map(t => TOOL_NAME_TO_ENGINE[t] || t)
        )];
        const newAllow = [...engineNames, 'group:plugins', 'memory_search', 'memory_get',
          'sessions_list', 'sessions_history', 'sessions_send', 'sessions_spawn',
          'agents_list', 'cron', 'image'];
        const old = JSON.stringify(entry.tools?.allow);
        entry.tools = { ...entry.tools, allow: newAllow };
        if (old !== JSON.stringify(newAllow)) changed = true;
      }
    }
  }

  // 3. 更新 allowAgents（default agent 可 spawn 专业 agent，反之可回调 default）
  if (opts.enabledAgentNames) {
    const defaultId = EA.userAgentId(userId, 'default');
    const specialistIds = opts.enabledAgentNames
      .filter(n => n !== 'default')
      .map(n => EA.userAgentId(userId, n));

    for (const entry of config.agents.list) {
      if (entry.id === defaultId) {
        const newAllow = specialistIds;
        const old = JSON.stringify(entry.subagents?.allowAgents);
        if (old !== JSON.stringify(newAllow)) {
          entry.subagents = { ...entry.subagents, allowAgents: newAllow };
          changed = true;
        }
      } else if (specialistIds.some(id => id === entry.id)) {
        // 专业 agent 不可 spawn 子 agent（与现有行为一致）
        const newAllow: string[] = [];
        const old = JSON.stringify(entry.subagents?.allowAgents);
        if (old !== JSON.stringify(newAllow)) {
          entry.subagents = { ...entry.subagents, allowAgents: newAllow };
          changed = true;
        }
      }
    }
  }

  if (changed) {
    await bridge.configApplyFull(config);
  }
}
```

- [ ] **Step 2: 替换 agents.ts 中的 syncAllowAgents**

删除 `syncAllowAgents` 函数（52-114 行），调用处改为 `syncAgentToEngine(bridge, userId, { enabledAgentNames })`.

- [ ] **Step 3: 替换 agents.ts 中的 syncAgentNativeConfig**

删除 `syncAgentNativeConfig` 函数（121-178 行），调用处改为 `syncAgentToEngine(bridge, userId, { agentName, model, toolsFilter })`.

- [ ] **Step 4: 替换删除 agent 时的 config 清理**

删除 agents.ts 第 648-662 行的内联 config RMW，改为 `syncAgentToEngine(bridge, userId, { deleteAgentName: existing.name, enabledAgentNames })`.

- [ ] **Step 5: 合并创建/编辑 agent 的调用**

在 POST 和 PUT 路由中，将之前分开的 `syncAgentNativeConfig` + `syncAllowAgents` 合并为单次 `syncAgentToEngine` 调用。

- [ ] **Step 6: 合并 ensureNativeAgent 和 syncToNative 的重叠逻辑**

在 `AgentConfigSync.ts` 中新增 `ensureAndSyncNativeAgent()` 函数，合并 chat.ts 的 `ensureNativeAgent`（agent 创建 + 文件写入 + 轮询就绪）和 agents.ts 的 `syncToNative`（同样做 agent 创建 + 文件写入）为单一入口：

```typescript
export async function ensureAndSyncNativeAgent(
  bridge: EngineAdapter, userId: string, agentName: string,
  workspaceManager: WorkspaceManager, dataRoot: string,
  opts?: { model?: string; toolsFilter?: string[]; enabledAgentNames?: string[] },
): Promise<void> {
  const nativeAgentId = EngineAdapter.userAgentId(userId, agentName);
  if (knownNativeAgents.has(nativeAgentId)) {
    // 已存在，仅同步配置（不重新创建）
    if (opts) await syncAgentToEngine(bridge, userId, { agentName, ...opts });
    return;
  }
  // ... 创建 agent + 轮询就绪 + 写入 SOUL.md/MEMORY.md + 同步 config
}
```

chat.ts 的 `ensureNativeAgent` 和 agents.ts 的 `syncToNative` 均改为调用此函数。

- [ ] **Step 7: 类型检查**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 8: 提交**

```bash
git add apps/server/src/services/AgentConfigSync.ts apps/server/src/routes/agents.ts apps/server/src/routes/chat.ts
git commit -m "refactor: merge 3 config RMW patterns + ensureNativeAgent/syncToNative into AgentConfigSync"
```

---

## Chunk 2: chat.ts 瘦身拆分 (spec 2.1 + 2.1.1)

**依赖:** Task 1 (ContentSanitizer)

### Task 4: 提取 ChatUtils.ts（斜杠命令 + 偏好 + 标题 + session key 解析）

**Files:**
- Create: `apps/server/src/services/ChatUtils.ts`
- Modify: `apps/server/src/routes/chat.ts`

- [ ] **Step 1: 创建 ChatUtils.ts**

提取以下函数和状态：
- `sessionPrefs` Map + TTL 清理逻辑（chat.ts:35-43）
- `handleSlashCommand()` 函数（chat.ts:76-193）
- `autoGenerateTitle()` 函数（chat.ts:1251-1324）
- session key 短ID→完整key 的解析辅助函数（当前 6 处重复的 `if (!sessionId.startsWith('agent:'))` 逻辑）

导出接口：
```typescript
export { handleSlashCommand, autoGenerateTitle, resolveSessionKey, getSessionPref, setSessionPref };
```

- [ ] **Step 2: 在 chat.ts 中替换为 import**

移除提取的函数定义，改为 `import { ... } from '../services/ChatUtils'`。

- [ ] **Step 3: 在 sessions 路由中使用 resolveSessionKey**

6 处短ID转换逻辑替换为 `resolveSessionKey(userId, reqAgentId, rawSessionId, loadAgent, bridge)`.

- [ ] **Step 4: 类型检查 + 提交**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/services/ChatUtils.ts apps/server/src/routes/chat.ts
git commit -m "refactor: extract ChatUtils (slash commands, title gen, session key resolver)"
```

---

### Task 5: 提取 sessions.ts（会话管理路由）

**Files:**
- Create: `apps/server/src/routes/sessions.ts`
- Modify: `apps/server/src/routes/chat.ts`
- Modify: `apps/server/src/index.ts` (挂载新路由)

- [ ] **Step 1: 创建 sessions.ts**

从 chat.ts 提取以下路由：
- `GET /sessions` (chat.ts:1019-1089)
- `GET /history/:sessionId` (chat.ts:1094-1188)
- `DELETE /history/:sessionId` (chat.ts:1193-1218)
- `PUT /sessions/:sessionId/title` (chat.ts:1223-1246)
- `POST /sessions/:sessionId/generate-title` (chat.ts:1329-1349)
- `GET /sessions/:sessionId/usage` (chat.ts:1354-1371)
- `POST /sessions/:sessionId/compact` (chat.ts:1376-1393)
- `POST /sessions/:sessionId/abort` (chat.ts:1398-1424)
- `GET /tools` (chat.ts:1429-1443)
- `GET /search` (chat.ts:1448-1450)
- `GET /export/:sessionId` (chat.ts:1455-1457)

函数签名与 chat.ts 的 `createChatRouter` 保持一致，导出 `createSessionsRouter()`。

- [ ] **Step 2: 在 index.ts 中挂载 sessions 路由**

```typescript
import { createSessionsRouter } from './routes/sessions';
// 挂载到 /api/chat 下（与现有路径保持兼容）
app.use('/api/chat', createSessionsRouter(...));
```

- [ ] **Step 3: 从 chat.ts 中删除已提取的路由**

- [ ] **Step 4: 类型检查 + 提交**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/routes/sessions.ts apps/server/src/routes/chat.ts apps/server/src/index.ts
git commit -m "refactor: extract session management routes to sessions.ts"
```

---

### Task 6: 提取 SystemPromptBuilder + 消除双重注入 (spec 2.1 + 2.1.1)

**背景:** `buildEnterpriseSystemPrompt()` 约 160 行，其中 `buildMCPToolsSection()` 生成的 MCP 工具说明与 TOOLS.md 中的内容重复（双重注入浪费 context token）。

**Files:**
- Create: `apps/server/src/services/SystemPromptBuilder.ts`
- Modify: `apps/server/src/routes/chat.ts`

- [ ] **Step 1: 创建 SystemPromptBuilder.ts**

提取以下函数：
- `buildEnterpriseSystemPrompt()` (chat.ts:386-542)
- `buildMCPToolsSection()` (chat.ts:315-383) — 标记为 deprecated，后续删除

添加 `(userId, agentId)` 维度缓存，TTL 5 分钟：
```typescript
const promptCache = new Map<string, { prompt: string; ts: number }>();
const PROMPT_CACHE_TTL = 5 * 60 * 1000;

export async function buildEnterpriseSystemPrompt(...): Promise<string> {
  const cacheKey = `${user.id}:${agent?.id || 'default'}`;
  const cached = promptCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < PROMPT_CACHE_TTL) return cached.prompt;
  // ... 原有逻辑
  promptCache.set(cacheKey, { prompt: result, ts: Date.now() });
  return result;
}

export function invalidatePromptCache(userId: string, agentId?: string) {
  // agent 配置变更时调用
  for (const [key] of promptCache) {
    if (key.startsWith(userId)) promptCache.delete(key);
  }
}
```

- [ ] **Step 2: 消除 MCP 双重注入**

在 `buildEnterpriseSystemPrompt` 中，删除对 `buildMCPToolsSection()` 的调用（chat.ts:474-475 行）。MCP 工具说明已由 TOOLS.md + 引擎 tool catalog 承载，无需在 extraSystemPrompt 中重复注入。

保留 `extraSystemPrompt` 中的动态内容：用户名、workspace 路径、安全约束、可委派 agent 列表、数据库连接环境变量。

- [ ] **Step 2.5: 将静态系统提示内容迁移到 SOUL.md 模板**

`buildEnterpriseSystemPrompt` 中的通用约束和操作规范（如"禁止自行编写替代代码"、"调用上述工具时请直接传入参数"等静态文本）从 extraSystemPrompt 移入 `SoulTemplate.ts` 的 SOUL.md 模板中。这些内容只在 agent 创建/更新时同步，不需要每次对话都动态注入。

修改 `apps/server/src/services/SoulTemplate.ts` 的 `getSoulTemplate()` 函数，将静态约束追加到 SOUL.md 模板末尾。

- [ ] **Step 3: 在 chat.ts 中替换为 import**

- [ ] **Step 4: 在 agents.ts 中调用 invalidatePromptCache**

在 PUT /agents/:id 路由成功后调用 `invalidatePromptCache(user.id)`.

- [ ] **Step 5: 类型检查 + 提交**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/services/SystemPromptBuilder.ts apps/server/src/routes/chat.ts apps/server/src/routes/agents.ts
git commit -m "refactor: extract SystemPromptBuilder, add cache, remove MCP double injection"
```

- [ ] **Step 6: 确认 chat.ts 行数**

```bash
wc -l apps/server/src/routes/chat.ts
```
Expected: ~500-600 行（只剩流式/非流式对话入口 + SSE 事件处理 + models 路由）。

---

## Chunk 3: 插件 + 前端重复代码消除（并行安全）

### Task 7: enterprise-mcp 插件去重 (spec 2.3)

**背景:** 1587 行，7 个 execute 函数中 4 个共享 90% 代码（企业 MCP 直连/缓存版、个人 MCP 直连/缓存版）。getMcpFilter 和 getAllowedConnections 缓存模式完全重复。熔断逻辑重复 4 处。

**Files:**
- Modify: `plugins/mcp/src/index.ts`

- [ ] **Step 1: 合并 getMcpFilter 和 getAllowedConnections 为通用缓存函数**

```typescript
type AgentFilterField = 'mcpFilter' | 'allowedConnections';
const _filterCache = new Map<string, { data: string[] | null; ts: number }>();
const FILTER_CACHE_TTL = 60_000;

async function getAgentFilter(
  field: AgentFilterField, userId: string, agentName: string,
): Promise<string[] | null> {
  const key = `${field}:${userId}:${agentName}`;
  const cached = _filterCache.get(key);
  if (cached && Date.now() - cached.ts < FILTER_CACHE_TTL) return cached.data;
  // DB 查询逻辑（合并两个函数的实现）
  const agent = await _prisma!.agent.findFirst({ where: { ownerId: userId, name: agentName, enabled: true } });
  const data = agent ? (agent[field] as string[] | null) : null;
  _filterCache.set(key, { data, ts: Date.now() });
  return data;
}
```

删除原有的 `getMcpFilter()` 和 `getAllowedConnections()` 及其各自的缓存 Map。

- [ ] **Step 2: 提取熔断检查为共享函数**

```typescript
function checkCircuitBreaker(agentId: string, toolName: string): string | null {
  const failKey = `${agentId}:${toolName}`;
  const failure = toolFailureCounter.get(failKey);
  if (failure && failure.count >= TOOL_MAX_CONSECUTIVE_FAILURES) {
    if (Date.now() - failure.lastFailedAt < TOOL_FAILURE_RESET_MS) {
      return `该工具已连续失败 ${failure.count} 次，已临时熔断。请稍后再试或使用其他方式完成任务。`;
    }
    toolFailureCounter.delete(failKey);
  }
  return null;
}

function recordToolFailure(agentId: string, toolName: string) {
  const failKey = `${agentId}:${toolName}`;
  const f = toolFailureCounter.get(failKey) || { count: 0, lastFailedAt: 0 };
  f.count++;
  f.lastFailedAt = Date.now();
  toolFailureCounter.set(failKey, f);
}
```

- [ ] **Step 3: 提取 MCP 工具执行工厂函数**

```typescript
function createMCPToolExecutor(opts: {
  scope: 'enterprise' | 'personal';
  waitForReady: boolean;  // 缓存版需等待 executor ready
}): (toolCallId: string, params: any) => Promise<string> {
  return async (_toolCallId, params) => {
    const { agentId } = params;
    const userId = extractUserIdFromAgentId(agentId);
    const agentName = extractAgentNameFromAgentId(agentId);

    // 熔断检查
    const blocked = checkCircuitBreaker(agentId, tool.name);
    if (blocked) return blocked;

    // 企业 MCP: mcpFilter + allowedConnections 校验
    if (opts.scope === 'enterprise') {
      const mcpFilter = await getAgentFilter('mcpFilter', userId!, agentName!);
      if (!mcpFilter?.includes(serverId)) return '当前 Agent 不允许使用此 MCP 工具';
      // allowedConnections 校验...
    }

    // 等待 executor（缓存版）
    let exec = executor;
    if (opts.waitForReady && !exec) {
      // 等待逻辑...
    }

    try {
      const result = await exec!.callTool(toolName, params);
      // list_connections 过滤...
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (err: any) {
      recordToolFailure(agentId, tool.name);
      return `MCP 工具调用失败: ${err.message}`;
    }
  };
}
```

将 4 个 execute 函数替换为工厂调用。

- [ ] **Step 4: 类型检查**

```bash
cd plugins/mcp && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: 提交**

```bash
git add plugins/mcp/src/index.ts
git commit -m "refactor: deduplicate MCP execute functions with factory pattern (~300 lines removed)"
```

---

### Task 8: 前端个人 MCP 去重 (spec 2.6)

**背景:** McpSettingsPage.tsx 和 PersonalSettingsPage.tsx（PersonalMcpTab）有 ~300 行重复的个人 MCP CRUD 代码（resetForm、openCreateModal、openEditModal、handleSubmit、handleDelete、handleTest），仅变量名前缀不同。

**Files:**
- Create: `apps/console/src/components/PersonalMcpManager.tsx`
- Modify: `apps/console/src/pages/McpSettingsPage.tsx`
- Modify: `apps/console/src/pages/PersonalSettingsPage.tsx`

- [ ] **Step 1: 创建 PersonalMcpManager.tsx 共享组件**

提取公共逻辑为组件，props 接受 `userId`、`onUpdate` 回调：
```tsx
export function PersonalMcpManager({ userId, onUpdate }: {
  userId?: string;
  onUpdate?: () => void;
}) {
  // 包含：列表展示、新建/编辑 Modal、删除确认、测试连接
  // 内部管理所有 state（servers、formName、formTransport 等）
}
```

- [ ] **Step 2: 在 McpSettingsPage 中替换个人 MCP Tab**

个人 MCP Tab 的内容替换为 `<PersonalMcpManager />`.

- [ ] **Step 3: 在 PersonalSettingsPage 中替换 PersonalMcpTab**

`PersonalMcpTab` 函数的内容替换为 `<PersonalMcpManager />`.

- [ ] **Step 4: 前端类型检查**

```bash
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/console/src/components/PersonalMcpManager.tsx apps/console/src/pages/McpSettingsPage.tsx apps/console/src/pages/PersonalSettingsPage.tsx
git commit -m "refactor: extract PersonalMcpManager component, remove ~300 lines duplication"
```

---

## Chunk 4: 性能优化

### Task 9: 启动优化 (spec 2.7)

**背景:** index.ts 启动时串行循环 `bridge.agentsCreate()`（每个 agent await 一次 RPC），且只恢复 name+workspace，不恢复 model/tools/allowAgents。

**Files:**
- Modify: `apps/server/src/index.ts:191-212`

- [ ] **Step 1: 改为 Promise.allSettled 并发创建**

```typescript
// 替换串行循环
const createResults = await Promise.allSettled(
  agents.map(async (agent) => {
    const nativeId = EngineAdapter.userAgentId(agent.ownerId, agent.name);
    const workspacePath = agent.name === 'default'
      ? workspaceManager.getSubPath(agent.ownerId, 'WORKSPACE')
      : workspaceManager.getAgentWorkspacePath(agent.ownerId, agent.name);
    try {
      await bridge.agentsCreate({ name: nativeId, workspace: workspacePath });
    } catch { /* 已存在则忽略 */ }
    return { agent, nativeId };
  })
);
for (const r of createResults) {
  if (r.status === 'rejected') {
    console.error('[startup] Agent create failed:', r.reason);
  }
}
```

- [ ] **Step 2: 完整恢复 model + tools + allowAgents**

在并发创建完成后，按用户分组，调用 `syncAgentToEngine` 恢复完整配置：

```typescript
// 按用户分组
const byUser = new Map<string, typeof agents>();
for (const agent of agents) {
  const list = byUser.get(agent.ownerId) || [];
  list.push(agent);
  byUser.set(agent.ownerId, list);
}

// 每用户只做 1 次 config sync（而非 N 次）
await Promise.allSettled(
  [...byUser.entries()].map(async ([userId, userAgents]) => {
    const enabledNames = userAgents.filter(a => a.enabled).map(a => a.name);
    // 用 syncAgentToEngine 一次性恢复所有配置
    for (const agent of userAgents) {
      await syncAgentToEngine(bridge, userId, {
        agentName: agent.name,
        model: (agent as any).model || undefined,
        toolsFilter: (agent as any).toolsFilter as string[] || undefined,
        enabledAgentNames: enabledNames,
      });
    }
  })
);
```

- [ ] **Step 3: MockLDAP 用户批量注册**

在 index.ts 的 MockLDAP 用户同步逻辑（约第 129-153 行），将逐个 `registerMockUser` 改为 batch 处理：

```typescript
// 替换: for (const u of dbUsers) { authService.registerMockUser(u); }
// 改为:
if (dbUsers.length > 0) {
  authService.registerMockUsers(dbUsers); // 新增 batch 方法
  console.log(`   MockLDAP: synced ${dbUsers.length} users (batch)`);
}
```

如果 `registerMockUsers` 方法不存在，在 AuthService 中添加一个简单的循环封装（减少日志输出量，一次性注册）。

- [ ] **Step 4: 类型检查 + 提交**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/index.ts
git commit -m "perf: parallelize agent creation, restore full config, batch MockLDAP sync"
```

---

### Task 10: 委派轮询优化 (spec 2.8)

**背景:** 子 agent 执行时前端每 5s 全量拉历史（最多 36 次 = 3 分钟），每次传输完整消息列表。

**Files:**
- Create: 在 `apps/server/src/routes/sessions.ts` 中添加 `GET /sessions/:id/status` 路由
- Modify: `apps/console/src/pages/ChatPage.tsx:599-678`

- [ ] **Step 1: 后端新增轻量 status 端点**

在 sessions.ts 中添加：

```typescript
router.get('/sessions/:sessionId/status', authMiddleware, async (req, res) => {
  const { sessionId } = req.params;
  // 用 sessionsUsage 或 sessionsList 获取轻量信息
  const result = await bridge.chatHistory(sessionId) as any;
  const messages = result?.messages || result?.history || [];
  const lastMsg = messages[messages.length - 1];
  const completed = !lastMsg || lastMsg.role === 'assistant';
  res.json({ completed, messageCount: messages.length });
});
```

- [ ] **Step 2: 前端轮询改为先检查 status，有变化才拉全量**

```typescript
// 替换 ChatPage.tsx 中的委派轮询逻辑
let lastCount = -1;
const pollTimer = setInterval(async () => {
  // 轻量检查
  const status = await adminApi.getSessionStatus(delegationSid, currentAgentId);
  if (status.messageCount === lastCount) {
    stableCount++;
    if (stableCount >= 2) { clearInterval(pollTimer); return; }
    return;
  }
  lastCount = status.messageCount;
  stableCount = 0;
  // 有变化才拉全量历史
  const allMsgs = await adminApi.getChatHistory(delegationSid, currentAgentId);
  setMessages(allMsgs);
  if (status.completed) { clearInterval(pollTimer); }
}, 5000);
```

- [ ] **Step 3: 在 api.ts 中添加 getSessionStatus 方法**

```typescript
async getSessionStatus(sessionId: string, agentId?: string) {
  const res = await this.fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/status${agentId ? `?agentId=${agentId}` : ''}`);
  return res.json();
}
```

- [ ] **Step 4: 双端类型检查**

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/src/routes/sessions.ts apps/console/src/pages/ChatPage.tsx apps/console/src/api.ts
git commit -m "perf: optimize delegation polling (check status before fetching full history)"
```

---

## Chunk 5: 最终验证

### Task 11: 全面验证 + 更新 CLAUDE.md

- [ ] **Step 1: 后端类型检查**

```bash
cd apps/server && npx tsc --noEmit
```

- [ ] **Step 2: 前端类型检查**

```bash
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 3: chat.ts 行数验证**

```bash
wc -l apps/server/src/routes/chat.ts
```
Expected: ~500-600 行。

- [ ] **Step 4: 重复代码验证**

```bash
# MCP execute 函数数量
grep -c 'async execute' plugins/mcp/src/index.ts
# 应减少（工厂替代重复）

# agents.ts configGetParsed 调用数量
grep -c 'configGetParsed' apps/server/src/routes/agents.ts
# 应为 0（已迁移到 AgentConfigSync）
```

- [ ] **Step 5: 重启服务验证功能**

```bash
./start.sh restart
curl -s http://localhost:18790/health
```

验证清单：
- 发消息确认流式对话正常
- 确认 MCP 工具调用正常（`/mcp` 斜杠命令）
- 创建中文名 Agent 确认不再产生冲突 ID
- 创建/编辑/删除 Agent 确认 native config 正确同步
- 查看 Dashboard 确认正常
- 确认启动日志无 agent sync 错误

- [ ] **Step 6: 更新 CLAUDE.md**

在 Refactor History 中添加阶段 2 记录。

- [ ] **Step 7: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase 2 refactoring record"
```
