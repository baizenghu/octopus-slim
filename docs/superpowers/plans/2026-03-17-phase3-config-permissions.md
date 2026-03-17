# 阶段 3：配置管理统一 + 工具权限对齐 实施计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除双入口冲突、工具权限对齐引擎粒度、IDENTITY.md 利用原生字段、沙箱参数统一从配置读取、记忆隔离显式化。

**Architecture:** 前端工具权限合并为 3 组（read/write/exec）对齐引擎能力，IDENTITY.md 添加 creature/vibe 字段，沙箱参数从 octopus.json 读取替代硬编码，configApplyFull 在非数组场景改用 configApply。记忆隔离在 agent 创建时逐一注册 agentAccess。

**Tech Stack:** TypeScript, React, Express, OpenClaw 原生引擎配置

**Spec:** `docs/superpowers/specs/2026-03-17-system-rectification-plan.md` 阶段 3

**延后评估项（本计划不包含）：**
- 3.4 技能启用状态双写同步 — `skills.entries` 配置路径在引擎中不存在，需先确认引擎是否支持
- 3.6 Plugin 配置即时保存 — 无 UI/API/DB 模型，需从零创建，工作量超出本阶段范围
- 3.1 SystemConfigPage 补齐 — stash 中有 WIP，恢复后再评估缺失项

---

## 文件结构

### 修改文件

| 文件 | 改动 |
|------|------|
| `apps/console/src/pages/AgentsPage.tsx` | 工具权限 checkbox 从 5 个合并为 3 组 |
| `apps/server/src/routes/agents.ts` | syncToNative 写入 creature/vibe 到 IDENTITY.md |
| `apps/server/src/services/AgentConfigSync.ts` | toolsFilter 映射逻辑适配新的 3 组权限 |
| `apps/server/src/services/SystemPromptBuilder.ts` | 工具限制提示适配新的 3 组权限 |
| `plugins/mcp/src/executor.ts` | 沙箱参数从配置读取 |
| `plugins/mcp/src/index.ts` | Skill 沙箱参数从配置读取 + agent 创建时注册 agentAccess |
| `apps/server/src/routes/admin.ts` | configApplyFull → configApply（非数组字段） |
| `apps/server/src/routes/scheduler.ts` | 心跳配置操作保持 configApplyFull（涉及数组） |

---

## Chunk 1: 工具权限对齐（前后端联动）

### Task 1: 前端工具权限合并为 3 组 (spec 3.3)

**背景:** 当前 5 个独立 checkbox（list_files, read_file, write_file, execute_command, search_files），但引擎层 list_files 和 read_file 都映射到 `read`，execute_command 和 search_files 都映射到 `exec`，无法在引擎层独立控制。

**Files:**
- Modify: `apps/console/src/pages/AgentsPage.tsx`

- [ ] **Step 1: 修改 WORKSPACE_TOOLS 定义**

将：
```typescript
const WORKSPACE_TOOLS = [
  { value: 'list_files', label: 'list_files (列出文件)' },
  { value: 'read_file', label: 'read_file (读取文件)' },
  { value: 'write_file', label: 'write_file (写入文件)' },
  { value: 'execute_command', label: 'execute_command (执行命令)' },
  { value: 'search_files', label: 'search_files (搜索文件)' },
];
```

改为：
```typescript
const WORKSPACE_TOOLS = [
  { value: 'read', label: '文件读取 (list_files + read_file)', engines: ['list_files', 'read_file'] },
  { value: 'write', label: '文件写入 (write_file)', engines: ['write_file'] },
  { value: 'exec', label: '命令执行 (execute_command + search_files)', engines: ['execute_command', 'search_files'] },
];
```

- [ ] **Step 2: 适配 toolsFilter 的存储和读取**

提交到后端时展开为原始工具名：
```typescript
// 提交时：将选中的引擎组展开为完整工具名
const toolsFilter = formToolsFilterEnabled
  ? formToolsFilter.flatMap(t => WORKSPACE_TOOLS.find(w => w.value === t)?.engines || [t])
  : [];
```

