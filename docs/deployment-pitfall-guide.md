# Octopus Enterprise 内网部署闭坑指南

> 面向内部运维同事，记录部署过程中的已知坑和排查方法。
>
> 最后更新：2026-03-03

---

## 一、环境依赖检查清单

部署前确认以下组件已就绪：

| 依赖 | 最低版本 | 检查命令 | 备注 |
|------|---------|---------|------|
| Node.js | 22.0.0 | `node -v` | 推荐 22.14 LTS |
| pnpm | 9.0.0 | `pnpm -v` | `npm i -g pnpm` 安装 |
| MySQL | 8.0 | `mysql --version` | 或用 Docker 启动 |
| Redis | 7.x | `redis-cli --version` | 或用 Docker 启动 |
| octopus | 最新 | `octopus --version` | `npm i -g octopus` |
| Docker（可选） | 20.x | `docker --version` | 仅 sandbox 模式需要 |

### 内网无外网时的依赖准备

内网服务器无法 `npm install`，需提前在有网环境打包：

```bash
# 在有网机器上
cd octopus
pnpm install
tar czf node_modules.tar.gz node_modules/ apps/*/node_modules/ packages/*/node_modules/

# octopus 全局包
npm pack -g octopus  # 生成 .tgz
# 或直接拷贝 $(npm root -g)/octopus 目录

# 拷贝到内网后
tar xzf node_modules.tar.gz
npm i -g octopus-2026.x.x.tgz
```

如果内网有 npm 私有 registry（如 Verdaccio/Nexus），配置 `.npmrc`：

```ini
registry=http://your-internal-registry:4873/
```

---

## 二、octopus 安装与 profile 隔离

### 核心概念

octopus 通过 `--profile` 参数实现环境隔离：

| | 个人使用 | 企业版 |
|---|---|---|
| profile | 默认 | `enterprise` |
| 数据目录 | `~/.octopus/` | `.octopus-state/`（项目内） |
| 配置文件 | `~/.octopus/octopus.json` | `.octopus-state/octopus.json` |
| 默认端口 | 18080 | 18791 |

**共享的是同一个 octopus 二进制**，所以 `npm update -g octopus` 会同时影响两个环境。

### 首次初始化 enterprise profile

```bash
# 初始化 profile（会创建 .octopus-state/ 目录）
octopus --profile enterprise onboard

# 然后手动编辑配置
vim .octopus-state/octopus.json
```

关键配置项（参考下文第四节）。

---

## 三、共享包构建（最常踩的坑）

### 问题描述

项目使用 monorepo，`apps/gateway` 依赖 `packages/enterprise-*` 下的 6 个共享包。这些包用 TypeScript 编写，gateway 通过 `dist/index.js` 引用编译后的产物。

**如果 `dist/` 目录不存在，gateway 启动时报错：**

```
Error: Cannot find module '@octopus/audit/dist/index.js'
```

### 什么时候 dist 会丢失？

1. **`npm update -g octopus`** — 更新 octopus 会触发 `node_modules` 重装，workspace 链接重建，部分包的 `dist/` 被清理
2. **`pnpm install`** — 重新安装依赖后，symlink 重建可能导致 dist 丢失
3. **首次 clone 项目** — 代码仓库不提交 `dist/`（在 `.gitignore` 中）
4. **`pnpm clean`** — 会执行 `rm -rf dist`

### 解决方法

**每次安装/更新依赖后，必须构建共享包：**

```bash
# 逐个构建（推荐，能看到具体哪个包失败）
for pkg in packages/enterprise-*/; do
  [ -f "$pkg/tsconfig.json" ] || continue
  echo "Building $(basename $pkg)..."
  (cd "$pkg" && npx tsc)
done

# 或用 turbo 一键构建
pnpm build
```

### 验证构建成功

