# Phase 4: 迁移前端 Admin Console（低风险）

> **状态:** 待执行 | **预估:** 1-2h | **依赖:** Phase 0
> **可与 Phase 1/2/3 并行执行**

---

## Task 4.1: 复制并重命名 Admin Console

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
find apps/console/src \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/OpenClaw/Octopus/g' {} +
find apps/console/src \( -name "*.tsx" -o -name "*.ts" \) -exec sed -i 's/openclaw/octopus/g' {} +

# API 地址（如果有硬编码的 OPENCLAW_ 环境变量）
find apps/console/src \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +
```

**Step 3: Commit**

```bash
git add apps/console/
git commit -m "feat: 迁移 Admin Console 为 @octopus/console"
```
