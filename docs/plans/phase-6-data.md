# Phase 6: 状态目录和数据迁移（中风险）

> **状态:** 待执行 | **预估:** 1-2h | **依赖:** Phase 0
> **可与 Phase 1/2/3 并行执行**

---

## Task 6.1: 创建 .octopus-state 目录结构

**Step 1: 从旧项目复制并重命名**

```bash
# 只复制结构和配置模板，不复制运行时数据
mkdir -p .octopus-state
```

**Step 2: 创建配置模板 .octopus-state/octopus.json**

从 `.openclaw-state/openclaw.json` 复制，替换所有 `openclaw` → `octopus`。

关键替换项：
- `gateway.auth.token` → 保持值不变（只改环境变量名）
- `plugins.load.paths` → `["./plugins/"]`
- `tools.sandbox.tools.allow` → `["*"]`（必须是数组）
- `sandbox.image` → `octopus-sandbox:enterprise`

**Step 3: 更新 .gitignore 中的路径**

```
.octopus-state/logs/
.octopus-state/completions/
.octopus-state/subagents/
.octopus-state/canvas/
.octopus-state/devices/
.octopus-state/agents/
.octopus-state/memory/
.octopus-state/cron/
.octopus-state/identity/
.octopus-state/sandbox/
.octopus-state/workspace/
.octopus-state/octopus.json
.octopus-state/octopus.json.bak*
.octopus-state/plugins/
```

**Step 4: Commit**

```bash
git add .octopus-state/ .gitignore
git commit -m "feat: .octopus-state 目录结构和配置模板"
```

---

## Task 6.2: 数据目录

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
