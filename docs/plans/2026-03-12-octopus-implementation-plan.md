# Octopus 合并实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 openclaw-main（原生引擎）和 openclaw-enterprise（企业层）合并为单进程项目 Octopus，抹除所有 openclaw 痕迹。

**Architecture:** 原生引擎核心作为 `@octopus/engine` 包引入（保持内部结构），企业层各模块重命名为 `@octopus/*`，删除 OpenClawBridge RPC 层，改为进程内直接调用。

**Tech Stack:** Node.js 22+, TypeScript 5.4, pnpm 9 monorepo, Turbo, Express 4, React 18, Prisma 6 (MySQL), Vitest

**设计文档:** `docs/plans/2026-03-12-octopus-merge-design.md`

---

## 关键发现（影响计划）

1. **原生代码耦合度高**：agents/ 依赖 config/(70+次)、logging/(30+次)、infra/(20+次)、routing/、channels/、plugins/ — 无法单独提取 agents/，需整体引入 src/
2. **原生代码量大**：800+ 源文件，但只需 ~500 个核心文件（丢弃 40 个渠道、移动端 app、独立 bot）
3. **OpenClawBridge 有 25+ 个 RPC 方法**，被 6 个路由文件 + 1 个 IM 服务调用，是最核心的重构点
4. **Plugin SDK 提供 24 个 Hook + registerTool 等 10 个注册方法**，企业插件深度依赖

---

## Phase 0: 项目脚手架（无风险）

### Task 0.1: 初始化 monorepo 基础设施

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.json`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `vitest.config.ts`

**Step 1: 创建根 package.json**

```json
{
  "name": "octopus",
  "version": "1.0.0",
  "private": true,
  "description": "Octopus 企业级多租户 AI 助手平台",
  "packageManager": "pnpm@9.0.0",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "vitest run",
    "typecheck": "turbo typecheck",
    "clean": "turbo clean"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0",
    "vitest": "^2.0.0",
    "@types/node": "^22.0.0"
  }
}
```

**Step 2: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
  - "plugins/*"
  - "channels/*"
  - "apps/*"
```

**Step 3: 创建 tsconfig.json（根级）**

从 `/home/baizh/openclaw-enterprise/tsconfig.json` 复制并调整 paths。

**Step 4: 创建 turbo.json**

从 `/home/baizh/openclaw-enterprise/turbo.json` 复制。

**Step 5: 创建 .gitignore**

从 `/home/baizh/openclaw-enterprise/.gitignore` 复制，将所有 `openclaw` 替换为 `octopus`。

**Step 6: 创建 .env.example**

从 `/home/baizh/openclaw-enterprise/.env.example` 复制，将所有 `OPENCLAW_` 替换为 `OCTOPUS_`，将 `openclaw_enterprise` 替换为 `octopus_enterprise`，将 DB 用户 `openclaw` 替换为 `octopus`。

**Step 7: pnpm install 并 commit**

```bash
cd /home/baizh/octopus
pnpm install
git add -A
git commit -m "chore: 初始化 octopus monorepo 脚手架"
```

---

## Phase 1: 引入原生引擎核心（高风险，需谨慎）

### Task 1.1: 创建 @octopus/engine 包 — 复制原生核心源码

**策略**：将 openclaw-main/src/ 整体复制为 packages/engine/src/，保持内部目录结构不变（避免破坏 800+ 文件的内部 import 关系）。然后删除不需要的子目录。

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/tsconfig.json`
- Copy: `openclaw-main/src/{agents,gateway,config,extensions,infra,process,logging,types,routing,security,utils,auto-reply,globals.ts,runtime.ts}` → `packages/engine/src/`

**Step 1: 创建 engine 包目录和 package.json**

```json
{
  "name": "@octopus/engine",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./agents": "./src/agents/index.ts",
    "./config": "./src/config/index.ts",
    "./gateway": "./src/gateway/index.ts",
    "./plugins": "./src/plugins/index.ts",
    "./logging": "./src/logging/index.ts",
    "./process": "./src/process/index.ts",
    "./infra": "./src/infra/index.ts"
  }
}
```

**Step 2: 从 openclaw-main 复制核心目录**

```bash
# 复制核心模块（保持目录结构）
cp -r /home/baizh/openclaw-main/src/agents packages/engine/src/
cp -r /home/baizh/openclaw-main/src/gateway packages/engine/src/
cp -r /home/baizh/openclaw-main/src/config packages/engine/src/
cp -r /home/baizh/openclaw-main/src/extensions packages/engine/src/  # → 后续改名 plugins
cp -r /home/baizh/openclaw-main/src/infra packages/engine/src/
cp -r /home/baizh/openclaw-main/src/process packages/engine/src/
cp -r /home/baizh/openclaw-main/src/logging packages/engine/src/
cp -r /home/baizh/openclaw-main/src/types packages/engine/src/
cp -r /home/baizh/openclaw-main/src/routing packages/engine/src/
cp -r /home/baizh/openclaw-main/src/security packages/engine/src/
cp -r /home/baizh/openclaw-main/src/utils packages/engine/src/
cp -r /home/baizh/openclaw-main/src/auto-reply packages/engine/src/

