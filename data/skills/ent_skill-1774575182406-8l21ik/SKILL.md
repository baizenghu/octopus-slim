---
name: system-info
description: 企业级系统信息采集技能 — 输出服务器基本状态报告
version: 1.0.0
command-dispatch: tool
command-tool: run_skill
---

# System Info Skill

采集当前服务器的基本系统信息，生成 HTML 报告。

## 用法

通过 `run_skill` 调用，无需参数。

## 输出

在 outputs/ 目录生成 `system-info.html` 文件。
