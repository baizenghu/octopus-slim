# Engine Slim 引擎精简实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 OpenClaw 引擎从 183K 行精简到 ~100K 行，移除 Octopus 不需要的频道适配器、CLI、桌面端功能，保留 agent runtime、gateway、tool system、memory、cron、plugin 等核心能力。

**Architecture:** 三阶段渐进式精简。第 1 阶段删除零耦合模块；第 2 阶段将频道工具和 ACP stub 化（空实现）切断依赖链；第 3 阶段删除已 stub 化的模块源码。每阶段完成后运行 `tsc --noEmit` + `vitest` 确保不破坏编译和测试。

**Tech Stack:** TypeScript, OpenClaw Engine (fork 2026.3.12), Vitest

**项目路径:** `/home/baizh/octopus-slim`（独立副本，不影响生产 `/home/baizh/octopus`）

---

## 现状

```
packages/engine/src/          183,325 行（非测试 .ts）
├── agents/         85K  ← 核心：agent runtime + tools
├── gateway/        43K  ← 核心：RPC server + startup
├── commands/       42K  ← 可砍：CLI 命令处理
├── infra/          38K  ← 核心：基础设施
├── auto-reply/     35K  ← 核心：消息处理（但内嵌频道/ACP 代码）
├── cli/            27K  ← 可砍：CLI 入口
├── config/         26K  ← 核心
├── discord/        24K  ← 可砍：频道
├── telegram/       16K  ← 可砍：频道
├── browser/        15K  ← 可砍：浏览器自动化
├── channels/       13K  ← 部分砍：频道基础设施
├── slack/          11K  ← 可砍：频道
├── memory/         11K  ← 核心
├── cron/            9K  ← 核心
├── secrets/         8K  ← 可砍：凭据管理
├── plugins/         8K  ← 核心
├── security/        8K  ← 可砍：安全审计 CLI
├── acp/             7K  ← 可砍：外部编码工具
├── web/             7K  ← 可砍：HTTP API
├── plugin-sdk/      6K  ← 核心
├── line/            6K  ← 可砍：频道
├── tui/             6K  ← 可砍：终端 UI
├── 其余小模块     ~30K  ← 按需处理
```

**关键发现：**
- `tui/` 是唯一零耦合模块（核心无任何 import）
- `channels/` 被核心引用 140 处，不能直接删
- `discord/`、`telegram/` 等频道在 `agents/tools/` 和 `gateway/` 有直接 import
- `commands/`、`cli/` 被核心引用 77-85 处
- `acp/` 在 `auto-reply/reply/` 中深度集成（20+ 处）

---

## Phase 1: 安全删除零耦合模块

> 目标：删除核心模块完全不引用的模块，零风险。预计砍 ~6K 行。

### Task 1: 删除 tui/ 模块

**Files:**
- Delete: `packages/engine/src/tui/` (5,580 行, 28 文件)

**Step 1: 确认无核心依赖**

```bash
cd /home/baizh/octopus-slim
grep -rl "from.*['\"].*/tui/" packages/engine/src/{agents,gateway,auto-reply,config,infra,plugins,plugin-sdk,memory,cron,hooks,routing,sessions,context-engine,shared,logging,utils,process,providers,types}/ --include='*.ts' 2>/dev/null
```

Expected: 无输出（零依赖）

**Step 2: 删除目录**

```bash
rm -rf packages/engine/src/tui/
```

**Step 3: 修复引用（如果 cli/ 或 commands/ 引用了 tui/，只注释掉）**

```bash
grep -rn "from.*['\"].*/tui/" packages/engine/src/ --include='*.ts' | grep -v '\.test\.'
```

对每个引用：如果在 cli/ 或 commands/（后续也要删的模块）中，暂不处理。如果在核心中，改为空导出。