```bash
# 检查所有包都有 dist/
for pkg in packages/enterprise-*/; do
  name=$(basename "$pkg")
  if [ -f "$pkg/tsconfig.json" ] && [ ! -d "$pkg/dist" ]; then
    echo "MISSING: $name"
  else
    echo "OK: $name"
  fi
done
```

预期输出全部为 `OK`：

```
OK: enterprise-audit
OK: enterprise-auth
OK: enterprise-database
OK: enterprise-mcp
OK: enterprise-quota
OK: enterprise-rag
OK: enterprise-skills
OK: enterprise-workspace
```

---

## 四、配置文件说明

### 4.1 `.env` 文件

项目根目录的 `.env`，Enterprise Gateway 读取：

```bash
# ===== 必须配置 =====
DATABASE_URL="mysql://user:pass@host:3306/octopus_enterprise"  # Prisma 连接串
JWT_SECRET=至少32字符的随机字符串                                  # 生产环境必须改
OCTOPUS_GATEWAY_TOKEN=<GATEWAY_TOKEN>             # 与原生 gateway 通信的 token

# ===== 端口 =====
GATEWAY_PORT=18790          # Enterprise Gateway 端口
ADMIN_CONSOLE_PORT=3001     # 管理后台端口
OCTOPUS_NATIVE_PORT=19791  # 原生 Gateway 端口（不要和个人使用的冲突）

# ===== AI 模型 =====
OPENAI_API_BASE=https://api.deepseek.com    # 或内网代理地址
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=deepseek-chat

# ===== LDAP/AD =====
LDAP_MOCK_ENABLED=true      # 开发/测试用 MockLDAP；生产环境改 false 并配真实 LDAP
LDAP_URL=ldap://your-ad-server:389
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_PASSWORD=xxx
LDAP_SEARCH_BASE=ou=users,dc=example,dc=com

# ===== 数据目录 =====
DATA_ROOT=/opt/octopus-data  # 企业网关数据（技能、用户 workspace、审计文件）
```

### 4.2 `.octopus-state/octopus.json`

原生 Gateway 的配置。**最关键的几项：**

```jsonc
{
  "models": {
    "providers": {
      "custom-api-deepseek-com": {
        "baseUrl": "https://api.deepseek.com/v1",  // 内网换成代理地址
        "apiKey": "sk-xxx"
      }
    }
  },
  "gateway": {
    "port": 18791,
    "auth": {
      "mode": "token",
      "token": "<GATEWAY_TOKEN>"  // ← 必须和 .env 中 OCTOPUS_GATEWAY_TOKEN 一致！
    }
  },
  "tools": {
    "exec": { "host": "gateway", "security": "deny" },  // 禁止 shell 执行
    "fs": { "workspaceOnly": true }                      // 限制文件访问范围
  }
}
```

### 4.3 Token 一致性（重要）

`.env` 中的 `OCTOPUS_GATEWAY_TOKEN` 和 `octopus.json` 中的 `gateway.auth.token` **必须完全一致**，否则 Enterprise Gateway 连不上原生 Gateway，报错：

```
WebSocket connection failed: authentication failed
```

### 4.4 模型 API 地址

内网部署时，`baseUrl` 需要改为内网代理地址或私有化部署地址：

```jsonc
// 内网代理 DeepSeek
"baseUrl": "http://10.x.x.x:8080/v1"

// 私有化部署 Qwen
"baseUrl": "http://gpu-server:8000/v1"
```

同时 `.env` 中的 `OPENAI_API_BASE` 也要对应修改。

---

## 五、数据库初始化

### 方式一：Docker Compose（推荐开发/测试）

```bash
# 启动 MySQL + Redis
docker compose -f docker/docker-compose.dev.yml up -d

# 检查服务就绪
docker compose -f docker/docker-compose.dev.yml ps
```

### 方式二：使用现有 MySQL 实例

确保 `.env` 中 `DATABASE_URL` 指向正确的 MySQL 实例。

### 初始化表结构

