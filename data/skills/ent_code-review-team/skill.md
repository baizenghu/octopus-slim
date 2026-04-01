---
name: code-review-team
description: 多视角并行代码审查 — 4 个专项 Agent 同时从业务逻辑、代码质量、稳定性、安全四个维度审查代码
version: 1.0.0
author: octopus-team
triggers:
  - 代码审查
  - code review
  - 并行审查
  - /review
command-dispatch: tool
timeout: 300
coordinator:
  mode: parallel
  maxWorkers: 4
  aggregation: auto
---

# 多代理并行代码审查技能

使用 Coordinator 模式并行启动 4 个专项 Agent，从不同维度审查代码：

- **Agent A（业务逻辑）**：API 语义、数据流、业务规则、边界条件
- **Agent B（代码质量）**：重复代码、死代码、命名规范、可维护性
- **Agent C（稳定性）**：内存泄漏、异常处理、资源清理、并发安全
- **Agent D（安全）**：注入风险、认证鉴权、数据泄露、依赖安全

## 使用方式

```
/skill code-review-team [文件路径或描述]
```

## Coordinator 配置

此技能使用 `sessions_spawn` 工具同时派发 4 个子任务，父 Agent（Coordinator）
等待所有 Worker 完成后汇总去重生成最终报告。

汇总规则：
1. 相同文件+行号的问题合并，取最高严重级别
2. 按严重级别排序（Critical > High > Medium > Low）
3. 相同类型问题分组展示
