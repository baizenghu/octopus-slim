# Octopus Enterprise 内网部署指南

> 适用场景：国企内网，无外网访问，离线部署。
> 编写时间：2026-02-28
> 最后更新：2026-03-03

---

## 一、部署全景

```
开发机（本机）                         公司服务器（目标机）
─────────────────────────────          ─────────────────────────────
GitHub 仓库                →  git clone
octopus 二进制 (2.1GB)    →  U盘/内网文件共享
Docker 镜像 (1.35GB)      →  U盘/内网文件共享
插件目录 (570MB)           →  U盘/内网文件共享
─────────────────────────────          ─────────────────────────────
```

传输方式：U 盘、内网 scp、或内网 HTTP 文件服务器。

### 服务端口一览

| 服务 | 默认端口 | 环境变量 | 说明 |
|------|---------|---------|------|
| Enterprise Gateway | 18790 | `GATEWAY_PORT` | 企业 API 网关（对外主入口） |
| Native Octopus Gateway | 19791 | `OCTOPUS_NATIVE_PORT` | 原生 Agent 引擎（内部 WebSocket RPC） |
| Admin Console | 3001 | `ADMIN_CONSOLE_PORT` | 管理后台前端（React） |

---

## 二、服务器前提条件

| 依赖 | 版本要求 | 检查命令 |
|------|---------|---------|
| Node.js | 22.x LTS | `node --version` |
| pnpm | 9.x | `pnpm --version` |
| MySQL | 8.0 | `mysql --version` |
| Docker | 20+ | `docker --version` |

### 安装 Node.js（如未安装）

```bash
# 方法1: 用 fnm（推荐）
curl -fsSL https://fnm.vercel.app/install | bash
fnm install 22
fnm use 22

# 方法2: 直接下包（内网）
# 从 https://nodejs.org/dist/v22.x.x/ 下载 linux-x64.tar.xz
tar -xf node-v22.x.x-linux-x64.tar.xz
sudo mv node-v22.x.x-linux-x64 /usr/local/node
echo 'export PATH=/usr/local/node/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

### 安装 pnpm

```bash
npm install -g pnpm
```

---

## 三、第一步：打包（在开发机上执行）

### 3.1 打包 Docker 镜像

```bash
# 导出镜像（约 308MB 压缩后）
sg docker -c "docker save octopus-sandbox:enterprise | gzip > /tmp/octopus-sandbox.tar.gz"

# 查看大小
ls -lh /tmp/octopus-sandbox.tar.gz
```

### 3.2 打包 octopus 二进制

```bash
# 打包整个 octopus-main 目录（约 2.1GB，压缩后约 500-800MB）
tar -czf /tmp/octopus-main.tar.gz -C /home/baizh octopus-main/
ls -lh /tmp/octopus-main.tar.gz
```

### 3.3 打包 octopus 插件和扩展

> **注意**：自 2026-03-02 起，插件和 state 目录已迁移到项目目录内：
> - 插件目录：`./plugins/`
> - State 目录：`./.octopus-state/`
> - `~/.octopus` 仅作为指向 `.octopus-state/` 的软链接（向后兼容）

```bash
# 打包项目内的 state 目录（config + extensions）
tar -czf /tmp/octopus-state.tar.gz \
  -C /home/baizh/octopus \
  .octopus-state/octopus.json \
  .octopus-state/extensions/ \
  plugins/

ls -lh /tmp/octopus-state.tar.gz
```

### 3.4 所有需要传输的文件汇总

| 文件 | 大小（约） | 说明 |
|------|-----------|------|
| `octopus-sandbox.tar.gz` | 308MB | Docker 沙箱镜像 |
| `octopus-main.tar.gz` | 500-800MB | octopus 二进制 |
| `octopus-state.tar.gz` | 570MB | State 配置 + 插件 + 扩展 |
| GitHub 仓库（git clone） | 约 5MB | 源代码 |

---

## 四、第二步：目标服务器初始化

### 4.1 拉取源码

```bash
# 如果公司服务器可以访问 GitHub（有代理）
git clone https://github.com/baizenghu/octopus.git
cd octopus

