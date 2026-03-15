# Octopus 项目记忆（原 OpenClaw Enterprise）

## 用户偏好（必须遵守）
- **必须使用 agent team 进行开发和解决问题**：拆分为并行 subagent 执行
- 先讨论原因和方案，用户确认后再动手改代码
- 始终使用中文交流
- 用户密码: baizh/password123（MockLDAP 开发模式）
- **改完后端代码直接重启**：不要问，直接 `./start.sh restart`
- **保留老项目**：`/home/baizh/openclaw-enterprise/` 和 `/home/baizh/openclaw-main/` 不动

## 项目概况（合并后）
- **项目路径**：`/home/baizh/octopus/`（2026-03-13 合并 openclaw-main + openclaw-enterprise）
- **架构**：单进程模式，EngineAdapter 进程内调用替代 WebSocket RPC
- Enterprise Gateway: 18790，Engine 内嵌（19791 仅内部用）
- Admin Console: port 3001（`apps/console/`）
- DB: MySQL 8 + Redis 7，模型: DeepSeek（OpenAI-compatible）
- 分支: `main`（PR 目标: `refactor/native-alignment`）

## 项目结构（合并后）
```
/home/baizh/octopus/
├── apps/server/        (Express 企业网关，原 apps/gateway/)
├── apps/console/       (React 18 Admin Console，原 apps/admin-console/)
├── packages/engine/    (AI 引擎，原 openclaw-main)
├── packages/enterprise-{auth,audit,database,mcp,quota,rag,skills,workspace}/
├── plugins/enterprise-{audit,mcp}/
├── .octopus-state/     (引擎状态：octopus.json、agents、memory)
├── data/               (企业数据：skills、audit、users)
├── docs/reference/templates/  (引擎模板：AGENTS.md, SOUL.md 等)
└── start.sh            (单进程启动脚本)
```

## 关键配置
- State 目录: `.octopus-state/`，配置文件: `octopus.json`
- `OCTOPUS_GATEWAY_TOKEN`（.env）= `octopus.json` 的 `gateway.auth.token`
- `OCTOPUS_STATE_DIR` / `OCTOPUS_HOME` = `.octopus-state/`
- DB: `mysql -uoctopus -p'YOUR_DB_PASSWORD' octopus_enterprise`
- **sandbox.mode = "off"，exec.host = "gateway"**（Docker 镜像未构建，临时禁用）
- **meta.lastTouchedVersion 必须与 engine/package.json version 一致**（否则引擎反复 reload）

## 核心服务文件
| 文件 | 职责 |
|------|------|
| `apps/server/src/services/EngineAdapter.ts` | 进程内 RPC（替代 OctopusBridge WebSocket） |
| `apps/server/src/routes/chat.ts` | 对话、slash 命令、`ensureNativeAgent`（带内存缓存） |
| `apps/server/src/routes/agents.ts` | Agent CRUD + TOOLS.md 同步 |
| `apps/server/src/index.ts` | 入口，dotenv + 引擎初始化 |
| `packages/engine/src/gateway/server.ts` | `startGatewayServer()` |
| `packages/engine/src/gateway/server-methods.ts` | `handleGatewayRequest()` |
| `packages/engine/src/infra/agent-events.ts` | `onAgentEvent()` / `emitAgentEvent()` |

## 启动脚本
- `./start.sh start|stop|restart|status|logs [gateway|admin]`
- 单进程：`npx tsx src/index.ts`（Gateway + Engine 一起启动）
- Admin Console: `npx vite --port 3001`

## EngineAdapter 关键实现细节
→ 详见 `memory/octopus-merge-2026-03-13.md`

## Agent Team 角色分工
| 角色 | 职责范围 | commit 格式 |
|------|---------|------------|
| **SecurityAuditor** | IDOR、JWT、登录锁定、路径穿越 | `fix(security): xxx` |
| **BackendEngineer** | 路由、RPC 封装、并发调优 | `feat(gateway): xxx` |
| **DevOpsEngineer** | 部署脚本、健康检查、备份 | `ops: xxx` |
| **QualityEngineer** | vitest、安全测试、回归测试 | `test: xxx` |

## Native Gateway 配置写入（重要）
- **使用 `config.set` RPC**（不是 `config.apply`！），避免强制重启
- `configApplyFull` / `configApply` 内部都用 `config.set`，参数 `{ raw, baseHash }`
- `baseHash` 必须用 `config.get` 返回的 hash
- 调用前检查数据是否变化，无变化则跳过

## 飞书 IM / 心跳巡检 / 地图 MCP
（这些功能从老项目迁移过来，逻辑不变）
- 飞书: `@larksuiteoapi/node-sdk`，WSClient
- 心跳: `agentFilesSet()` → HEARTBEAT.md，agent 级 `model` 必须设置
- 地图 MCP: amap-mcp-server（内网可能不可用）

## Plugin 化状态
- **enterprise-audit** ✅ / **enterprise-mcp** ✅ / **memory-lancedb-pro** 在 `.octopus-state/extensions/`
- Plugin manifest: `octopus.plugin.json`（不是 openclaw！）
- Plugin SDK import: `octopus/plugin-sdk`
- Plugin 入口必须是**同步函数**；必须 pin `prisma@6`

## 踩坑详录
→ 详见 `memory/pitfalls.md`（老项目踩坑）
→ 详见 `memory/octopus-merge-2026-03-13.md`（合并踩坑：CRLF、模板、版本、ensureNativeAgent 缓存、异步错误吞掉）

## 审计经验（重要）
- 审计发现误报率约 22%：每次审计必须派验证 Agent 逐一核实
- `dangerouslyDisableDeviceAuth: true` 不能改为 false（内部 RPC 需要）

## 版本记录
- 2026-03-13: **Octopus 合并**（单进程架构、EngineAdapter、E2E 对话验证通过）
- 2026-03-11: 安全整改 + run_skill 恢复 + Skill 执行全链路修复
- 2026-03-09: Native Gateway 升级 2026.3.9 + 心跳全流程修复
- 2026-03-07: config.set + 飞书 IM + 心跳巡检 + 地图 MCP
- 更早记录见老项目 MEMORY.md