# 复制顶级文件
cp /home/baizh/openclaw-main/src/globals.ts packages/engine/src/
cp /home/baizh/openclaw-main/src/runtime.ts packages/engine/src/
cp /home/baizh/openclaw-main/src/index.ts packages/engine/src/
cp /home/baizh/openclaw-main/src/entry.ts packages/engine/src/
```

**Step 3: 删除不需要的子目录**

```bash
# 渠道 — 大部分不需要（telegram/discord/feishu 后续单独处理）
rm -rf packages/engine/src/channels/

# CLI — octopus 有自己的入口
rm -rf packages/engine/src/cli/

# 移动端/桌面端
# （这些在 apps/ 不在 src/ 中，不需要删除）

# 浏览器自动化（企业内网不需要）
rm -rf packages/engine/src/browser/

# Terminal UI（企业版用 web 控制台）
rm -rf packages/engine/src/terminal/

# Media understanding（可选，先删后看）
rm -rf packages/engine/src/media-understanding/
rm -rf packages/engine/src/media/
rm -rf packages/engine/src/tts/
rm -rf packages/engine/src/markdown/
```

**Step 4: 处理被删除模块的 import 引用**

删除上述目录后，engine 内部会有断裂的 import。需要：
1. Grep 搜索 `from '../channels/` 等引用
2. 创建 stub 模块或条件 import 替换
3. 这是最复杂的步骤，需要逐个文件处理

**Step 5: Commit**

```bash
git add packages/engine/
git commit -m "feat: 引入原生引擎核心源码为 @octopus/engine"
```

### Task 1.2: 复制原生依赖并确保 TypeScript 编译通过

**Files:**
- Modify: `packages/engine/package.json` — 添加 npm 依赖
- Modify: `packages/engine/tsconfig.json`

**Step 1: 从 openclaw-main/package.json 提取需要的依赖**

需要的核心依赖（从原生 package.json 提取）：
```
ws, express, commander, zod, sharp, json5
```

**Step 2: 安装并尝试编译**

```bash
cd packages/engine
npx tsc --noEmit 2>&1 | head -50
```

**Step 3: 逐个修复编译错误**

主要错误类型：
- 缺失的 import（被删除的模块）→ 创建 stub 或删除引用
- 缺失的 npm 依赖 → 添加到 package.json
- 类型不兼容 → 修复

**Step 4: 确认编译通过后 commit**

```bash
git add -A
git commit -m "fix: @octopus/engine TypeScript 编译通过"
```

### Task 1.3: 全局品牌替换 — engine 包内 openclaw → octopus

**Step 1: 替换所有字符串引用**

```bash
cd packages/engine/src

# 配置文件名
find . -type f -name "*.ts" -exec sed -i 's/openclaw\.json/octopus.json/g' {} +
find . -type f -name "*.ts" -exec sed -i 's/openclaw\.plugin\.json/octopus.plugin.json/g' {} +

# 环境变量
find . -type f -name "*.ts" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +

# 类名和标识符（保守替换，逐个确认）
# OpenClaw → Octopus（类名、注释）
find . -type f -name "*.ts" -exec sed -i 's/OpenClaw/Octopus/g' {} +
find . -type f -name "*.ts" -exec sed -i 's/openclaw/octopus/g' {} +
```

**Step 2: 检查替换结果，修复误替换**

**Step 3: 编译验证 + commit**

```bash
npx tsc --noEmit
git add -A
git commit -m "refactor: engine 包内 openclaw → octopus 全局品牌替换"
```