# 如果完全内网，把仓库打包传过去
# 开发机: tar -czf /tmp/octopus-src.tar.gz -C /home/baizh octopus/
# 目标机: tar -xzf octopus-src.tar.gz && cd octopus
```

### 4.2 解压 octopus 二进制

```bash
# 解压到 /home/<user>/octopus-main/
tar -xzf octopus-main.tar.gz -C /home/$USER/
chmod +x /home/$USER/octopus-main/octopus.mjs

# 验证
node /home/$USER/octopus-main/octopus.mjs --version
```

### 4.3 解压插件和 State 配置

```bash
cd /home/$USER/octopus

# 解压 state 目录和插件到项目目录内
tar -xzf /tmp/octopus-state.tar.gz -C .

# 创建向后兼容软链接
ln -sfn /home/$USER/octopus/.octopus-state /home/$USER/.octopus
```

### 4.4 加载 Docker 镜像

```bash
# 加载镜像
docker load < octopus-sandbox.tar.gz

# 验证
docker images octopus-sandbox
# 应显示: octopus-sandbox   enterprise   ...
```

### 4.5 创建 Docker 内部网络（隔离沙箱）

```bash
cd /home/$USER/octopus

# 检查网络是否已存在
docker network ls | grep octopus-internal

# 如不存在则创建
docker network create --internal octopus-internal
```

---

## 五、第三步：配置环境

### 5.1 创建 MySQL 数据库

```bash
# 以 root 登录 MySQL
mysql -u root -p

# 在 MySQL 中执行：
CREATE DATABASE octopus_enterprise CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'octopus'@'localhost' IDENTIFIED BY '你的强密码';
GRANT ALL PRIVILEGES ON octopus_enterprise.* TO 'octopus'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 5.2 配置 .env

```bash
cd /home/$USER/octopus
cp .env.example .env
nano .env  # 或 vim .env
```

**必须修改的配置项：**

```env
# 数据库（填写你刚创建的密码）
DB_USER=octopus
DB_PASSWORD=你的强密码
DB_NAME=octopus_enterprise
DATABASE_URL="mysql://octopus:你的强密码@localhost:3306/octopus_enterprise"

# JWT（必须改，不少于32个字符的随机字符串）
JWT_SECRET=请生成一个足够长的随机字符串至少32位

# AI 模型（填写内网 DeepSeek 代理地址）
OPENAI_API_BASE=http://内网代理IP:端口/v1
OPENAI_API_KEY=你的API密钥
OPENAI_MODEL=deepseek-chat

# 服务端口
GATEWAY_PORT=18790
OCTOPUS_NATIVE_PORT=19791
ADMIN_CONSOLE_PORT=3001

# 原生 Gateway 通信 Token（必须与 octopus.json 中 gateway.auth.token 一致）
OCTOPUS_GATEWAY_TOKEN=<GATEWAY_TOKEN>

# 数据目录（企业数据：技能、用户 workspace、审计日志）
# 默认 ./data/，生产环境可改为绝对路径
DATA_ROOT=/home/$USER/octopus/data
```

**生成 JWT_SECRET 的方法：**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 5.3 State 目录说明（重要变更）

> **自 2026-03-02 起**，Native Gateway 的 state 目录已从 `~/.octopus/` 迁移到项目目录内的 `.octopus-state/`。

**目录位置**：`<项目根>/.octopus-state/`

**如何指定**：`start-dev.sh` 通过以下环境变量覆盖默认路径：

```bash
export OCTOPUS_STATE_DIR=/home/$USER/octopus/.octopus-state
export OCTOPUS_HOME=/home/$USER/octopus/.octopus-state
```

**向后兼容**：`~/.octopus` 保留为指向 `.octopus-state/` 的软链接：

```bash
ln -sfn /home/$USER/octopus/.octopus-state /home/$USER/.octopus
```

### 5.4 配置 octopus.json（Native Gateway 配置）

```bash
# 配置文件现在位于项目目录内
nano /home/$USER/octopus/.octopus-state/octopus.json
```

**必须修改的内容：**

