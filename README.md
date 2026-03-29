# Octopus Enterprise

企业级多租户 AI 助手平台，基于 Octopus Engine 构建。

## 特性

- **多租户隔离** — Agent/工作区/记忆按用户完全隔离
- **IM 集成** — 飞书、微信双通道接入
- **MCP 插件** — Model Context Protocol 工具热插拔
- **Skills 系统** — Python/Node 脚本扩展，支持安全审批
- **企业审计** — 全操作审计日志（DB + 文件双写）
- **Docker 沙箱** — 代码执行安全隔离

## 快速开始

### 前置要求

- Node.js >= 22 + pnpm >= 9
- MySQL 8.0+
- Redis 6+（可选，分布式部署需要）
- Docker（沙箱执行需要）

### 安装

```bash
git clone <repo-url> && cd octopus-slim
cp .env.example .env  # 编辑填入实际配置
./setup.sh            # 一键初始化（依赖安装、Prisma、Docker）
./start.sh            # 启动服务
```

### 验证

```bash
curl http://localhost:18790/health
# 预期: {"status":"ok","services":{...}}
```

管理后台: `http://localhost:3001`

## 架构

```
Browser/Console ──HTTP/SSE──> Enterprise Server (18790)
                                    |
                              EngineAdapter (进程内)
                                    |
                              Engine Runtime (19791)
                                    |
                              Model Provider (OpenAI 兼容)
```

详见 `CLAUDE.md` 获取完整架构文档。

## 开发

```bash
pnpm dev          # 开发模式（热重载）
pnpm typecheck    # TypeScript 类型检查
pnpm test         # 运行测试
pnpm build        # 生产构建
```

## 生产部署

```bash
pnpm db:migrate   # 应用数据库迁移
pnpm build        # 构建
pm2 start ecosystem.config.js  # PM2 启动
# 或
sudo systemctl start octopus   # systemd 启动
```

## 目录结构

```
apps/server/      企业级 API 网关
apps/console/     React 管理后台
packages/engine/  AI 引擎核心
packages/database/ Prisma ORM 层
plugins/          企业插件（audit, mcp, email）
channels/         IM 适配器（feishu, weixin, telegram）
data/             运行时数据（skills, 工作区, 审计日志）
```

## License

Private — 内部使用