---

## Phase 2: 迁移企业层代码（中风险）

### Task 2.1: 迁移企业包 — packages/

从 openclaw-enterprise/packages/ 复制 8 个包，重命名为 @octopus/*：

| 旧包 | 新包 | 新目录 |
|------|------|--------|
| enterprise-auth | @octopus/auth | packages/auth |
| enterprise-audit | @octopus/audit | packages/audit |
| enterprise-database | @octopus/database | packages/database |
| enterprise-mcp | @octopus/mcp | packages/mcp |
| enterprise-quota | @octopus/quota | packages/quota |
| enterprise-rag | @octopus/rag | packages/rag |
| enterprise-skills | @octopus/skills | packages/skills |
| enterprise-workspace | @octopus/workspace | packages/workspace |

**Step 1: 复制每个包并重命名 package.json 中的 name**

```bash
for pkg in auth audit database mcp quota rag skills workspace; do
  cp -r /home/baizh/openclaw-enterprise/packages/enterprise-${pkg} packages/${pkg}
  # 修改 package.json 中的 name
  sed -i "s/@openclaw-enterprise\/${pkg}/@octopus\/${pkg}/g" packages/${pkg}/package.json
done
```

**Step 2: 全局替换 import 路径**

```bash
# 在所有包的 src/ 中替换 import
find packages/ -name "*.ts" -exec sed -i 's/@openclaw-enterprise\//@octopus\//g' {} +
```

**Step 3: 替换 OPENCLAW_ 环境变量引用**

```bash
find packages/ -name "*.ts" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +
```

**Step 4: 编译验证 + commit**

```bash
npx tsc --noEmit
git add packages/{auth,audit,database,mcp,quota,rag,skills,workspace}
git commit -m "feat: 迁移企业包为 @octopus/* 命名空间"
```

### Task 2.2: 迁移 Prisma schema 和数据库

**Files:**
- Copy: `openclaw-enterprise/database/` → `database/`
- Modify: `packages/database/src/index.ts`

**Step 1: 复制数据库目录**

```bash
cp -r /home/baizh/openclaw-enterprise/database /home/baizh/octopus/database
```

**Step 2: 修改 Prisma schema 中的数据库名引用**

在注释和配置中替换 `openclaw_enterprise` → `octopus_enterprise`。

**Step 3: 验证 prisma generate**

```bash
cd packages/database
npx prisma generate
```

**Step 4: Commit**

```bash
git add database/ packages/database/
git commit -m "feat: 迁移数据库 schema 和 Prisma 配置"
```

### Task 2.3: 迁移 Plugin

**Files:**
- Copy: `openclaw-enterprise/plugins/enterprise-audit/` → `plugins/audit/`
- Copy: `openclaw-enterprise/plugins/enterprise-mcp/` → `plugins/mcp/`
- Copy: `openclaw-enterprise/.openclaw-state/extensions/memory-lancedb-pro/` → `plugins/memory-lancedb-pro/`

**Step 1: 复制并重命名**

```bash
cp -r /home/baizh/openclaw-enterprise/plugins/enterprise-audit plugins/audit
cp -r /home/baizh/openclaw-enterprise/plugins/enterprise-mcp plugins/mcp
cp -r /home/baizh/openclaw-enterprise/.openclaw-state/extensions/memory-lancedb-pro plugins/memory-lancedb-pro
```

**Step 2: 重命名清单文件和内容**

```bash
# 重命名文件
mv plugins/audit/openclaw.plugin.json plugins/audit/octopus.plugin.json
mv plugins/mcp/openclaw.plugin.json plugins/mcp/octopus.plugin.json
mv plugins/memory-lancedb-pro/openclaw.plugin.json plugins/memory-lancedb-pro/octopus.plugin.json

# 替换文件内容
find plugins/ -name "*.json" -exec sed -i 's/openclaw/octopus/g' {} +
find plugins/ -name "*.ts" -exec sed -i 's/@openclaw-enterprise\//@octopus\//g' {} +
find plugins/ -name "*.ts" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +
find plugins/ -name "*.ts" -exec sed -i 's/OpenClaw/Octopus/g' {} +
```

**Step 3: Commit**

```bash
git add plugins/
git commit -m "feat: 迁移 plugins（audit, mcp, memory-lancedb-pro）"
```

### Task 2.4: 迁移渠道插件

**Files:**
- Copy: `openclaw-main/extensions/telegram/` → `channels/telegram/`
- Copy: `openclaw-main/extensions/discord/` → `channels/discord/`
- Copy: `openclaw-main/extensions/feishu/` → `channels/feishu-native/`
- Copy: `openclaw-enterprise/apps/gateway/src/services/im/` → `channels/feishu-enterprise/`

**Step 1: 复制原生渠道插件**

```bash
cp -r /home/baizh/openclaw-main/extensions/telegram channels/telegram
cp -r /home/baizh/openclaw-main/extensions/discord channels/discord
cp -r /home/baizh/openclaw-main/extensions/feishu channels/feishu-native
```

**Step 2: 提取企业飞书 Adapter 为独立包**

```bash
mkdir -p channels/feishu-enterprise/src
cp /home/baizh/openclaw-enterprise/apps/gateway/src/services/im/FeishuAdapter.ts channels/feishu-enterprise/src/
cp /home/baizh/openclaw-enterprise/apps/gateway/src/services/im/IMAdapter.ts channels/feishu-enterprise/src/
cp /home/baizh/openclaw-enterprise/apps/gateway/src/services/im/IMService.ts channels/feishu-enterprise/src/
cp /home/baizh/openclaw-enterprise/apps/gateway/src/services/im/IMRouter.ts channels/feishu-enterprise/src/
cp /home/baizh/openclaw-enterprise/apps/gateway/src/services/im/index.ts channels/feishu-enterprise/src/
```

**Step 3: 品牌替换 + commit**

```bash
find channels/ -name "*.ts" -exec sed -i 's/openclaw/octopus/g' {} +
find channels/ -name "*.ts" -exec sed -i 's/OpenClaw/Octopus/g' {} +
git add channels/
git commit -m "feat: 迁移渠道插件（telegram, discord, feishu-native, feishu-enterprise）"
```

---

## Phase 3: 单进程合并 — 核心重构（最高风险）

### Task 3.1: 创建统一后端入口 apps/server

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Copy + Modify: `openclaw-enterprise/apps/gateway/src/` → `apps/server/src/`

**Step 1: 复制企业 gateway 代码为 server**

```bash
cp -r /home/baizh/openclaw-enterprise/apps/gateway apps/server
sed -i 's/@openclaw-enterprise\/gateway/@octopus\/server/g' apps/server/package.json
```

**Step 2: 全局替换 import 和品牌**

```bash
find apps/server/src -name "*.ts" -exec sed -i 's/@openclaw-enterprise\//@octopus\//g' {} +
find apps/server/src -name "*.ts" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +
find apps/server/src -name "*.ts" -exec sed -i 's/OpenClaw/Octopus/g' {} +
find apps/server/src -name "*.ts" -exec sed -i 's/openclaw/octopus/g' {} +
```

**Step 3: Commit（编译暂不通过，下一步修）**

```bash
git add apps/server/
git commit -m "feat: 创建统一后端 @octopus/server（品牌替换完成，待重构 Bridge）"
```

### Task 3.2: 删除 OpenClawBridge，替换为引擎直接调用 ⭐ 核心任务

这是整个合并中最关键的一步。OpenClawBridge（701 行）的 25+ 个 RPC 方法需要逐个替换为 `@octopus/engine` 的直接函数调用。

**Files:**
- Delete: `apps/server/src/services/OpenClawBridge.ts`（已重命名为 OctopusBridge）
- Create: `apps/server/src/services/EngineAdapter.ts` — 薄包装层
- Modify: 6 个路由文件 + 1 个 IM 服务

**Step 1: 创建 EngineAdapter — 直接调用引擎 API**

创建 `apps/server/src/services/EngineAdapter.ts`，对 `@octopus/engine` 的 API 做薄包装，保持与旧 Bridge 相同的方法签名，但内部改为进程内调用：

```typescript
// apps/server/src/services/EngineAdapter.ts
import { loadConfig } from '@octopus/engine/config';
import { createEmbeddedRunner } from '@octopus/engine/agents';
import { createPluginRuntime } from '@octopus/engine/plugins';
// ... 更多 import

export class EngineAdapter extends EventEmitter {
  private runner: EmbeddedRunner;
  private configIO: ConfigIO;

  async initialize() {
    // 直接初始化引擎（不再通过 WebSocket）
    const config = await loadConfig();
    this.configIO = createConfigIO();
    this.runner = createEmbeddedRunner(config);
    // 加载 plugins
    await loadPlugins(config);
  }

  // 保持与旧 Bridge 相同的方法签名
  async callAgent(params, onEvent) { /* 直接调用 runner */ }
  async sessionsList(agentId?) { /* 直接调用 session store */ }
  async agentsCreate(params) { /* 直接调用 agent manager */ }
  async configGet() { /* 直接调用 configIO */ }
  async configSet(raw, hash) { /* 直接调用 configIO */ }
  // ... 其余 20+ 方法
}
```

**Step 2: 在路由文件中将 bridge 替换为 engineAdapter**

需要修改的文件（6 个路由 + 1 个服务）：

| 文件 | bridge 调用数 | 改动策略 |
|------|-------------|---------|
| `routes/chat.ts` | 10+ | `bridge.callAgent()` → `engineAdapter.callAgent()` |
| `routes/agents.ts` | 15+ | `bridge.configApplyFull()` → `engineAdapter.configApplyFull()` |
| `routes/scheduler.ts` | 20+ | `bridge.cronAdd()` → `engineAdapter.cronAdd()` |
| `routes/admin.ts` | 6+ | `bridge.agentsDelete()` → `engineAdapter.agentsDelete()` |
| `index.ts` | 3+ | `bridge.connect()` → `engineAdapter.initialize()` |
| `services/im/IMRouter.ts` | 1 | `bridge.callAgent()` → `engineAdapter.callAgent()` |

由于 EngineAdapter 保持了相同的方法签名，这一步主要是变量重命名：

```typescript
// 旧代码
const bridge = new OctopusBridge(config);
await bridge.connect();

