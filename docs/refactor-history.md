# Refactor History — 归档

> 从 CLAUDE.md 归档的重构记录。全部已完成。

## native-alignment (2026-02-21 → 2026-02-22)
Branch: `refactor/native-alignment`

Enterprise Gateway 从独立 DeepSeek 调用者重构为原生代理层：
- Phase 1-6: OctopusBridge → Agent RPC → CRUD 同步 → Session 代理 → Cron 代理 → 清理

## Plugin 化 Phase 1 — enterprise-audit (2026-02-25) ✅
- 20 个 hook 双写 DB + JSONL 文件

## Plugin 化 Phase 2 — enterprise-mcp + Skills extraDirs (2026-02-26) ✅
- enterprise-mcp plugin: MySQL → `api.registerTool()` 注册为原生工具
- Skills 改用 `skills.load.extraDirs`
- 内存隔离：`memory-lancedb-pro` 独立 `dbPath`

## Phase 1 核心功能加固 (2026-03-02) ✅
- SkillExecutor 沙箱化、SkillManager DB 持久化、Plugins/State 目录迁移

## 阶段 1 整改 — 清理 + 安全 (2026-03-17) ✅
- 删除死代码 ~1800 行（OctopusBridge、SkillTools、HeartbeatForwarder 等）
- 恢复 sandbox 配置、MCP 环境变量过滤、HMAC 警告
- chat.ts/agents.ts 各项去重和优化

## 阶段 2 整改 — 消除重复 + 性能 (2026-03-17) ✅
- chat.ts 瘦身：1432→722 行，提取 sessions/SystemPromptBuilder/ContentSanitizer
- AgentConfigSync 合并（6 RPC→2）
- enterprise-mcp 工厂模式重构
- 前端 PersonalMcpManager 提取

## 阶段 3 整改 — 配置管理统一 (2026-03-17) ✅
- 工具权限对齐引擎粒度（5→3 组）
- IDENTITY.md creature/vibe 字段
- 记忆隔离 agentAccess 显式注册

## Sprint 1-3 审计整改 (2026-03-24) ✅
- ConfigApplyFull 互斥锁 + 全量→增量改造
- ContentSanitizer 22 个测试
- 提醒系统 XML→cron、引擎原生配置启用
- Error Boundary、IM 文件发送重试
- .gitignore 清理（减少 11K 垃圾文件）