```bash
# 生成 Prisma Client
npx prisma generate --schema=prisma/schema.prisma

# 推送表结构到数据库（首次部署）
npx prisma db push --schema=prisma/schema.prisma

# 或使用 migrate（有历史迁移记录）
npx prisma migrate deploy --schema=prisma/schema.prisma
```

### 验证数据库

```bash
# 打开 Prisma Studio 查看表
npx prisma studio --schema=prisma/schema.prisma

# 或直接连接 MySQL
mysql -u octopus -p octopus_enterprise -e "SHOW TABLES;"
```

预期看到：`users`, `audit_logs`, `user_sessions`, `skills`, `agents`, `mcp_servers`, `im_channels`, `im_user_bindings`, `scheduled_tasks`, `mail_logs`

---

## 六、服务启动与验证

### 开发环境

```bash
# 一键启动全部（Native Gateway + Enterprise Gateway + Admin Console）
./start-dev.sh start

# 停止
./start-dev.sh stop

# 查看状态
./start-dev.sh status

# 查看日志
./start-dev.sh logs              # 全部
./start-dev.sh logs native       # 原生 gateway
./start-dev.sh logs gateway      # 企业 gateway
./start-dev.sh logs admin        # 管理后台
```

### 生产环境（systemd 示例）

```ini
# /etc/systemd/system/octopus-native.service
[Unit]
Description=Octopus Native Gateway
After=network.target mysql.service

[Service]
Type=simple
User=octopus
Environment=OCTOPUS_GATEWAY_TOKEN=your-production-token
ExecStart=/usr/local/bin/octopus --profile enterprise gateway --port 18791 --token your-production-token
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/octopus.service
[Unit]
Description=Octopus Enterprise Gateway
After=octopus-native.service mysql.service redis.service

[Service]
Type=simple
User=octopus
WorkingDirectory=/opt/octopus
EnvironmentFile=/opt/octopus/.env
ExecStart=/usr/local/bin/node apps/gateway/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 启动后验证

```bash
# 1. 原生 Gateway 健康检查
curl http://localhost:18791/health
# 预期: {"status":"ok","uptime":...}

# 2. Enterprise Gateway 健康检查
curl http://localhost:18790/health
# 预期: {"status":"ok",...}

# 3. 登录测试（MockLDAP 模式）
curl -X POST http://localhost:18790/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"password123"}'
# 预期: {"token":"eyJ...","user":{...}}
```

---

## 七、常见报错排查表

| 错误信息 | 原因 | 解决 |
|---------|------|------|
| `Cannot find module '@octopus/xxx/dist/index.js'` | 共享包未构建 | 参考第三节，构建所有 enterprise 包 |
| `WebSocket connection failed` / `ECONNREFUSED :18791` | 原生 Gateway 未启动或端口被占 | 检查原生 gateway 进程，看 `.dev-logs/native-gateway.log` |
| `authentication failed` (WebSocket) | Token 不一致 | 确保 `.env` 的 `OCTOPUS_GATEWAY_TOKEN` 和 `octopus.json` 的 `gateway.auth.token` 完全一致 |
| `Can't reach database server` | MySQL 未启动或连接串错误 | 检查 `DATABASE_URL` 格式，确认 MySQL 可达 |
| `Table 'xxx' doesn't exist` | 数据库未初始化表结构 | 运行 `npx prisma db push --schema=prisma/schema.prisma` |
| `EADDRINUSE :::18790` | 端口被占用 | `lsof -i :18790` 找到占用进程并处理 |
| `Error: LDAP bind failed` | LDAP 配置错误或服务不可达 | 检查 LDAP_URL/BIND_DN/BIND_PASSWORD；开发环境设 `LDAP_MOCK_ENABLED=true` |
| `model not found` / 模型调用 500 | 模型 API 地址不通或 key 无效 | 检查 `octopus.json` 中 `models.providers.*.baseUrl` 是否可达 |
| `Parameter 'xxx' implicitly has an 'any' type` | TypeScript 编译错误 | 给 callback 参数加 `any` 类型注解，重新 `npx tsc` |
| `OCTOPUS_CONFIG_PATH` 相关错误 | 使用了已废弃的配置注入方式 | **永远不要用 `OCTOPUS_CONFIG_PATH`**，只用 `--profile enterprise` |
| `Unique constraint failed on fields: (server_id)` | MCPRegistry 与路由并发 `prisma.create()` 主键冲突 | `MCPRegistry.register()` 改用 `upsert`（参见第十五节） |
| `plugin register returned a promise` | Plugin 入口函数是 `async` | 改为同步函数，异步初始化用 `.then()`（参见第十六节） |
| `P1012: Property "url" is not allowed in datasource block` | 全局 Prisma 为 v7，不兼容 v6 schema | 用项目本地 `node_modules/.bin/prisma`，pin v6（参见第十七节） |
| `config changed, restarting...` 频繁出现 | `memory-lancedb-pro` 写 `octopus.json` 触发 watcher | 正常行为，supervisor 自动重启（参见第十九、二十节） |
| `configApply` 调用后配置未生效 | RPC 参数格式错误 | 必须用 `{ raw: JSON.stringify(patch) }` 格式（参见第十八节） |