**Step 4: 编译检查**

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | head -30
```

Expected: 无新增错误（或仅 cli/commands 中的错误，后续阶段处理）

**Step 5: 提交**

```bash
git add -A && git commit -m "slim: remove tui/ module (5.6K lines, zero core deps)"
```

---

### Task 2: 删除独立小模块（compat/, link-understanding/）

**Files:**
- Delete: `packages/engine/src/compat/` (15 行)
- Delete: `packages/engine/src/link-understanding/` (265 行)

**Step 1: 检查依赖并删除**

```bash
grep -rl "from.*['\"].*/compat/" packages/engine/src/ --include='*.ts' | grep -v '\.test\.' | grep -v 'compat/'
grep -rl "from.*['\"].*/link-understanding/" packages/engine/src/ --include='*.ts' | grep -v '\.test\.' | grep -v 'link-understanding/'
```

对找到的引用文件，将 import 语句和使用点注释掉或替换为空值。

**Step 2: 删除并编译检查**

```bash
rm -rf packages/engine/src/compat/ packages/engine/src/link-understanding/
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | grep -c 'error TS'
```

**Step 3: 提交**

```bash
git add -A && git commit -m "slim: remove compat/ + link-understanding/ (280 lines)"
```

---

## Phase 2: Stub 化频道工具和 ACP

> 目标：不删除 channels/ 基础设施（太多核心依赖），但将具体频道实现和频道工具替换为空 stub。预计移除 ~80K 行实际逻辑。

### Task 3: Stub 化频道工具（agents/tools/）

**Files:**
- Modify: `packages/engine/src/agents/tools/discord-actions.ts`
- Modify: `packages/engine/src/agents/tools/discord-actions-messaging.ts`
- Modify: `packages/engine/src/agents/tools/discord-actions-presence.ts`
- Modify: `packages/engine/src/agents/tools/discord-actions-guild.ts`
- Modify: `packages/engine/src/agents/tools/discord-actions-moderation.ts`
- Modify: `packages/engine/src/agents/tools/telegram-actions.ts`
- Modify: `packages/engine/src/agents/tools/slack-actions.ts`
- Modify: `packages/engine/src/agents/tools/tts-tool.ts`
- Modify: `packages/engine/src/agents/tools/canvas-tool.ts`
- Modify: `packages/engine/src/agents/tools/nodes-tool.ts`

**Step 1: 为每个频道工具文件创建 stub**

保留 export 签名，函数体返回空数组或 noop。示例：

```typescript
// packages/engine/src/agents/tools/discord-actions.ts
// STUB: Discord channel removed from Octopus slim build
export function getDiscordActionTools(): never[] { return []; }
// 保留其他 export 签名，全部返回空值
```

对每个文件：
1. 读取当前 export 列表
2. 替换为空实现 stub
3. 保留类型 export（`export type` 不变）

**Step 2: Stub 化 tts-tool.ts**

```typescript
// STUB: TTS removed from Octopus slim build
export function getTtsTools(): never[] { return []; }
```

**Step 3: Stub 化 canvas-tool.ts 和 nodes-tool.ts**

同上模式。

**Step 4: 编译检查**

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | grep 'error TS' | head -20
```

修复类型不匹配的地方（stub 返回类型可能和原始不同）。

**Step 5: 提交**

```bash
git add -A && git commit -m "slim: stub channel tools (discord/telegram/slack/tts/canvas/nodes)"
```

---

### Task 4: Stub 化 ACP 模块

**Files:**
- Modify: `packages/engine/src/agents/acp-spawn.ts`
- Modify: `packages/engine/src/agents/acp-spawn-parent-stream.ts`
- Modify: `packages/engine/src/auto-reply/reply/dispatch-acp.ts`
- Modify: `packages/engine/src/auto-reply/reply/dispatch-acp-delivery.ts`
- Modify: `packages/engine/src/auto-reply/reply/commands-acp/*.ts` (6 文件)
- Modify: `packages/engine/src/auto-reply/reply/acp-stream-settings.ts`
- Modify: `packages/engine/src/auto-reply/reply/acp-reset-target.ts`
- Modify: `packages/engine/src/auto-reply/reply/acp-projector.ts`

**Step 1: Stub 化 acp-spawn 入口**

```typescript
// packages/engine/src/agents/acp-spawn.ts
// STUB: ACP (external coding tools) removed from Octopus slim build
export async function spawnAcpAgent(): Promise<never> {
  throw new Error('ACP is not available in Octopus slim build');
}
// 保留其他 export 签名为空实现
```

**Step 2: Stub 化 auto-reply 中的 ACP 命令**

对 `commands-acp/` 目录下的每个文件，保留 export 函数签名，body 返回 `undefined` 或空。

**Step 3: Stub 化 dispatch-acp 相关文件**

同上模式。

