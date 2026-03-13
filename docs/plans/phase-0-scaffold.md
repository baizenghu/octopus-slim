# Phase 0: 项目脚手架（无风险）

> **状态:** 待执行 | **预估:** 0.5h | **依赖:** 无

---

## Task 0.1: 初始化 monorepo 基础设施

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
