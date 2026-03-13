# Octopus 合并实施计划（索引）

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 openclaw-main（原生引擎）和 openclaw-enterprise（企业层）合并为单进程项目 Octopus，抹除所有 openclaw 痕迹。

**Architecture:** 原生引擎核心作为 `@octopus/engine` 包引入（保持内部结构），企业层各模块重命名为 `@octopus/*`，删除 OpenClawBridge RPC 层，改为进程内直接调用。

**Tech Stack:** Node.js 22+, TypeScript 5.4, pnpm 9 monorepo, Turbo, Express 4, React 18, Prisma 6 (MySQL), Vitest

**设计文档:** [`2026-03-12-octopus-merge-design.md`](./2026-03-12-octopus-merge-design.md)

---

## 关键发现（影响计划）

1. **原生代码耦合度高**：agents/ 依赖 config/(70+次)、logging/(30+次)、infra/(20+次)、routing/、channels/、plugins/ — 无法单独提取 agents/，需整体引入 src/
2. **原生代码量大**：800+ 源文件，但只需 ~500 个核心文件（丢弃 40 个渠道、移动端 app、独立 bot）
3. **OpenClawBridge 有 25+ 个 RPC 方法**，被 6 个路由文件 + 1 个 IM 服务调用，是最核心的重构点
4. **Plugin SDK 提供 24 个 Hook + registerTool 等 10 个注册方法**，企业插件深度依赖

---

## Phase 列表

| Phase | 文件 | 内容 | 风险 | 预估 | 依赖 |
|-------|------|------|------|------|------|
| **0** | [`phase-0-scaffold.md`](./phase-0-scaffold.md) | 项目脚手架 | 无 | 0.5h | 无 |
| **1** | [`phase-1-engine.md`](./phase-1-engine.md) | 引入原生引擎核心 | **高** | 8-12h | Phase 0 |
| **2** | [`phase-2-enterprise.md`](./phase-2-enterprise.md) | 迁移企业层代码 | 中 | 3-4h | Phase 0 |
| **3** | [`phase-3-merge.md`](./phase-3-merge.md) | **单进程合并（核心）** | **最高** | 12-16h | Phase 1+2 |
| **4** | [`phase-4-console.md`](./phase-4-console.md) | 迁移 Admin Console | 低 | 1-2h | Phase 0 |
| **5** | [`phase-5-infra.md`](./phase-5-infra.md) | 基础设施和脚本 | 中 | 2-3h | Phase 3 |
| **6** | [`phase-6-data.md`](./phase-6-data.md) | 状态目录和数据迁移 | 中 | 1-2h | Phase 0 |
| **7** | [`phase-7-docs.md`](./phase-7-docs.md) | 文档和项目配置 | 低 | 2-3h | Phase 3 |
| **8** | [`phase-8-verify.md`](./phase-8-verify.md) | 验证和测试 | - | 4-6h | 所有 |

**总计: 24 个 Task, ~35-50h**

---

## 执行顺序和依赖关系

```
Phase 0 (脚手架)
  ├─→ Phase 1 (引擎核心) ──┐
  ├─→ Phase 2 (企业层) ────┼─→ Phase 3 (单进程合并) ─→ Phase 5 (基础设施)
  ├─→ Phase 4 (前端) ──────┘                          └─→ Phase 7 (文档)
  └─→ Phase 6 (数据) ── 独立
                                                        └─→ Phase 8 (验证)
```

**可并行**: Phase 1+2+4+6 | **必须串行**: 0 → 1&2 → 3 → 5 → 8

---

## 风险矩阵

| 风险 | 影响 | 可能性 | 缓解措施 |
|------|------|--------|---------|
| 原生代码删除模块后 import 断裂 | 高 | 高 | Task 1.1 Step 4 逐个修复，保留 stub |
| EngineAdapter 方法签名与原生 API 不匹配 | 高 | 中 | 参考 IntegrationAgent 的完整 RPC 列表 |
| Plugin SDK API 变化导致企业插件无法加载 | 高 | 中 | 先确保 engine Plugin loader 工作再改企业插件 |
| sed 全局替换误伤（如变量名包含 openclaw 子串） | 中 | 中 | 替换后 diff 审查 + 编译验证 |
| 单进程中引擎全局状态冲突 | 高 | 低 | 引擎初始化隔离在 EngineAdapter 中 |