从后端加载时折叠为引擎组：
```typescript
// 加载时：将工具名折叠为引擎组
const TOOL_TO_GROUP: Record<string, string> = {
  list_files: 'read', read_file: 'read',
  write_file: 'write',
  execute_command: 'exec', search_files: 'exec',
};
const loadedGroups = [...new Set((agent.toolsFilter || []).map(t => TOOL_TO_GROUP[t] || t))];
```

- [ ] **Step 3: 更新 Agent 卡片的工具展示**

卡片上显示 "工具: 读取, 写入" 而非 "工具: 5"。

- [ ] **Step 4: 前端类型检查**

```bash
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 5: 提交**

```bash
git add apps/console/src/pages/AgentsPage.tsx
git commit -m "feat: align tool permissions to engine granularity (5 checkboxes → 3 groups)"
```

---

### Task 2: 后端工具限制提示适配 (spec 3.3 补充)

**Files:**
- Modify: `apps/server/src/services/SystemPromptBuilder.ts`

- [ ] **Step 1: 更新工具限制提示**

在 `buildEnterpriseSystemPrompt` 中，工具限制部分当前用 `allWorkspaceTools`（5 个名称），改为按引擎组描述：

```typescript
const TOOL_GROUPS = [
  { group: 'read', label: '文件读取', tools: ['list_files', 'read_file'] },
  { group: 'write', label: '文件写入', tools: ['write_file'] },
  { group: 'exec', label: '命令执行', tools: ['execute_command', 'search_files'] },
];

// 根据 toolsFilter 判断哪些组被禁用
const enabledTools = new Set(tf || []);
const blockedGroups = TOOL_GROUPS.filter(g => !g.tools.some(t => enabledTools.has(t)));
const allowedGroups = TOOL_GROUPS.filter(g => g.tools.some(t => enabledTools.has(t)));
```

提示文本改为按组描述，如"你被授权使用：文件读取、命令执行。禁止使用：文件写入。"

- [ ] **Step 2: 类型检查 + 提交**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/services/SystemPromptBuilder.ts
git commit -m "feat: update tool restriction prompts to match engine group granularity"
```

---

## Chunk 2: IDENTITY.md + configApply 优化（并行安全）

### Task 3: IDENTITY.md 添加 creature/vibe 字段 (spec 3.5)

**背景:** 当前 IDENTITY.md 仅写入 `name` + `emoji`。OpenClaw 原生支持 `creature`（人设描述）和 `vibe`（风格调性），但未被利用。

**Files:**
- Modify: `apps/server/src/routes/agents.ts` (syncToNative 函数中写 IDENTITY.md 的部分)
- Modify: `apps/console/src/pages/AgentsPage.tsx` (Agent 编辑表单)

- [ ] **Step 1: 后端 syncToNative 写入 creature/vibe**

在 agents.ts 的 `syncToNative` 函数中，找到写 IDENTITY.md 的代码（约第 91-96 行），修改为：

```typescript
if (identity?.name || identity?.emoji) {
  const parts = [
    identity.name ? `name: ${identity.name}` : '',
    identity.emoji ? `emoji: ${identity.emoji}` : '',
  ].filter(Boolean);
  // 新增：description → creature，用于原生引擎人设渲染
  if (description) {
    parts.push(`creature: ${description}`);
  }
  // 新增：vibe 字段（如果 identity 中有）
  if (identity.vibe) {
    parts.push(`vibe: ${identity.vibe}`);
  }
  await setFileWithRetry('IDENTITY.md', parts.join('\n')).catch(...);
}
```

注意：`description` 参数需要从 `syncToNative` 的调用处传入（来自 agent DB 记录）。

- [ ] **Step 2: 前端 Agent 编辑表单添加 vibe 输入**

在 AgentsPage.tsx 的 Agent 编辑 Dialog 中，在 emoji 输入后添加 vibe 文本框：

