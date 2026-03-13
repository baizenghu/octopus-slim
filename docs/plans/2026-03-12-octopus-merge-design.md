# Octopus 合并重命名设计文档

> 将 openclaw-main（原生引擎）和 openclaw-enterprise（企业层）合并为单一项目 Octopus

---

## 1. 决策记录

| 决策项 | 选择 | 说明 |
|--------|------|------|
| 合并方式 | A2 单进程 | Enterprise 直接 import 原生引擎，不再有 WebSocket RPC |
| 上游关系 | B3 选择性提取 | 只提取核心模块，丢弃 40+ 无用渠道/移动端 |
| 目录结构 | C3 按功能域打散 | 不区分"原生"和"企业"，统一组织 |
| 包命名 | D1 `@octopus/*` | 统一命名空间 |
| Plugin 系统 | E1 保留 | `octopus.plugin.json`，利于后续扩展 |
| 数据库 | F2 混合 | 业务 MySQL + 引擎运行时文件系统 |
| 渠道插件 | 保留 Telegram、Discord、原生飞书 + 企业飞书 Adapter |
| CLI | H3 混合 | `octopus` CLI 管核心 + `start.sh` 管外围 |
| Agent 前缀 | I2 保持 `ent_` | 避免数据迁移 |

---

## 2. 目标架构

```
Browser / Admin Console (React)
         │
         │ HTTP/SSE
         ▼
Octopus Server ─── port 18790（单进程）
  ├─ Enterprise 层 (Auth, RBAC, Audit, Quota)
  ├─ Agent 引擎 (原生核心，直接 import)
  ├─ Plugin 系统 (audit, mcp, memory-lancedb-pro)
  ├─ 渠道 (Telegram, Discord, 飞书)
  └─ Tool 系统 (fs, exec, skills, sandbox)
         │
         │ OpenAI-compatible HTTP
         ▼
DeepSeek / 通义千问 / Claude
```

---

## 3. 目录结构

```
octopus/
├── packages/
│   ├── agent-engine/          ← 原生 agents/ 核心（PI、tools、skills、subagent）
│   ├── gateway-protocol/      ← 原生 gateway/ 协议定义（保留给未来分布式）
│   ├── plugin-sdk/            ← 原生 extensions/ Plugin SDK + API
│   ├── config/                ← 原生 config/ 配置加载验证
│   ├── auth/                  ← 企业 enterprise-auth
│   ├── database/              ← 企业 enterprise-database (Prisma)
│   ├── audit/                 ← 企业 enterprise-audit
│   ├── quota/                 ← 企业 enterprise-quota
│   ├── skills/                ← 企业 enterprise-skills + 原生 skills
│   ├── workspace/             ← 企业 enterprise-workspace
│   ├── mcp/                   ← 企业 enterprise-mcp
│   └── rag/                   ← 企业 enterprise-rag
│
├── plugins/
│   ├── audit/                 ← Plugin: 审计 hooks
│   ├── mcp/                   ← Plugin: MCP 工具注册
│   └── memory-lancedb-pro/    ← Plugin: 向量记忆
│
├── channels/
│   ├── telegram/              ← 原生 Telegram 渠道
│   ├── discord/               ← 原生 Discord 渠道
│   ├── feishu-native/         ← 原生飞书渠道
│   └── feishu-enterprise/     ← 企业自建飞书 Adapter
│
├── apps/
│   ├── server/                ← 统一后端入口（Express + Agent 引擎）
│   └── console/               ← React Admin Console
│
├── docker/
│   ├── sandbox/               ← Docker 沙箱
│   └── docker-compose.dev.yml
│
├── deploy/
│   └── octopus.service        ← systemd unit
│
├── data/                      ← 运行时数据
│   ├── skills/
│   ├── audit-logs/
│   └── users/
│
├── .octopus-state/            ← 引擎运行时状态
│   ├── octopus.json
│   ├── agents/
│   ├── memory/
│   └── extensions/
│
├── docs/
├── scripts/
├── octopus.mjs                ← CLI 入口
├── start.sh                   ← 环境管理脚本
├── package.json               ← name: "octopus"
├── pnpm-workspace.yaml
└── CLAUDE.md
```

---

## 4. 重命名映射

### 4.1 环境变量

| 旧 | 新 | 备注 |
|----|-----|------|
| `OPENCLAW_STATE_DIR` | `OCTOPUS_STATE_DIR` | |
| `OPENCLAW_HOME` | `OCTOPUS_HOME` | |
| `OPENCLAW_GATEWAY_TOKEN` | `OCTOPUS_GATEWAY_TOKEN` | 单进程内部使用 |
| `OPENCLAW_GATEWAY_URL` | 删除 | 单进程不需要 |
| `OPENCLAW_NATIVE_PORT` | 删除 | 单进程不需要 |

### 4.2 npm 包