// 新代码
const engineAdapter = new EngineAdapter(config);
await engineAdapter.initialize();
```

**Step 3: 删除旧 Bridge 文件**

```bash
rm apps/server/src/services/OctopusBridge.ts  # 已从 OpenClawBridge 重命名
```

**Step 4: 编译验证 + commit**

```bash
cd apps/server && npx tsc --noEmit
git add -A
git commit -m "refactor: 删除 RPC Bridge，替换为 EngineAdapter 进程内直接调用"
```

### Task 3.3: 引擎启动集成

**Files:**
- Modify: `apps/server/src/index.ts` — 启动时初始化引擎

**Step 1: 修改 index.ts 启动流程**

```typescript
// 旧流程（两进程）：
// 1. 启动 Express
// 2. bridge.connect() → WebSocket 连接到 native gateway

// 新流程（单进程）：
// 1. 初始化引擎（加载配置、agent manager、cron scheduler、plugin system）
// 2. 启动 Express（使用引擎实例）
// 3. 加载 plugins（audit、mcp、memory）
```

**Step 2: 编译 + 运行测试**

```bash
npx tsc --noEmit
npx vitest run
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: 单进程启动 — 引擎和 HTTP 服务统一初始化"
```

---

## Phase 4: 迁移前端 Admin Console（低风险）

### Task 4.1: 复制并重命名 Admin Console

**Files:**
- Copy: `openclaw-enterprise/apps/admin-console/` → `apps/console/`

**Step 1: 复制**

```bash
cp -r /home/baizh/openclaw-enterprise/apps/admin-console apps/console
```

**Step 2: 替换品牌引用**

```bash
# package.json
sed -i 's/@openclaw-enterprise\/admin-console/@octopus\/console/g' apps/console/package.json