```tsx
<Label>风格调性 (vibe)</Label>
<Input
  placeholder="例如：专业严谨、友好活泼、简洁高效"
  value={formVibe}
  onChange={e => setFormVibe(e.target.value)}
/>
```

提交时在 identity 对象中包含 vibe：
```typescript
identity: { name: formIdentityName, emoji: formIdentityEmoji, vibe: formVibe || undefined }
```

- [ ] **Step 3: 双端类型检查 + 提交**

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
git add apps/server/src/routes/agents.ts apps/console/src/pages/AgentsPage.tsx
git commit -m "feat: add creature/vibe fields to IDENTITY.md for native persona rendering"
```

---

### Task 4: configApplyFull → configApply（非数组场景）(spec 3.2)

**背景:** admin.ts 中删除用户时用 configApplyFull 修改 agents.list（数组操作，必须全量替换）。但 scheduler.ts 的心跳配置也用 configApplyFull 修改数组，保持不变。非数组场景目前不存在需要替换的调用点（调研确认 admin.ts 中只有一处 configApplyFull 且涉及 agents.list）。

**结论：** 当前所有 configApplyFull 调用都涉及 agents.list 数组修改，无法安全替换为 configApply。此 Task 标记为**无需改动**，记录调研结论即可。

- [ ] **Step 1: 确认并记录结论**

在 CLAUDE.md Lessons Learned 中补充：
```
| 2026-03-17 | configApplyFull 所有调用点都涉及 agents.list 数组修改 | 无法用 configApply 替换（deep merge 对数组是替换语义），保持 read-modify-write 模式 |
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: record configApplyFull analysis - all calls involve array ops, keep as-is"
```

---

## Chunk 3: 沙箱参数 + 记忆隔离

### Task 5: 沙箱参数统一从配置读取 (spec 3.7)

**背景:** 个人 MCP 和个人 Skill 的 Docker 参数硬编码在两处，不一致（MCP: 256m/0.5cpu/internal, Skill: 512m/1cpu/none）。差异有合理性（MCP 需网络，Skill 不需要），但应从配置读取而非硬编码。

**Files:**
- Modify: `.octopus-state/octopus.json` (添加 sandbox.personal 配置)
- Modify: `plugins/mcp/src/executor.ts` (MCP 沙箱参数)
- Modify: `plugins/mcp/src/index.ts` (Skill 沙箱参数)

- [ ] **Step 1: 在 octopus.json 中添加 sandbox.personal 配置**

```json
{
  "sandbox": {
    "personal": {
      "mcp": { "memory": "256m", "cpus": "0.5", "network": "octopus-internal" },
      "skill": { "memory": "512m", "cpus": "1", "network": "none" }
    }
  }
}
```

注意：与 `agents.defaults.sandbox`（引擎 exec 沙箱）分开，这是 plugin 层的个人 MCP/Skill 沙箱。

- [ ] **Step 2: executor.ts 从配置读取 MCP 沙箱参数**

在 `plugins/mcp/src/executor.ts` 中，找到 Docker 参数硬编码处（约第 123-129 行），改为：

```typescript
// 从全局配置读取，fallback 到默认值
const sandboxCfg = (globalThis as any).__octopusSandboxConfig?.personal?.mcp || {};
const memory = sandboxCfg.memory || '256m';
const cpus = sandboxCfg.cpus || '0.5';
const network = sandboxCfg.network || 'octopus-internal';

