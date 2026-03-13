# Phase 7: 文档和项目配置（低风险）

> **状态:** 待执行 | **预估:** 2-3h | **依赖:** Phase 3（需要架构确定后再写）
> **Task 7.2/7.3 可提前执行**

---

## Task 7.1: 创建 CLAUDE.md

从 `/home/baizh/openclaw-enterprise/CLAUDE.md` 复制，全面替换：

**品牌替换：**
- `OpenClaw Enterprise` → `Octopus`
- `openclaw` → `octopus`（全小写）
- `OpenClaw` → `Octopus`（首字母大写）
- `OPENCLAW_` → `OCTOPUS_`

**架构更新（重要）：**
- 删除双进程架构图，改为单进程
- 删除 Native OpenClaw Gateway 服务条目
- 删除 `OPENCLAW_GATEWAY_URL` 等已废弃的环境变量说明
- 更新 `OpenClawBridge` 相关描述为 `EngineAdapter`
- 更新端口信息（只有 18790 和 3001）
- 更新启动命令（`./start.sh` 而非 `./start-dev.sh`）

**Lessons Learned 更新：**
- 保留所有教训内容（宝贵的踩坑记录）
- 只更新术语（openclaw → octopus）
- 标记已不适用的教训（如双进程相关的）

**Commit:**
```bash
git add CLAUDE.md
git commit -m "docs: 创建 Octopus 项目 CLAUDE.md"
```

---

## Task 7.2: 更新 Memory 文件

为新项目创建 Claude memory 目录和文件：

```bash
# Claude 会自动在以下路径创建 memory
# /home/baizh/.claude/projects/-home-baizh-octopus/memory/MEMORY.md
```

从 `/home/baizh/.claude/projects/-home-baizh-openclaw-enterprise/memory/MEMORY.md` 复制内容，更新：
- 所有 `openclaw` → `octopus` 术语
- 架构描述改为单进程
- 删除 `OpenClawBridge` 相关描述
- 删除 native gateway 相关配置
- 更新环境变量名

---

## Task 7.3: 其他文档

从 `openclaw-enterprise/docs/` 选择性复制仍然有价值的文档：

**需要迁移（修改后）：**
- `deployment-guide.md` — 需要大幅修改（单进程、新品牌）
- `deployment-pitfall-guide.md` — 部分教训仍适用
- `skill-development-guide.md` — Skill 开发指南不变
- `production-security-config.md` — 安全配置仍适用

**不需要迁移：**
- `docs/plans/` — 旧的 sprint 计划
- `docs/reports/` — 旧的审计报告
- `docs/archive/` — 历史档案
- `docs/claude-memory/` — 旧的 AI 记忆

**Commit:**
```bash
git add docs/
git commit -m "docs: 迁移并更新关键文档"
```
