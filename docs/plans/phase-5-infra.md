# Phase 5: 基础设施和脚本（中风险）

> **状态:** 待执行 | **预估:** 2-3h | **依赖:** Phase 3

---

## Task 5.1: 创建 Docker 配置

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

---

## Task 5.2: 创建启动脚本

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
chmod +x start.sh octopus.mjs
git add start.sh octopus.mjs
git commit -m "feat: 启动脚本 start.sh + CLI 入口 octopus.mjs"
```

---

## Task 5.3: 创建部署配置

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

**Step 2: 修改 ecosystem.config.js**

删除 native gateway 进程配置，只保留一个 server 进程。

**Step 3: Commit**

```bash
git add deploy/ scripts/ ecosystem.config.js
git commit -m "feat: 部署配置（systemd, pm2, 迁移脚本）"
```