# 源码中的品牌文字（标题、logo 等）
find apps/console/src -name "*.tsx" -name "*.ts" -exec sed -i 's/OpenClaw/Octopus/g' {} +
find apps/console/src -name "*.tsx" -name "*.ts" -exec sed -i 's/openclaw/octopus/g' {} +

# API 地址（如果有硬编码的 OPENCLAW_ 环境变量）
find apps/console/src -name "*.ts" -name "*.tsx" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +
```

**Step 3: Commit**

```bash
git add apps/console/
git commit -m "feat: 迁移 Admin Console 为 @octopus/console"
```

---

## Phase 5: 基础设施和脚本（中风险）

### Task 5.1: 创建 Docker 配置

**Files:**
- Copy + Modify: `docker/docker-compose.dev.yml`
- Copy + Modify: `docker/sandbox/Dockerfile`
- Copy + Modify: `docker/sandbox/build.sh`
- Copy + Modify: `docker/sandbox/setup-network.sh`

**Step 1: 复制并替换品牌**

```bash
cp -r /home/baizh/openclaw-enterprise/docker /home/baizh/octopus/docker

# 全局替换
find docker/ -type f -exec sed -i 's/openclaw-sandbox/octopus-sandbox/g' {} +
find docker/ -type f -exec sed -i 's/openclaw-internal/octopus-internal/g' {} +
find docker/ -type f -exec sed -i 's/openclaw-mysql/octopus-mysql/g' {} +
find docker/ -type f -exec sed -i 's/openclaw-redis/octopus-redis/g' {} +
find docker/ -type f -exec sed -i 's/openclaw_enterprise/octopus_enterprise/g' {} +
find docker/ -type f -exec sed -i 's/openclaw/octopus/g' {} +
```

**Step 2: Commit**

```bash
git add docker/
git commit -m "feat: Docker 配置（sandbox, mysql, redis）品牌替换"
```

### Task 5.2: 创建启动脚本

**Files:**
- Create: `start.sh` — 从 `start-dev.sh` 简化（单进程不再需要启动 native gateway）
- Create: `octopus.mjs` — CLI 入口

**Step 1: 创建 start.sh**

从 `/home/baizh/openclaw-enterprise/start-dev.sh` 简化：
- 删除 native gateway 启动逻辑（步骤 6 — supervisor 循环）
- 保留：Docker 网络检查、地图 MCP 启动、权限设置
- 修改：只启动一个 Node 进程（apps/server）+ Admin Console
- 替换所有 `openclaw` → `octopus`

**Step 2: 创建 octopus.mjs — CLI 入口**

从 `/home/baizh/openclaw-main/openclaw.mjs` 简化：
```javascript
#!/usr/bin/env node
// Octopus CLI 入口
import('./apps/server/src/entry.js');
```

**Step 3: Commit**

```bash
git add start.sh octopus.mjs
git commit -m "feat: 启动脚本 start.sh + CLI 入口 octopus.mjs"
```

### Task 5.3: 创建部署配置

**Files:**
- Create: `deploy/octopus.service`
- Copy + Modify: `ecosystem.config.js`
- Copy + Modify: `scripts/migrate-*.sh`

**Step 1: 从旧文件复制并全局替换品牌**

```bash
cp -r /home/baizh/openclaw-enterprise/deploy /home/baizh/octopus/deploy
cp /home/baizh/openclaw-enterprise/ecosystem.config.js /home/baizh/octopus/
cp -r /home/baizh/openclaw-enterprise/scripts /home/baizh/octopus/

