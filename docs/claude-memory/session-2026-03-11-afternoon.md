# 2026-03-11 下午工作总结

## 一、Native Gateway 启动优化（清理 40+ 多余插件）

**问题**：Native Gateway 启动耗时 ~70s，超过 start-dev.sh 的 30s 等待超时。
**根因**：自动发现了个人版 openclaw-main 下的 40+ 个扩展插件，全部加载。
**修复**：
- `openclaw.json` 的 `plugins.allow` 白名单只保留 4 个企业插件：`memory-lancedb-pro`、`enterprise-audit`、`enterprise-mcp`、`feishu`
- 其余 40+ 个人版插件全部被白名单过滤掉
- 启动时间大幅缩短

## 二、run_skill 工具三层 Bug 修复

### 第 1 层：Prisma schema 缺模型（数据层）
**问题**：`_prisma.skill.findFirst()` 报 `Cannot read properties of undefined (reading 'findFirst')`
**根因**：`plugins/enterprise-mcp/prisma/schema.prisma` 只有 `MCPServer` 模型，缺少 `Skill` 和 `DatabaseConnection` 模型。生成的 PrismaClient 没有 `.skill` 属性。
**修复**：
- 从主 schema (`prisma/schema.prisma`) 复制 `Skill` + `DatabaseConnection` 模型定义
- 运行 `cd plugins/enterprise-mcp && npx prisma generate`（v6.19.2）
**文件**：`plugins/enterprise-mcp/prisma/schema.prisma`

### 第 2 层：Python PEP 668 依赖问题（环境层）
**问题**：Skill 脚本 import pptx 失败，尝试 pip install 被 PEP 668 拦截
**根因**：企业 Skill 在宿主机子进程执行（`inDocker: false` 已验证），但脚本内的 `pip install` 在受管 Python 环境下被禁止
**修复**：
- 创建共享虚拟环境 `data/skills/.venv/`
- 安装依赖：`python-pptx`、`pandas`、`openpyxl`
- 修改 `getInterpreter()` 函数优先使用 venv 的 python3
- 添加模块级变量 `_dataRootGlobal` 供 `getInterpreter()` 访问 dataRoot 路径
**文件**：`plugins/enterprise-mcp/src/index.ts`（getInterpreter 函数 + _dataRootGlobal 变量）

### 第 3 层：参数格式错误（Agent 使用层）
**问题**：Agent 用 `--config` 传参，实际脚本是位置参数
**修复**：更新 SKILL.md，明确参数格式：`config` 是位置参数，`-o` 指定输出，`-t` 指定主题
**文件**：`data/skills/skill-1773219299595-wj05ul/SKILL.md`、`data/skills/skill-ppt-generator/SKILL.md`

### 额外：Docker sandbox 镜像更新
- Dockerfile 加入 `python-pptx==1.0.2`
- 重建镜像 `openclaw-sandbox:enterprise`
**文件**：`docker/sandbox/Dockerfile`

## 三、SKILL.md 文档修正

**改动**：所有 `python3 {{SKILL_DIR}}/scripts/ppt_renderer.py` 命令改为 `run_skill()` 调用方式
- Phase 4 渲染生成、迭代修改、快速生成、完整示例、底部调用说明 — 共 5 处
- 加入参数格式表格和 ⚠️ 禁止使用 `--config` 的警告

## 四、心跳巡检禁用 Bug 修复

**问题**：在 Admin Console 配置界面禁用心跳后，心跳仍然继续执行
**根因**：`scheduler.ts` 禁用/删除心跳时设置 `heartbeat: { every: 'disabled' }`，native gateway 不认识 `'disabled'`，忽略该值继续执行
**修复**（3 处）：
1. PUT 更新禁用：`delete nextTargetAgent.heartbeat`
2. PUT 切换 agent：`delete oldTargetAgent.heartbeat`
3. DELETE 删除：`delete targetAgent.heartbeat`
- 同时从 `openclaw.json` 中手动移除了 `ent_user-baizh_default` 的 heartbeat 配置
**文件**：`apps/gateway/src/routes/scheduler.ts`

## 五、测试验证结果

| Skill | run_skill 调用 | 状态 |
|-------|---------------|------|
| ppt-generator | ✅ exitCode=0（传正确参数后） | 成功生成 12 页 PPT |
| echarts-visualization | ✅ exitCode=2（缺数据文件参数，正常） | 依赖正常 |

## 六、新增的 Lessons Learned（已写入 CLAUDE.md）

1. Plugin Prisma schema 必须包含所有代码中用到的模型
2. Python skill 用共享 venv 预装依赖，不依赖脚本内 pip install
3. `tools.sandbox.tools.allow: ["*"]` 必须配置否则 plugin 工具不可见
4. 多层 bug 逐层排查（数据层→环境层→参数层）
5. 禁用心跳必须 delete heartbeat 字段，不能设 `{ every: 'disabled' }`

## 七、变更文件清单

```
plugins/enterprise-mcp/prisma/schema.prisma    — 补全 Skill + DatabaseConnection 模型
plugins/enterprise-mcp/src/index.ts            — getInterpreter() venv 支持 + _dataRootGlobal + 执行结果日志
apps/gateway/src/routes/scheduler.ts           — 心跳禁用改用 delete heartbeat
apps/gateway/src/services/SkillsInfo.ts        — 提示词改用 run_skill（上午完成）
docker/sandbox/Dockerfile                      — 加入 python-pptx
data/skills/.venv/                             — 新建 Python 共享虚拟环境
data/skills/skill-*/SKILL.md                   — 参数格式修正
data/skills/skill-*/packages/                  — 预装 pptx 库（备用）
.openclaw-state/openclaw.json                  — 移除心跳配置 + plugins.allow 白名单
CLAUDE.md                                      — 新增 5 条 Lessons Learned
```

## 八、未完成事项

- [ ] 给 Agent 加 `manage_heartbeat` 工具，让用户能通过飞书 IM 控制自己的心跳（暂停/恢复）
- [ ] 需要内部 API `/api/_internal/scheduler/...`（参考 im-internal.ts 的 token 认证模式）
- [ ] 本次改动尚未 commit 和 push 到 GitHub