**Step 4: 编译检查 + 修复**

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | grep 'error TS' | head -30
```

**Step 5: 提交**

```bash
git add -A && git commit -m "slim: stub ACP module (external coding tools)"
```

---

### Task 5: Stub 化频道适配器

**Files:**
- Modify: `packages/engine/src/discord/index.ts` (或入口文件)
- Modify: `packages/engine/src/telegram/index.ts`
- Modify: `packages/engine/src/slack/index.ts`
- Modify: `packages/engine/src/signal/index.ts`
- Modify: `packages/engine/src/line/index.ts`
- Modify: `packages/engine/src/imessage/index.ts`
- Modify: `packages/engine/src/whatsapp/index.ts`

**Step 1: 找到每个频道的入口 export**

```bash
for ch in discord telegram slack signal line imessage whatsapp; do
  echo "=== $ch ==="
  head -5 packages/engine/src/$ch/index.ts 2>/dev/null || ls packages/engine/src/$ch/*.ts | head -3
done
```

**Step 2: 每个频道创建 stub index.ts**

保留 export 签名（类型 + 函数），函数体为空实现。不删除目录（channels/ 基础设施引用这些模块的类型）。

**Step 3: 删除频道内部实现文件（保留 index.ts stub）**

```bash
for ch in discord telegram slack signal line imessage whatsapp; do
  # 保留 index.ts 和 types.ts，删除其余
  find packages/engine/src/$ch/ -name '*.ts' ! -name 'index.ts' ! -name 'types.ts' ! -name '*.test.ts' -exec rm {} \;
done
```

**Step 4: 编译检查 + 修复类型错误**

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | grep 'error TS' | wc -l
```

这一步可能有较多类型错误需要修复，预计 20-50 个。

**Step 5: 提交**

```bash
git add -A && git commit -m "slim: stub channel adapters (discord/telegram/slack/signal/line/imessage/whatsapp)"
```

---

### Task 6: Stub 化 browser/ 模块

**Files:**
- Modify: `packages/engine/src/browser/` (保留入口 + 类型，删除实现)
- Modify: 引用 browser 的 agents/tools/ 文件

**Step 1: 找到 browser 工具入口**

```bash
grep -rl "from.*['\"].*/browser/" packages/engine/src/agents/ packages/engine/src/gateway/ --include='*.ts' | grep -v test
```

**Step 2: Stub 化 browser 工具注册**

让 browser 相关工具返回空数组。

**Step 3: 保留 browser/index.ts 类型导出，删除实现文件**

**Step 4: 编译检查**

**Step 5: 提交**

```bash
git add -A && git commit -m "slim: stub browser/ module (15K lines)"
```

---

## Phase 3: 删除已 stub 化的模块内部代码 + 精简 CLI

> 目标：Phase 2 已经切断依赖链，现在可以安全删除实现代码。精简 CLI 到只保留 gateway 启动命令。

### Task 7: 删除频道模块内部实现

**Files:**
- Delete: `packages/engine/src/discord/` 内部文件（保留 stub index.ts + types.ts）
- Delete: `packages/engine/src/telegram/` 同上
- Delete: `packages/engine/src/slack/` 同上
- Delete: `packages/engine/src/signal/` 同上
- Delete: `packages/engine/src/line/` 同上
- Delete: `packages/engine/src/imessage/` 同上
- Delete: `packages/engine/src/whatsapp/` 同上

**Step 1: 确认 Phase 2 的 stub 编译通过**

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | grep 'error TS' | wc -l
```

Expected: 0（或仅预存错误）

**Step 2: 删除实现文件**

Phase 2 Step 3 如果已删除则跳过。否则：

```bash
for ch in discord telegram slack signal line imessage whatsapp; do
  find packages/engine/src/$ch/ -name '*.ts' ! -name 'index.ts' ! -name 'types.ts' -delete
done
```

**Step 3: 删除 acp/ 内部实现（保留 stub 入口）**

```bash
find packages/engine/src/acp/ -name '*.ts' ! -name 'index.ts' ! -name 'types.ts' ! -name 'client.ts' -delete
```

**Step 4: 删除其余可砍模块**

