# Phase 1: 引入原生引擎核心（高风险）

> **状态:** 待执行 | **预估:** 8-12h | **依赖:** Phase 0
> **主要风险:** 删除模块后 import 断裂，需逐个修复

---

## Task 1.1: 创建 @octopus/engine 包 — 复制原生核心源码

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
mkdir -p packages/engine/src

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

# 浏览器自动化（企业内网不需要）
rm -rf packages/engine/src/browser/

# Terminal UI（企业版用 web 控制台）
rm -rf packages/engine/src/terminal/

# Media（可选，先删后看）
rm -rf packages/engine/src/media-understanding/
rm -rf packages/engine/src/media/
rm -rf packages/engine/src/tts/
rm -rf packages/engine/src/markdown/
```

**Step 4: 处理被删除模块的 import 引用**

删除上述目录后，engine 内部会有断裂的 import。需要：
1. Grep 搜索 `from '../channels/`、`from '../cli/`、`from '../browser/`、`from '../terminal/`、`from '../media` 等引用
2. 创建 stub 模块或条件 import 替换
3. 这是最复杂的步骤，需要逐个文件处理

**Step 5: Commit**

```bash
git add packages/engine/
git commit -m "feat: 引入原生引擎核心源码为 @octopus/engine"
```

---

## Task 1.2: 复制原生依赖并确保 TypeScript 编译通过

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

---

## Task 1.3: 全局品牌替换 — engine 包内 openclaw → octopus

**Step 1: 替换所有字符串引用**

```bash
cd packages/engine/src

# 配置文件名
find . -type f -name "*.ts" -exec sed -i 's/openclaw\.json/octopus.json/g' {} +
find . -type f -name "*.ts" -exec sed -i 's/openclaw\.plugin\.json/octopus.plugin.json/g' {} +

# 环境变量
find . -type f -name "*.ts" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +

# 类名和标识符
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