```json
{
  "gateway": {
    "port": 19791,
    "auth": {
      "mode": "token",
      "token": "你的token（要和.env中OCTOPUS_GATEWAY_TOKEN一致）"
    }
  },
  "models": {
    "providers": [
      {
        "type": "openai-compatible",
        "baseUrl": "http://内网代理IP:端口/v1",
        "apiKey": "你的API密钥",
        "models": ["deepseek-chat"]
      }
    ]
  },
  "plugins": {
    "load": {
      "paths": ["/home/你的用户名/octopus/plugins"]
    }
  },
  "skills": {
    "load": {
      "extraDirs": ["/home/你的用户名/octopus/data/skills"]
    }
  },
  "tools": {
    "exec": { "host": "sandbox" },
    "fs": { "workspaceOnly": true }
  },
  "sandbox": {
    "mode": "all",
    "scope": "agent"
  }
}
```

**注意：把 `/home/你的用户名/` 全部替换为实际路径**

```bash
# 批量替换路径（把 baizh 替换为实际用户名）
sed -i 's|/home/baizh/|/home/'$USER'/|g' \
  /home/$USER/octopus/.octopus-state/octopus.json
```

### 5.5 Plugin 加载路径

Native Gateway 从以下两个路径加载插件：

| 路径 | 内容 | 说明 |
|------|------|------|
| `./plugins/` | 企业自研插件 | `enterprise-audit`、`enterprise-mcp` |
| `./.octopus-state/extensions/` | 第三方扩展 | `memory-lancedb-pro` 等 |

在 `octopus.json` 中配置：

```json
{
  "plugins": {
    "load": {
      "paths": ["/home/你的用户名/octopus/plugins"]
    }
  }
}
```

`extensions/` 目录由 Native Gateway 自动发现（位于 state 目录下），无需额外配置。

### 5.6 Docker Sandbox 配置

Docker Sandbox 用于安全执行用户 agent 的 bash/exec 命令，每个 agent 在独立容器内运行。

**构建镜像**：

```bash
cd docker/sandbox
./build.sh
# 生成镜像: octopus-sandbox:enterprise
```

**创建隔离网络**：

```bash
# 创建内部网络（iptables 封锁公网出口）
cd docker/sandbox
./setup-network.sh
# 创建网络: octopus-internal (172.30.0.0/16)
```

**关键参数**：

| 配置项 | 值 | 说明 |
|--------|---|------|
| `tools.exec.host` | `"sandbox"` | exec 在 Docker 容器内执行 |
| `sandbox.mode` | `"all"` | 所有 exec 均走沙箱 |
| `sandbox.scope` | `"agent"` | 每个 agent 独立容器 |
| 容器用户 UID | 2000 | 非宿主机 uid=1000，防止 bind mount 权限穿透 |
| Docker 网络 | `octopus-internal` | bridge 172.30.0.0/16，iptables 封锁公网 |
| Workspace 挂载 | `data/users/{userId}/workspace/` | 容器只能访问该 agent 的工作目录 |

**注意**：Workspace 目录需要 `chmod a+w`，因为容器内 uid=2000 需要写入权限。

### 5.7 dataRoot 配置说明

`DATA_ROOT` 环境变量控制企业网关的数据目录，默认值为 `./data/`。

```
$DATA_ROOT (默认 ./data/)
├── users/
│   └── {userId}/
│       ├── workspace/           # 用户默认工作空间
│       └── agents/
│           └── {agentName}/
│               └── workspace/   # 专业 agent 工作空间
├── skills/                      # 企业级技能存储
└── audit-logs/                  # 审计日志文件（JSONL）
```

生产环境建议设为独立磁盘挂载点，例如 `DATA_ROOT=/opt/octopus-data`。

### 5.8 userEnv 功能说明

用户可以通过 API 管理个人 `.env` 文件，用于配置 MCP Server 所需的环境变量（如 API Key）。

**API 路由**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/mcp/env/:userId` | 获取用户的 env 配置（键值对） |
| PUT | `/api/mcp/env/:userId` | 更新用户的 env 配置 |

**存储位置**：`$DATA_ROOT/users/{userId}/.env`

**用途**：MCP Server 的 stdio 进程启动时，会加载对应用户的 `.env` 文件作为环境变量注入，使不同用户可以使用各自的 API Key 访问同一个 MCP 服务。

---

## 六、第四步：安装依赖 & 初始化数据库

```bash
cd /home/$USER/octopus