---

## 八、octopus 版本升级流程

升级 octopus 影响两个环境（个人 + 企业），需要按步骤操作：

```bash
# 1. 停止企业版服务
./start-dev.sh stop

# 2. 升级 octopus
npm update -g octopus

# 3. 确认新版本
octopus --version

# 4. 重新构建共享包（升级可能导致 dist 被清理）
for pkg in packages/enterprise-*/; do
  [ -f "$pkg/tsconfig.json" ] || continue
  (cd "$pkg" && npx tsc)
done

# 5. 重新安装项目依赖（如果 octopus 也是项目依赖）
pnpm install

# 6. 重新构建共享包（pnpm install 可能再次清理 dist）
for pkg in packages/enterprise-*/; do
  [ -f "$pkg/tsconfig.json" ] || continue
  (cd "$pkg" && npx tsc)
done

# 7. 启动服务
./start-dev.sh start

# 8. 验证
curl http://localhost:18791/health
curl http://localhost:18790/health
```

### 版本锁定

`package.json` 中锁定了 octopus 版本：

```json
"dependencies": {
  "octopus": "2026.2.19"
}
```

全局安装的 octopus 版本和项目依赖中的版本可能不一致。`start-dev.sh` 使用的是项目本地的 `node_modules/.bin/octopus`，所以以 `package.json` 中的版本为准。更新时两边都要考虑。

---

## 九、内网特殊限制与应对

### 9.1 无外网访问

| 需要外网的操作 | 内网替代方案 |
|--------------|------------|
| `npm install` | 提前打包 `node_modules.tar.gz` 或搭建内网 npm registry |
| `npm update -g octopus` | 拷贝 `.tgz` 包，`npm i -g octopus-xxx.tgz` |
| Docker pull 镜像 | `docker save/load` 导入 MySQL/Redis 镜像 |
| 模型 API 调用 | 使用内网代理或私有化部署模型 |
| Prisma engine 下载 | 提前在有网环境 `npx prisma generate`，拷贝 `node_modules/.prisma/` |

### 9.2 Docker 镜像离线导入

```bash
# 有网机器
docker pull mysql:8.0
docker pull redis:7-alpine
docker save mysql:8.0 redis:7-alpine | gzip > images.tar.gz

# 内网机器
gunzip -c images.tar.gz | docker load
```

### 9.3 Prisma Engine 问题

Prisma 首次 generate 会下载平台相关的 query engine 二进制。内网无法下载，需提前准备：

```bash
# 有网机器上 generate 后，拷贝以下目录到内网
node_modules/.prisma/
node_modules/@prisma/engines/
```

或设置环境变量指向本地 engine：

```bash
export PRISMA_QUERY_ENGINE_BINARY=/path/to/prisma-query-engine
```

