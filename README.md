<div align="center">

# 🐙 Octopus AI

**企业级多模型 AI 助手平台**

开箱即用的私有化部署方案，支持多租户隔离、Agent 编排、记忆系统、IM 集成与安全沙箱执行

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-%3E%3D9-orange.svg)](https://pnpm.io)

</div>

---

## 为什么选择 Octopus？

| 特性 | Octopus | 传统方案 |
|------|---------|---------|
| 多模型统一接入 | ✅ 一套 API 接入 DeepSeek / MiniMax / Claude 等 | 各自集成 |
| 多租户隔离 | ✅ Agent / 记忆 / 工作区 按用户完全隔离 | 通常无 |
| Agent 团队协作 | ✅ 主 Agent 可自主拆分子 Agent 并行执行 | ❌ |
| 持久化记忆系统 | ✅ 向量 + BM25 混合检索，跨会话记忆 | ❌ |
| IM 双通道 | ✅ 飞书 / 微信 原生接入 | 需自研 |
| 安全沙箱 | ✅ Docker 隔离执行，Tool 级权限控制 | ❌ |
| 私有化部署 | ✅ 全量源码，无云依赖 | 通常需要 SaaS |

---

## 核心能力

### 🤖 多模型 Agent 运行时
- 统一 OpenAI 兼容接口，支持 DeepSeek、MiniMax、Claude、GPT 等主流模型
- 流式输出（SSE）+ 思考链分离展示
- 自动 failover：主模型失败切备用模型

### 🧠 持久化记忆系统（memory-lancedb-pro）
- LanceDB 向量存储 + BM25 混合检索
- 智能记忆提取：对话结束后自动提炼关键信息
- 记忆衰减引擎：近期记忆权重更高
- 跨 Agent 记忆隔离与共享控制

### 👥 Agent 团队（Agent Team）
- 主 Agent 可自主决策拆分子任务、并行调用多个子 Agent
- 子 Agent 结果汇聚后由主 Agent 合成最终答案
- 内置并发限制与循环检测保护

### 🔧 Skills 与 MCP 工具生态
- **Skills**：Python / Node.js 脚本，Docker 沙箱安全执行
- **MCP**：Model Context Protocol，热插拔第三方工具
- 支持数据库查询、地图 API、OA 系统、PPT 生成等开箱工具

### 💬 IM 多通道接入
- **飞书（Lark）**：群聊 / 私聊 / 卡片消息 / 目录同步
- **微信企业号**：消息接收与回复
- **Telegram**：Bot 接入

### 🏢 企业级特性
- **多租户**：`ent_{userId}_{agentName}` 命名空间，工作区完全隔离
- **审计日志**：全操作双写（MySQL + 文件），满足等保要求
- **安全沙箱**：代码执行在 Docker 内，资源配额可控
- **权限控制**：Tool 级白名单 / 黑名单硬执行，不依赖 Prompt

---

## 系统架构

```
┌─────────────────────────────────────────┐
│           Browser / Console (React)      │
│        管理后台 · 对话界面 · 审计报表     │
└─────────────────┬───────────────────────┘
                  │ HTTP / SSE
┌─────────────────▼───────────────────────┐
│        Enterprise Server  :18790         │
│  ┌─────────────────────────────────┐    │
│  │  Auth (JWT)  │  Multi-tenant    │    │
│  │  AgentConfigSync  │  Audit       │    │
│  │  SystemPromptBuilder  │  IM路由  │    │
│  └─────────────────────────────────┘    │
└─────────────────┬───────────────────────┘
                  │ 进程内调用（EngineAdapter）
┌─────────────────▼───────────────────────┐
│           Engine Runtime  :19791         │
│  Agent 运行时 · Session · Cron           │
│  Tool System · MCP · Docker Sandbox      │
│  memory-lancedb-pro（记忆插件）           │
└─────────────────┬───────────────────────┘
                  │ OpenAI 兼容 API
┌─────────────────▼───────────────────────┐
│     Model Provider（私有化 / 云端）       │
│   DeepSeek  MiniMax  Claude  GPT  ...    │
└─────────────────────────────────────────┘
```

---

## 快速开始

### 前置要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 22 | 运行时 |
| pnpm | >= 9 | 包管理器 |
| MySQL | 8.0+ | 主数据库 |
| Redis | 6+ | 可选，分布式部署时需要 |
| Docker | 20+ | 沙箱执行（可选）|

### 安装

```bash
# 1. 克隆仓库
git clone https://github.com/baizenghu/octopus-slim.git
cd octopus-slim

# 2. 安装依赖
pnpm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入数据库连接、JWT secret 等

# 4. 配置引擎（模型 API Key、插件等）
cp .octopus-state/octopus.json.template .octopus-state/octopus.json
# 编辑 octopus.json，填入实际 API Key

# 5. 初始化数据库
pnpm db:migrate

# 6. 启动服务
npx tsx apps/server/src/index.ts
```

### 验证

```bash
curl http://localhost:18790/health
# {"status":"ok","services":{"nativeGateway":"running","database":"connected"}}
```

管理后台访问：`http://localhost:3001`

---

## 配置说明

### 环境变量（`.env`）

```env
# 数据库
DATABASE_URL=mysql://user:password@localhost:3306/octopus_enterprise

# JWT
JWT_SECRET=your-secret-key

# 服务端口
PORT=18790
```

### 引擎配置（`.octopus-state/octopus.json`）

模型提供商配置示例：

```json
{
  "models": {
    "providers": {
      "deepseek": {
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "YOUR_DEEPSEEK_API_KEY",
        "api": "openai-completions",
        "models": [
          { "id": "deepseek-chat", "name": "DeepSeek Chat" }
        ]
      }
    }
  }
}
```

完整配置说明见 [`.octopus-state/octopus.json.template`](.octopus-state/octopus.json.template)

---

## 目录结构

```
octopus-slim/
├── apps/
│   ├── server/          # 企业级 API 服务（Express + TypeScript）
│   └── console/         # 管理后台（React + shadcn/ui）
├── packages/
│   ├── engine/          # AI 引擎核心（Agent 运行时、Session、Tool）
│   └── database/        # Prisma ORM + 数据库 Schema
├── plugins/
│   ├── audit/           # 审计日志插件
│   ├── mcp/             # MCP 工具桥接插件
│   └── email/           # 邮件通知插件
├── channels/
│   ├── feishu-native/   # 飞书 IM 适配器
│   └── telegram/        # Telegram Bot 适配器
├── .octopus-state/
│   ├── octopus.json.template   # 引擎配置模板
│   └── extensions/
│       └── memory-lancedb-pro/ # 向量记忆系统插件
├── data/
│   ├── skills/          # Skills 脚本（Python / Node.js）
│   └── agents/          # Agent 定义文件（Markdown）
└── prisma/              # 数据库 Schema 与迁移文件
```

---

## 开发

```bash
pnpm dev          # 开发模式（热重载）
pnpm typecheck    # TypeScript 类型检查
pnpm test         # 运行单元测试
pnpm build        # 生产构建
```

---

## 生产部署

```bash
# 构建
pnpm build

# PM2 方式
pm2 start ecosystem.config.js

# 或 systemd 方式
sudo systemctl start octopus
```

---

## 记忆插件（memory-lancedb-pro）

位于 `.octopus-state/extensions/memory-lancedb-pro/`，基于 LanceDB 实现：

- **混合检索**：向量（70%）+ BM25（30%），可调权重
- **重排序**：Jina Reranker 交叉编码器
- **智能提取**：LLM 自动从对话中提炼可记忆内容
- **记忆衰减**：时间衰减 + 近期权重偏置
- **多 scope 隔离**：不同 Agent 可独立或共享记忆空间

配置项在 `octopus.json` 的 `plugins.entries.memory-lancedb-pro.config` 中。

---

## 贡献指南

欢迎 PR 和 Issue！

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feat/your-feature`
3. 提交变更：遵循 `feat/fix/chore: 描述` 格式
4. 推送并创建 Pull Request

---

## License

[Apache License 2.0](LICENSE)

Copyright 2026 Octopus AI