| 旧 | 新 |
|----|-----|
| `@openclaw-enterprise/auth` | `@octopus/auth` |
| `@openclaw-enterprise/audit` | `@octopus/audit` |
| `@openclaw-enterprise/database` | `@octopus/database` |
| `@openclaw-enterprise/mcp` | `@octopus/mcp` |
| `@openclaw-enterprise/quota` | `@octopus/quota` |
| `@openclaw-enterprise/rag` | `@octopus/rag` |
| `@openclaw-enterprise/skills` | `@octopus/skills` |
| `@openclaw-enterprise/workspace` | `@octopus/workspace` |
| `@openclaw-enterprise/gateway` | `@octopus/server` |
| `@openclaw-enterprise/admin-console` | `@octopus/console` |
| （新增）| `@octopus/agent-engine` |
| （新增）| `@octopus/gateway-protocol` |
| （新增）| `@octopus/plugin-sdk` |
| （新增）| `@octopus/config` |

### 4.3 Docker

| 旧 | 新 |
|----|-----|
| `openclaw-sandbox:enterprise` | `octopus-sandbox:enterprise` |
| `openclaw-sandbox:bookworm-slim` | `octopus-sandbox:bookworm-slim` |
| `openclaw-internal` | `octopus-internal` |
| `openclaw-mysql` | `octopus-mysql` |
| `openclaw-redis` | `octopus-redis` |

### 4.4 数据库

| 旧 | 新 |
|----|-----|
| DB: `openclaw_enterprise` | `octopus_enterprise` |
| User: `openclaw` | `octopus` |
| Password: `YOUR_DB_PASSWORD` | `Octopus_Dev@2026` |

### 4.5 文件和目录

| 旧 | 新 |
|----|-----|
| `.openclaw-state/` | `.octopus-state/` |
| `openclaw.json` | `octopus.json` |
| `openclaw.plugin.json` | `octopus.plugin.json` |
| `OpenClawBridge` 类 | 删除（单进程直接调用） |

---

## 5. 单进程合并 — 核心重构

### 5.1 删除 WebSocket RPC Bridge

当前 `OpenClawBridge` 通过 WebSocket RPC 调用原生引擎，合并后改为直接函数调用：

| 当前 RPC | → 直接 import |
|---------|--------------|
| `bridge.callAgent(agentId, message)` | `agentEngine.run(agentId, message)` |
| `bridge.sessionsList(agentId)` | `sessionManager.list(agentId)` |
| `bridge.agentsCreate(id, config)` | `agentManager.create(id, config)` |
| `bridge.cronAdd(schedule)` | `cronScheduler.add(schedule)` |
| `bridge.configGet()` | `configLoader.get()` |
| `bridge.configSet(raw, hash)` | `configLoader.set(raw, hash)` |
| `bridge.agentFilesSet(id, files)` | `agentManager.setFiles(id, files)` |

### 5.2 从 openclaw-main 提取的核心模块

| 原生目录 | → octopus 包 | 核心文件 |
|---------|-------------|---------|
| `src/agents/` | `@octopus/agent-engine` | pi-embedded, models-config, pi-tools, skills, subagent-* |
| `src/gateway/` | `@octopus/gateway-protocol` | protocol/, server, client |
| `src/extensions/` | `@octopus/plugin-sdk` | Plugin API, registerTool, hooks |
| `src/config/` | `@octopus/config` | 配置加载、验证、hot reload |
| `src/infra/` | 合入 `@octopus/server` | 端口、TLS |
| `src/process/` | 合入 `@octopus/server` | 进程管理 |
| `src/logging/` | 合入 `@octopus/server` | 日志系统 |
| `src/types/` | 各包自带 | 类型定义 |

### 5.3 丢弃的模块

| 原生目录 | 原因 |
|---------|------|
| `src/channels/` (除 telegram, discord, feishu) | 内网用不到 |
| `src/cli/` | octopus 有自己的 CLI |
| `apps/android/`, `ios/`, `macos/` | 移动端不需要 |
| `packages/moltbot`, `clawdbot` | 独立 bot 不需要 |
| `extensions/` (39 个) | 只保留 telegram, discord, feishu, memory-lancedb-pro |
| `docs/` (Mintlify) | octopus 有自己的文档 |

---

## 6. 不变的部分

- `ent_` Agent ID 前缀
- MySQL schema（表结构不变）
- 用户 workspace 隔离机制
- Docker sandbox 隔离策略（改名但机制不变）
- Audit hooks 逻辑
- Admin Console 功能（只改 API 地址和品牌文字）

---

## 7. 来源项目

| 项目 | 路径 | 角色 |
|------|------|------|
| openclaw-main | `/home/baizh/openclaw-main/` | 原生引擎源码（无 .git，v2026.3.9） |
| openclaw-enterprise | `/home/baizh/openclaw-enterprise/` | 企业层（git repo） |
| **octopus** | `/home/baizh/octopus/` | **合并后的新项目** |
| GitHub | `baizenghu/octopus` | 新仓库 |