### 9.4 octopus 内置功能在内网不可用

以下功能需要在 `octopus.json` 中禁用，否则会超时或报错：

```jsonc
{
  "skills": {
    "entries": {
      "weather": { "enabled": false },           // 需要外网 API
      "openai-image-gen": { "enabled": false },   // 需要 OpenAI API
      "openai-whisper-api": { "enabled": false }  // 需要 OpenAI API
    }
  }
}
```

---

## 十、数据目录结构

部署后有两个独立的数据目录，运维需要了解：

```
.octopus-state/                 ← 原生 Gateway State（项目内，随 git 版本控制）
├── octopus.json                   配置文件（不要手动删除，可编辑）
├── agents/                         Agent 状态、对话历史
│   └── ent_{userId}_{agentName}/
│       ├── agent/                  IDENTITY.md, SOUL.md
│       └── sessions/              会话 JSONL 文件
├── extensions/                     第三方扩展（memory-lancedb-pro）
├── memory/                         记忆向量数据
├── workspace/                      默认工作目录
├── cron/                           定时任务数据
├── logs/                           原生日志（已 gitignore）
├── completions/                    补全缓存（已 gitignore）
└── subagents/                      子 agent 临时数据（已 gitignore）

$DATA_ROOT (默认 ./data/)        ← 企业 Gateway 数据
├── users/
│   └── {userId}/
│       └── workspace/              用户隔离的文件空间
├── skills/                         企业级技能存储
└── audit-logs/                     审计日志文件
```

**备份要点**：整个项目目录即可（含 `.octopus-state/`）。MySQL 数据库另外单独备份。
**注**：`~/.octopus` 是指向 `.octopus-state/` 的软链接，向后兼容。

---

## 附录：部署一页纸速查

```
┌─ 部署步骤 ──────────────────────────────────────┐
│                                                   │
│  1. 装 Node.js 22 + pnpm 9                       │
│  2. npm i -g octopus                             │
│  3. octopus --profile enterprise onboard         │
│  4. 编辑 .octopus-state/octopus.json             │
│  5. 启动 MySQL + Redis                            │
│  6. cp .env.example .env && vim .env              │
│  7. pnpm install                                  │
│  8. 构建共享包（for pkg in packages/enterprise-*）│
│  9. npx prisma db push                            │
│ 10. ./start-dev.sh start                          │
│ 11. curl localhost:18790/health ← 验证            │
│                                                   │
│  ⚠️ 升级 octopus 后必须重走步骤 7-8-10           │
│  ⚠️ Token 两处配置必须一致                         │
│  ⚠️ 内网提前准备 node_modules + Docker 镜像        │
│                                                   │
└───────────────────────────────────────────────────┘
```

---

## 十一、Enterprise Audit Plugin 部署

Plugin 位于 `plugins/enterprise-audit/`（项目内），随 Native Gateway 自动加载。

### 目录结构

```
plugins/enterprise-audit/
  octopus.plugin.json    ← 插件清单（id 必须与 octopus.json entries key 一致）
  package.json            ← 含 "octopus.extensions": ["./src/index.ts"]（关键！）
  src/
    index.ts              ← 同步入口函数（默认导出），不能是 async
    utils.ts
    file-writer.ts
  prisma/
    schema.prisma         ← 插件专用 schema（output = ../node_modules/.prisma/client）
  node_modules/
    @prisma/client/       ← 通过 npm install 安装
    .prisma/client/       ← 通过 prisma generate 生成（含查询引擎）
```

### 部署步骤

```bash
# 1. Plugin 已在项目目录 plugins/enterprise-audit/，随 git clone 自动获取

# 2. 安装依赖（需网络或提前打包 node_modules）
cd plugins/enterprise-audit
npm install

# 3. 生成 Prisma Client（使用项目的 prisma CLI，版本必须 6.x）
DATABASE_URL="mysql://octopus:..@localhost:3306/octopus_enterprise" \
  ../../node_modules/.bin/prisma generate

# 4. 确认 octopus.json 已配置
# plugins.load.paths 包含项目 plugins/ 目录
# plugins.entries.enterprise-audit.enabled = true

# 5. 重启 Native Gateway
./start-dev.sh restart
```

