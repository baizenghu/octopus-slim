# Lessons Learned — 归档

> 从 CLAUDE.md 归档的历史踩坑记录。已解决或不再适用的问题。
> 当前有效的规则保留在 CLAUDE.md Part 5。

| 日期 | 问题 | 规则 |
|------|------|------|
| 2026-02-21 | `OCTOPUS_CONFIG_PATH` 注入 override 文件会被 Octopus 重写，覆盖 model 配置 | **永远不要用 `OCTOPUS_CONFIG_PATH`**，只用 profile 文件 |
| 2026-02-21 | `skills.allowBundled: []` 无效，`normalizeAllowlist([])` 返回 undefined | 禁用技能只能用 `skills.entries[name].enabled: false` |
| 2026-02-25 | 企业 octopus 与个人 octopus 共用端口导致启动冲突 | 用 source 隔离 + 不同端口（18790/19791） |
| 2026-02-26 | `start.sh` 中 `pkill -f "octopus-gateway"` 会误杀个人 octopus systemd 服务 | pkill 模式精确到路径 |
| 2026-02-26 | Plugin `src/index.ts` 不存在时，octopus 报 `escapes package directory` | Plugin 放入 plugins 目录后 `src/index.ts` 必须同步创建 |
| 2026-02-26 | Skill 软链接在 `workspaceOnly: true` 下失效 | 改用 `skills.load.extraDirs` |
| 2026-02-26 | `memory-lancedb-pro` 未配置 `dbPath` 时读到个人记忆 | 企业 octopus.json 显式设置 `dbPath` |
| 2026-03-02 | Prisma v7 移除 `datasource.url` 属性（P1012） | Plugin pin `prisma@6` + `@prisma/client@6` |
| 2026-03-02 | Plugins 迁移到项目目录后路径要同步 | `plugins.load.paths` 指向 `./plugins/` |
| 2026-03-02 | State 目录迁移 | `OCTOPUS_STATE_DIR` 环境变量 |
| 2026-03-16 | `~/.octopus` 软链接导致 vitest 覆盖配置 | 已删除软链接，用 `OCTOPUS_STATE_DIR` |
| 2026-03-03 | `MCPRegistry.register()` 主键冲突 | 改用 `upsert` |
| 2026-03-05 | tool 事件需 `caps: ["tool-events"]` 才收到 | 连接握手传 caps |
| 2026-03-05 | SSE done 事件返回短 session ID | 返回完整 sessionKey |
| 2026-03-05 | `autoGenerateTitle` 无限重试 | 时间戳后缀 + 3 次重试上限 |
| 2026-03-06 | `config.apply` 触发 full restart | 改用 `config.set` RPC |
| 2026-03-06 | 前端编辑 agent 无条件发送字段触发不必要 sync | 前端只发变化字段，后端 diff |
| 2026-03-06 | `syncAllowAgents` 无变化也调用 configApplyFull | 先 diff 再决定 |
| 2026-03-06 | Claude 模型 antigravity 反代返回 400 | 模型配置加 `compat` 参数 |
| 2026-03-06 | Personal MCP 工具名超 64 字符 | serverId 截短 |
| 2026-03-07 | `config.apply` 无条件 SIGUSR1 | 改用 `config.set`，由 reload 模块智能评估 |
| 2026-03-11 | Plugin Prisma schema 缺少模型 | schema 必须包含所有用到的模型 |
| 2026-03-11 | PEP 668 拦截 pip install | 用 `data/skills/.venv/` 共享虚拟环境 |
| 2026-03-11 | `tools.sandbox.tools.allow` 未配置导致 plugin 工具不可见 | 必须配 `["*"]` |
| 2026-03-16 | 企业工具名与引擎原生名不一致 | `TOOL_NAME_TO_ENGINE` 映射表 |
| 2026-03-16 | 引擎 tool 事件字段名是 `name` 不是 `toolName` | `data.toolName \|\| data.name` |
| 2026-03-16 | 删除用户 workspace 清理失败（sandbox root 文件） | Docker `--user root` 清理 |