# 重命名
mv deploy/openclaw-enterprise.service deploy/octopus.service

# 替换内容
find deploy/ scripts/ -type f -exec sed -i 's/openclaw/octopus/g' {} +
find deploy/ scripts/ -type f -exec sed -i 's/OpenClaw/Octopus/g' {} +
sed -i 's/openclaw/octopus/g' ecosystem.config.js
```

**Step 2: 修改 ecosystem.config.js 中的路径**

删除 native gateway 进程配置，只保留一个 server 进程。

**Step 3: Commit**

```bash
git add deploy/ scripts/ ecosystem.config.js
git commit -m "feat: 部署配置（systemd, pm2, 迁移脚本）"
```

---

## Phase 6: 状态目录和数据迁移（中风险）

### Task 6.1: 创建 .octopus-state 目录结构

**Step 1: 从旧项目复制并重命名**

```bash
# 只复制结构和配置模板，不复制运行时数据
mkdir -p .octopus-state
# 复制 octopus.json（从 openclaw.json 重命名后的模板）
```

**Step 2: 创建配置模板 .octopus-state/octopus.json**

从 `.openclaw-state/openclaw.json` 复制，替换所有 `openclaw` → `octopus`。

**Step 3: 更新 .gitignore 中的路径**

```
.octopus-state/logs/
.octopus-state/agents/
.octopus-state/memory/
# ... 等等
```

**Step 4: Commit**

```bash
git add .octopus-state/ .gitignore
git commit -m "feat: .octopus-state 目录结构和配置模板"
```

### Task 6.2: 数据目录

**Step 1: 复制 data/ 目录结构**

```bash
cp -r /home/baizh/openclaw-enterprise/data /home/baizh/octopus/data
```

**Step 2: 复制 Skill 文件（已 git 追踪的部分）**

Skills 代码需要迁移，用户数据不需要。

**Step 3: Commit**

```bash
git add data/skills/ data/templates/
git commit -m "feat: 迁移 data 目录（skills, templates）"
```

---

## Phase 7: 文档和项目配置（低风险）

### Task 7.1: 创建 CLAUDE.md

从 `/home/baizh/openclaw-enterprise/CLAUDE.md` 复制，全面替换：
- `OpenClaw Enterprise` → `Octopus`
- `openclaw` → `octopus` (全小写)
- `OpenClaw` → `Octopus` (首字母大写)
- `OPENCLAW_` → `OCTOPUS_`
- 更新架构图（单进程）
- 更新服务列表（删除 native gateway）
- 更新端口信息
- 更新 Lessons Learned（保留教训但更新术语）

### Task 7.2: 更新 Memory 文件

从 `/home/baizh/.claude/projects/-home-baizh-openclaw-enterprise/memory/MEMORY.md` 创建新的 memory 文件，更新所有术语。

### Task 7.3: 其他文档

从 `openclaw-enterprise/docs/` 选择性复制仍然有价值的文档：
- `deployment-guide.md` — 需要大幅修改
- `deployment-pitfall-guide.md` — 部分教训仍适用
- 历史文档可以不迁移

---

## Phase 8: 验证和测试

### Task 8.1: 全面编译验证

```bash
cd /home/baizh/octopus
pnpm install
pnpm typecheck    # 所有包 tsc --noEmit
```

### Task 8.2: 迁移测试用例

从 `openclaw-enterprise/apps/gateway/src/**/*.test.ts` 和 `tests/` 复制测试，替换品牌引用。

```bash
pnpm test
```

### Task 8.3: 端到端验证

```bash
./start.sh start
# 检查：
# 1. 引擎初始化成功
# 2. Plugin 加载成功
# 3. Agent 创建/对话正常
# 4. Admin Console 可访问
# 5. 审计日志正常写入
./start.sh stop
```

### Task 8.4: 搜索残留的 openclaw 引用

```bash
grep -ri "openclaw" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.sh" --include="*.yaml" --include="*.yml" .
# 期望：零结果
```

---

## 执行顺序和依赖关系

```
Phase 0 (脚手架)
  └─→ Phase 1 (引擎核心) ──→ Phase 3 (单进程合并)
  └─→ Phase 2 (企业层) ────→ Phase 3
  └─→ Phase 4 (前端) ── 独立
  └─→ Phase 5 (基础设施) ── 依赖 Phase 3
  └─→ Phase 6 (数据) ── 独立
  └─→ Phase 7 (文档) ── 独立