### 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| "plugin not found: enterprise-audit" | `package.json` 缺少 `octopus.extensions` 字段 | 添加 `"octopus": {"extensions": ["./src/index.ts"]}` |
| "plugin id mismatch" | `package.json` 的 `name` 字段与 `octopus.plugin.json` 的 `id` 不一致 | 两处均设为 `"enterprise-audit"` |
| "plugin register returned a promise" | 入口函数是 `async function` | 改为同步函数，异步 DB 初始化在内部用 `.then()` 处理 |
| DB audit 不写入 | Prisma Client 未生成（`.prisma/client` 目录为空） | 重新运行 `prisma generate`（用项目 v6 CLI） |
| DB audit 不写入 | FK 约束：userId 不存在于 users 表 | 插件已自动 fallback 到 userId=null 重试 |
| 使用全局 `npx prisma` 报错 P1012 | 全局 prisma 为 v7，schema 用了 v6 语法 | 必须用项目的 `node_modules/.bin/prisma`（v6.x） |

### 审计记录类型

| action | 触发时机 | 包含信息 |
|--------|----------|---------|
| `tool:call` | 工具调用前 | toolName, paramKeys |
| `tool:call:result` | 工具调用后 | toolName, hasResult, error, durationMs |
| `llm:response` | LLM 响应完成 | provider, model, usage（token 消耗）, responseLength |
| `session:create` | session 开始 | sessionId, resumed |
| `session:end` | session 结束 | sessionId, messageCount, durationMs |
| `agent:end` | agent 运行结束 | messageCount, durationMs |

---

## 十二、Enterprise Skills 部署

企业级 Skills 存放于 `data/skills/{skillId}/` 目录，每个子目录包含 `SKILL.md`。

通过 `.octopus-state/octopus.json` 的 `skills.load.extraDirs` 配置发现：

```json
"skills": {
  "load": {
    "extraDirs": ["/home/baizh/octopus/data/skills"]
  }
}
```

重启 native gateway 后对所有用户的 agent 自动可见。**无需软链接**（软链接方案在 `workspaceOnly: true` 下失效，octopus 做 realpath 后发现路径在沙箱外会拒绝加载）。

### Skill 目录结构

```
data/skills/
└── my-skill/
    └── SKILL.md        # 必须，包含 name/description frontmatter
```

### 验证方法

发起对话，问 agent「你有哪些可用的技能？」，应能列出企业 skill 名称。

---

## 十三、Enterprise MCP Plugin 部署

Plugin 位于 `plugins/enterprise-mcp/`（项目内），启动时从 MySQL 读取企业 MCP Server 配置，通过 `api.registerTool()` 注册为原生 agent 工具，对所有用户全局可用。

### 文件结构

```
plugins/enterprise-mcp/
├── octopus.plugin.json
├── package.json
├── prisma/
│   └── schema.prisma
├── node_modules/
│   └── .prisma/client/   ← Prisma 生成产物
└── src/
    ├── index.ts          ← Plugin 入口（同步函数）
    └── executor.ts       ← MCP stdio JSON-RPC 实现
```

### 部署步骤

```bash
cd plugins/enterprise-mcp

# 1. 安装依赖
npm install

# 2. 生成 Prisma Client（必须用项目 v6 CLI）
DATABASE_URL="mysql://octopus:...@localhost:3306/octopus_enterprise" \
  ../../node_modules/.bin/prisma generate

# 3. 重启 native gateway
cd ../.. && ./start-dev.sh restart
```

### 配置 MCP Server

通过 Admin Console 添加，或直接写 DB：