const dockerArgs = [
  'run', '-i', '--rm',
  '--network', network,
  '--user', '2000:2000',
  '--memory', memory,
  '--cpus', cpus,
];
```

- [ ] **Step 3: index.ts 从配置读取 Skill 沙箱参数**

在 `plugins/mcp/src/index.ts` 中 Skill 执行的 Docker 参数处（约第 1370-1384 行），同理改为从配置读取。

- [ ] **Step 4: 在 plugin 初始化时注入配置**

在 plugin 的入口函数中，从 `api.getConfig()` 或 `octopus.json` 读取 sandbox.personal 配置，挂载到 `globalThis.__octopusSandboxConfig`。

- [ ] **Step 5: 提交**

```bash
git add .octopus-state/octopus.json plugins/mcp/src/executor.ts plugins/mcp/src/index.ts
git commit -m "feat: read sandbox params from config instead of hardcoding"
```

---

### Task 6: 记忆隔离显式化 (spec 3.8)

**背景:** memory-lancedb-pro 的 `scopes.agentAccess: {}` 为空，记忆隔离隐式依赖 agent ID 命名规则。agentAccess 不支持通配符（精确匹配），需在创建专业 agent 时逐一注册。

**Files:**
- Modify: `apps/server/src/services/AgentConfigSync.ts`
- Modify: `.octopus-state/octopus.json`

- [ ] **Step 1: 在 AgentConfigSync 中添加 agentAccess 同步逻辑**

在 `syncAgentToEngine` 函数末尾，当 `enabledAgentNames` 变化时，同步更新 memory-lancedb-pro 的 agentAccess：

```typescript
// 4. 同步 memory-lancedb-pro agentAccess（记忆隔离）
if (opts.enabledAgentNames && config.plugins?.entries?.['memory-lancedb-pro']?.config?.scopes) {
  const scopes = config.plugins.entries['memory-lancedb-pro'].config.scopes;
  const defaultId = EA.userAgentId(userId, 'default');
  const specialistIds = opts.enabledAgentNames
    .filter(n => n !== 'default')
    .map(n => EA.userAgentId(userId, n));

  // default agent 可访问所有该用户 agent 的记忆
  const allUserAgentIds = [defaultId, ...specialistIds];
  const oldAccess = JSON.stringify(scopes.agentAccess?.[defaultId]);
  scopes.agentAccess = scopes.agentAccess || {};
  scopes.agentAccess[defaultId] = allUserAgentIds;

  // 每个专业 agent 只能访问自己和 default 的记忆
  for (const sid of specialistIds) {
    scopes.agentAccess[sid] = [sid, defaultId];
  }

  if (JSON.stringify(scopes.agentAccess[defaultId]) !== oldAccess) {
    changed = true;
  }
}
```

- [ ] **Step 2: 清理删除 agent 时的 agentAccess**

在删除 agent 的分支中，同时从 agentAccess 中移除对应 entry：

```typescript
if (opts.deleteAgentName) {
  const deleteId = EA.userAgentId(userId, opts.deleteAgentName);
  // ... 现有删除逻辑
  // 清理 agentAccess
  if (config.plugins?.entries?.['memory-lancedb-pro']?.config?.scopes?.agentAccess) {
    delete config.plugins.entries['memory-lancedb-pro'].config.scopes.agentAccess[deleteId];
    changed = true;
  }
}
```

- [ ] **Step 3: 类型检查 + 提交**

```bash
cd apps/server && npx tsc --noEmit
git add apps/server/src/services/AgentConfigSync.ts
git commit -m "feat: explicit memory isolation via agentAccess on agent create/delete"
```

---

## Chunk 4: 最终验证

### Task 7: 全面验证 + 更新 CLAUDE.md

- [ ] **Step 1: 双端类型检查**

```bash
cd apps/server && npx tsc --noEmit
cd apps/console && npx tsc --noEmit
```

- [ ] **Step 2: 重启服务验证功能**

```bash
./start.sh restart
curl -s http://localhost:18790/health
```

验证清单：
- 创建 Agent 时工具权限显示为 3 组（文件读取/文件写入/命令执行）
- 创建 Agent 后检查 IDENTITY.md 包含 creature 字段
- 创建专业 Agent 后检查 octopus.json 中 agentAccess 包含新 agent ID
- 删除 Agent 后 agentAccess 已清理
- 沙箱参数可通过 octopus.json 调整（修改后重启生效）

- [ ] **Step 3: 更新 CLAUDE.md**

在 Refactor History 中添加阶段 3 记录。

- [ ] **Step 4: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with Phase 3 rectification record"
```