Phase 3 完成后 → Phase 8 (验证)
```

**可并行的 Phase**: 1+2 可并行，4+6+7 可并行
**必须串行的**: 0 → 1&2 → 3 → 5 → 8

---

## 风险矩阵

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|---------|
| 原生代码删除模块后 import 断裂 | 高 | 高 | Task 1.1 Step 4 逐个修复，保留 stub |
| EngineAdapter 方法签名与原生 API 不匹配 | 高 | 中 | 参考 IntegrationAgent 的完整 RPC 列表 |
| Plugin SDK API 变化导致企业插件无法加载 | 高 | 中 | 先确保 engine Plugin loader 工作再改企业插件 |
| sed 全局替换误伤（如变量名包含 openclaw 子串） | 中 | 中 | 替换后 diff 审查 + 编译验证 |
| 单进程中引擎全局状态冲突 | 高 | 低 | 引擎初始化隔离在 EngineAdapter 中 |

---

## 预估工作量

| Phase | 任务数 | 预估 |
|-------|--------|------|
| Phase 0 | 1 | 0.5h |
| Phase 1 | 3 | 8-12h（主要在修复 import 断裂） |
| Phase 2 | 4 | 3-4h |
| Phase 3 | 3 | 12-16h（核心重构） |
| Phase 4 | 1 | 1-2h |
| Phase 5 | 3 | 2-3h |
| Phase 6 | 2 | 1-2h |
| Phase 7 | 3 | 2-3h |
| Phase 8 | 4 | 4-6h |
| **Total** | **24** | **~35-50h** |
