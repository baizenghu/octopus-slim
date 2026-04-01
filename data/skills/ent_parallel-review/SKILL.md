---
name: parallel-review
description: 多视角并行代码审查 — 4 个专项 Agent 同时分析业务逻辑、代码质量、稳定性、安全
version: 1.0.0
author: octopus-team
triggers:
  - 代码审查
  - code review
  - 并行审查
command-dispatch: tool
command-tool: run_skill
timeout: 300
---

# 并行代码审查技能

使用 4 个专项 Agent 同时对目标代码进行多维度审查：
- **Agent A (业务逻辑)**：API 语义正确性、数据流、业务规则
- **Agent B (代码质量)**：重复代码、死代码、可维护性
- **Agent C (稳定性)**：内存泄漏、异常处理、资源清理
- **Agent D (安全)**：注入风险、认证鉴权、数据泄露

## 使用方式

```
/skill parallel-review [文件路径或 PR 描述]
```

## 输出格式

每个 Agent 输出以 `[X-NNN]` 编号标识问题，最终汇总去重生成综合报告。

## 升级说明

此技能已升级为 `code-review-team`（使用 Coordinator 模式真正并行）。
建议使用 `/skill code-review-team` 代替此技能。