# 安装依赖（内网需要确保 npm registry 可访问，或配置内网镜像）
pnpm install

# 初始化数据库表结构（不需要 migrations，直接 push）
cd apps/gateway
npx prisma db push
cd ../..
```

**如果 npm registry 不通，配置内网镜像：**
```bash
# 临时使用淘宝镜像（如果内网能访问）
pnpm config set registry https://registry.npmmirror.com

# 或配置公司内网 npm 私服
pnpm config set registry http://内网nexus地址/repository/npm-proxy/
```

---

## 七、第五步：启动服务

```bash
cd /home/$USER/octopus

# 方法1: 开发模式（前台运行，调试用）
./start-dev.sh start

# 验证服务状态
curl http://localhost:18790/health
# 期望: {"status":"ok",...}

# 方法2: 生产模式（后台运行）
# 先 build
pnpm run build

# 用 pm2（需要先安装: npm install -g pm2）
pm2 start apps/gateway/dist/index.js --name octopus-gateway
pm2 start /home/$USER/octopus-main/octopus.mjs \
  --name octopus-native \
  --interpreter node \
  -- --profile enterprise gateway --port 19791
pm2 save
pm2 startup  # 设置开机自启

# 注意: pm2 启动时也需要设置环境变量
# OCTOPUS_STATE_DIR=/home/$USER/octopus/.octopus-state
# OCTOPUS_HOME=/home/$USER/octopus/.octopus-state
```

---

## 八、验证部署

```bash
# 1. Gateway 健康检查
curl http://localhost:18790/health

# 2. 登录测试（默认管理员）
curl -X POST http://localhost:18790/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password123"}'

# 3. 浏览器访问管理界面
# 打开: http://服务器IP:18790
# （admin-console 由 gateway 静态文件服务）
```

---

## 九、常见问题

### 问题1: `pnpm install` 失败（内网无法访问 npm）

```bash
# 在开发机上打包 node_modules 传过去
cd /home/baizh/octopus
tar -czf /tmp/node_modules.tar.gz node_modules/ apps/*/node_modules/ packages/*/node_modules/
# 传到目标机解压即可，不需要再 pnpm install
```

### 问题2: MySQL 插件报错（enterprise-audit plugin）

```bash
# 检查 MySQL 连接
mysql -u octopus -p octopus_enterprise -e "SHOW TABLES;"

# 检查 plugin 的数据库配置
cat /home/$USER/.octopus/plugins/enterprise-audit/package.json | grep DATABASE
```

### 问题3: octopus-sandbox Docker 容器无法运行

```bash
# 检查镜像是否加载成功
docker images | grep octopus-sandbox

# 检查内部网络
docker network ls | grep octopus-internal

# 手动测试沙箱
docker run --rm --network octopus-internal octopus-sandbox:enterprise echo "sandbox ok"
```

### 问题4: 端口冲突

```bash
# 检查端口占用
ss -tlnp | grep -E "18790|19791"

# 修改端口（改 .env 中 GATEWAY_PORT 和 start-dev.sh 中的参数）
```

### 问题5: 路径中 baizh 未替换

```bash
# 搜索所有还包含 /home/baizh/ 的配置
grep -r "/home/baizh" \
  /home/$USER/.octopus/.octopus/octopus.json \
  /home/$USER/octopus/.env
```

---

## 十、文件传输快速参考

```bash
# === 开发机：一键打包所有文件 ===
cd /tmp

# 1. Docker 镜像
sg docker -c "docker save octopus-sandbox:enterprise | gzip > octopus-sandbox.tar.gz"

# 2. octopus 二进制
tar -czf octopus-main.tar.gz -C /home/baizh octopus-main/

# 3. State + 插件（已迁移到项目目录内）
tar -czf octopus-state.tar.gz \
  -C /home/baizh/octopus \
  .octopus-state/octopus.json \
  .octopus-state/extensions/ \
  plugins/

# 列出待传文件
ls -lh /tmp/octopus-*.tar.gz

# === 使用 scp 传输到目标服务器（如果有网络）===
scp /tmp/octopus-*.tar.gz user@目标服务器IP:/tmp/
```