```bash
rm -rf packages/engine/src/secrets/
rm -rf packages/engine/src/security/
rm -rf packages/engine/src/media/
rm -rf packages/engine/src/media-understanding/
rm -rf packages/engine/src/tts/
rm -rf packages/engine/src/pairing/
rm -rf packages/engine/src/canvas-host/
rm -rf packages/engine/src/node-host/
rm -rf packages/engine/src/markdown/
rm -rf packages/engine/src/web/
rm -rf packages/engine/src/wizard/
rm -rf packages/engine/src/terminal/
rm -rf packages/engine/src/daemon/
```

**Step 5: 编译检查 + 修复**

对每个缺失 import 的错误，在引用文件中：
- 类型引用：改为 `any` 或删除
- 值引用：改为空实现或条件检查

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | grep 'error TS' | head -50
```

**Step 6: 提交**

```bash
git add -A && git commit -m "slim: remove channel/acp/media/tts/browser implementation (~80K lines)"
```

---

### Task 8: 精简 CLI + Commands

**Files:**
- Modify: `packages/engine/src/cli/` (保留 gateway 相关，删除频道/设备/安全等子命令)
- Modify: `packages/engine/src/commands/` (保留运行时必要的命令处理)

**Step 1: 分析 CLI 子命令**

```bash
ls packages/engine/src/cli/*-cli.ts 2>/dev/null
```

**Step 2: 保留的 CLI 文件**

- `gateway-cli.ts` — gateway run/status
- `config-cli.ts` — config 管理
- `skills-cli.ts` — skills 管理
- `index.ts` — 主入口（修改只注册保留的子命令）

**Step 3: 删除其余 CLI 文件**

频道、设备、安全审计、浏览器等 CLI 子命令全部删除。

**Step 4: 精简 commands/**

保留 agent 运行时需要的命令（`/compact`、`/session`、`/config` 等），删除频道特定命令。

**Step 5: 编译检查 + 修复**

**Step 6: 提交**

```bash
git add -A && git commit -m "slim: prune CLI to gateway/config/skills commands only"
```

---

### Task 9: 最终验证

**Step 1: 完整编译检查**

```bash
npx tsc --noEmit -p packages/engine/tsconfig.json 2>&1 | grep 'error TS' | wc -l
```

Expected: 0

**Step 2: 运行保留模块的测试**

```bash
npx vitest run packages/engine/src/agents/ packages/engine/src/gateway/ packages/engine/src/memory/ packages/engine/src/cron/ packages/engine/src/config/ 2>&1 | tail -20
```

**Step 3: 统计精简结果**

```bash
echo "=== 精简后 ==="
find packages/engine/src -name '*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
echo "=== 精简前 ==="
echo "183,325 行"
```

**Step 4: 集成测试 — 启动 gateway**

```bash
cd /home/baizh/octopus-slim && bash start.sh
curl -s localhost:18790/health
```

**Step 5: 提交 + 标记里程碑**

```bash
git add -A && git commit -m "slim: engine slim v1 complete — target ~100K lines"
git tag engine-slim-v1
```

---

## 风险与回退

| 风险 | 缓解 |
|------|------|
| Stub 类型不匹配导致大量编译错误 | 逐个文件 stub，每次编译检查，不批量操作 |
| 删除模块破坏运行时 | 每个 Task 后重启 gateway 验证 health |
| channels/ 基础设施和频道实现耦合太深 | 只 stub 不删 channels/ 目录，保留基础类型 |
| 测试覆盖不到的运行时 bug | 集成测试：启动 + 对话 + skill 执行 |
| 后续需要被删模块的功能 | git history 保留，随时 cherry-pick 恢复 |

## 预期成果

| 指标 | 精简前 | 精简后 | 削减 |
|------|--------|--------|------|
| 源码行数 | 183K | ~100K | **45%** |
| 文件数 | ~3800 | ~2000 | **47%** |
| 编译时间 | ~15s | ~8s | **47%** |
| 认知负担 | 28 个模块 | 15 个模块 | **46%** |

## 后续可选优化（不在本计划范围）

- [ ] `tools.deny` 支持通配符（`mcp_amap_*`）— 减少 octopus.json 体积
- [ ] 多租户 tenantId 原生下沉到引擎 — 替代 `ent_` 前缀 hack
- [ ] MCP 工具分组（`group:mcp` 独立于 `group:plugins`）
- [ ] 引擎内置飞书/微信频道适配器（替代企业层 IMRouter）
