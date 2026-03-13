# Phase 2: 迁移企业层代码（中风险）

> **状态:** 待执行 | **预估:** 3-4h | **依赖:** Phase 0
> **可与 Phase 1 并行执行**

---

## Task 2.1: 迁移企业包 — packages/

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
  sed -i "s/@openclaw-enterprise\/${pkg}/@octopus\/${pkg}/g" packages/${pkg}/package.json
done
```

**Step 2: 全局替换 import 路径**

```bash
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

---

## Task 2.2: 迁移 Prisma schema 和数据库

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

---

## Task 2.3: 迁移 Plugin

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

---

## Task 2.4: 迁移渠道插件

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