```sql
INSERT INTO mcp_servers (server_id, name, scope, transport, command, args, enabled, created_at)
VALUES ('my-server', '我的MCP工具', 'enterprise', 'stdio',
        '/usr/local/bin/my-mcp-server', '[]', 1, NOW());
```

- `scope = 'enterprise'`：对所有用户可用
- `transport`：目前仅支持 `stdio`（HTTP 模式暂不支持）
- `command`：可执行文件完整路径（内网环境确保路径可达）

### 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| native gateway 启动超时，日志报 `extension entry escapes package directory` | `src/index.ts` 不存在，plugin 文件不完整 | 确保 `src/index.ts` 和 `src/executor.ts` 均已创建 |
| `enterprise-mcp plugin registered` 后报 `MCP process exited` | MCP server 的 `command` 路径不存在或不可执行 | 检查 DB 中 `command` 字段，确认二进制文件存在 |
| `failed to query MCP servers` | DB 连接失败或 `mcp_servers` 表不存在 | 检查 `DATABASE_URL`，确认已执行 `prisma db push` |

---

## 十四、State 目录迁移注意事项（2026-03-02）

### 背景

Native Gateway 的 state 目录从 `~/.octopus/` 迁移到项目目录内的 `.octopus-state/`，便于版本控制和统一管理。

### 关键配置

`start-dev.sh` 通过环境变量覆盖默认路径：

```bash
export OCTOPUS_STATE_DIR=/home/$USER/octopus/.octopus-state
export OCTOPUS_HOME=/home/$USER/octopus/.octopus-state
```

### 注意事项

1. **软链接兼容**：`~/.octopus` 保留为指向 `.octopus-state/` 的软链接。如果删除了软链接，部分硬编码旧路径的脚本可能失败。

2. **路径一致性**：`octopus.json` 中所有绝对路径（`plugins.load.paths`、`skills.load.extraDirs` 等）必须同步更新为项目目录内的路径。

3. **Prisma schema**：Plugin 的 `prisma/schema.prisma` 中 `output` 路径是相对路径，不受目录迁移影响。

4. **运行时数据已 gitignore**：`.octopus-state/` 内的 `logs/`、`completions/`、`subagents/` 等运行时临时目录已在 `.gitignore` 中排除。

---

## 十五、MCPRegistry 主键冲突（2026-03-03）

### 问题描述

`MCPRegistry.register()` 和 admin 路由各自调用 `prisma.create()` 插入 MCP Server 记录，在并发场景下导致主键冲突崩溃：

```
PrismaClientKnownRequestError: Unique constraint failed on the fields: (`server_id`)
```

### 根因

Admin 路由先写 DB（用户通过 UI 添加 MCP Server），然后 `MCPRegistry.register()` 在 Plugin 启动时同步读取 DB 并尝试再次 `create()`，触发唯一约束冲突。

### 解决

`MCPRegistry.register()` 改用 `prisma.upsert()`：路由先写 DB 没问题，Registry 同步时发现已存在就 update 而非报错。

---

## 十六、Plugin 入口必须是同步函数（2026-02-25）

### 问题描述

Plugin 的入口函数如果声明为 `async function`，octopus 加载时会忽略返回的 Promise，导致在 `await` 之后注册的 hooks 全部丢失：

```typescript
// ❌ 错误：async 入口
export default async function(api: PluginAPI) {
  const db = await initDatabase();  // octopus 不等这个 promise
  api.on('tool:call', handler);     // 这行永远不会执行
}
```

### 解决

入口必须是**同步函数**，异步初始化用 `.then()` 在后台完成：

```typescript
// ✅ 正确：同步入口
export default function(api: PluginAPI) {
  api.on('tool:call', handler);  // 同步注册，不会丢失

  // 异步 DB 初始化在后台
  initDatabase().then(db => {
    // DB 就绪后的逻辑
  });
}
```

---

## 十七、Prisma v7 不兼容，必须 pin v6（2026-03-02）

### 问题描述

Prisma v7 移除了 `datasource` 块的 `url` 属性，使用 `npx prisma generate` 时如果全局安装了 v7，会报 P1012 错误：

```
Error: Property "url" is not allowed in datasource block.
```

### 解决

Plugin 的 `package.json` 必须固定 Prisma v6：

```json
{
  "dependencies": {
    "@prisma/client": "^6.0.0"
  },
  "devDependencies": {
    "prisma": "^6.0.0"
  }
}
```

运行 generate 时使用项目本地的 CLI，而非全局 `npx prisma`：

```bash
# ✅ 正确
../../node_modules/.bin/prisma generate

# ❌ 错误（可能调用全局 v7）
npx prisma generate
```

---

## 十八、configApply RPC 格式（2026-03-03）

### 问题描述

通过 WebSocket RPC 调用 `configApply` 更新 `octopus.json` 时，直接传递 JSON 对象无效，config 不会被更新。

### 正确格式

`configApply` 的参数必须是 `{ raw: JSON.stringify(patch) }`，即将 patch 对象序列化为字符串后放在 `raw` 字段中：

```typescript
// ✅ 正确
await bridge.rpc('configApply', {
  raw: JSON.stringify({
    memory: { scopes: { ... } }
  })
});

// ❌ 错误（不生效）
await bridge.rpc('configApply', {
  memory: { scopes: { ... } }
});
```

---

## 十九、Native Gateway Supervisor 自动重启（2026-03-03）

### 机制说明

`start-dev.sh` 中的 Native Gateway 使用 supervisor 循环启动：

```bash
while true; do
  node /home/$USER/octopus-main/octopus.mjs --profile enterprise gateway --port 19791
  echo "Native gateway exited, restarting in 3s..."
  sleep 3
done
```

### 为什么需要

`memory-lancedb-pro` 等扩展在修改 memory scope 时会直接写 `octopus.json`，这会触发 Native Gateway 的 config file watcher，导致进程主动退出（"full process restart"）。Supervisor 循环确保进程退出后 3 秒内自动重启。

### 注意事项

1. **Enterprise Gateway 自动重连**：`OctopusBridge` 内建 WebSocket 自动重连（3 秒间隔），Native Gateway 重启后 Enterprise Gateway 会自动恢复连接，无需人工干预。

2. **停止方式**：`./start-dev.sh stop` 会 `kill -- -$pid` 杀掉整个进程组（包括 supervisor 循环），精确匹配 `octopus-main/octopus.mjs.*gateway` 防止误杀个人 octopus 进程。

3. **配置变更生效**：修改 `octopus.json` 后 Native Gateway 会自动重启生效，无需手动 restart。

---

## 二十、memory-lancedb-pro 写 octopus.json 导致重启（2026-03-03）

### 问题描述

`memory-lancedb-pro` 扩展的 `MemoryScopeManager` 在注册/注销 agent 的 memory scope 时，会直接写入 `octopus.json` 的 `memory.scopes` 配置项。这个文件写入会触发 Native Gateway 的 config file watcher，导致 Gateway 主动退出并执行 "full process restart"。

### 表现

- 创建新用户/agent 后，Native Gateway 日志出现 `config changed, restarting...`
- Enterprise Gateway 日志出现 `WebSocket disconnected, reconnecting...`
- 数秒后自动恢复正常

### 为什么不是 bug

这是 octopus 的设计行为：config 文件变更 = 需要重新加载配置 = 重启进程。Supervisor 循环 + WebSocket 自动重连确保了整个流程对用户透明。

### 注意

- 如果短时间内批量创建大量 agent（如批量导入用户），可能导致频繁重启。建议批量操作完成后等待一次完整重启再验证。
- `memory-lancedb-pro` 的 `dbPath` 必须显式配置为 `.octopus-state/memory/lancedb-pro`，否则默认路径 `~/.octopus/memory/lancedb-pro` 会读到个人 octopus 的记忆数据。
