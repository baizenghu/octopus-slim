---
name: claude-code-dispatch
description: 将开发任务派发给 Claude Code 后台执行，完成后通过飞书自动通知
version: 1.0.0
command-dispatch: tool
command-tool: run_skill
---

# Claude Code Dispatch

将编码任务派发给 Claude Code 在后台执行，完成后自动通知。

## 重要规则

1. **只能通过 `run_skill` 调用，禁止用 exec/bash 执行脚本或检查文件**
2. 技能在宿主机执行，不在沙箱内，所以 exec 看不到技能文件是正常的
3. `run_skill` 会立即返回，Claude Code 在后台继续执行
4. 完成后自动通过飞书通知 + Web 端会话回显结果

---

## 调用方式

**必须严格按以下格式调用，不要修改参数名：**

### 在指定项目目录执行任务（最常用）

```
run_skill(skill_name="claude-code-dispatch", args="--prompt '你的任务描述' --name 任务名 --workdir /项目/绝对路径 --max-turns 30")
```

### 在用户工作空间执行任务

```
run_skill(skill_name="claude-code-dispatch", args="--prompt '你的任务描述' --name 任务名 --max-turns 20")
```

### 带成本控制

```
run_skill(skill_name="claude-code-dispatch", args="--prompt '你的任务描述' --name 任务名 --workdir /项目路径 --max-budget-usd 5.00 --max-turns 50")
```

### 带多代理协作

```
run_skill(skill_name="claude-code-dispatch", args="--prompt '你的任务描述' --name 任务名 --workdir /项目路径 --agent-teams --max-turns 40")
```

---

## 参数说明

| 参数 | 必需 | 说明 |
|------|------|------|
| `--prompt '...'` | **是** | 任务描述，用单引号包裹 |
| `--name xxx` | 建议 | 任务名称，英文短横线连接，如 `add-login-page` |
| `--workdir /path` | 建议 | Claude Code 工作目录（绝对路径）。不指定则使用用户 workspace |
| `--max-turns N` | 建议 | 最大对话轮次，防止无限循环，建议 20-50 |
| `--max-budget-usd N` | 可选 | 最大花费（美元），如 `5.00` |
| `--model xxx` | 可选 | 模型覆盖，如 `sonnet`、`opus` |
| `--fallback-model xxx` | 可选 | 备用模型 |
| `--agent-teams` | 可选 | 启用多代理模式（自动创建测试代理） |
| `--verbose` | 可选 | 详细日志 |

---

## 完整示例

用户说"帮我在 octopus 项目里添加注册功能"，你应该这样调用：

```
run_skill(skill_name="claude-code-dispatch", args="--prompt '分析 octopus 项目架构，设计并实现用户注册功能，包括前端注册页面和后端 API' --name add-registration --workdir /home/baizh/octopus --max-turns 30")
```

用户说"写一个 Python 数据分析脚本"，你应该这样调用：

```
run_skill(skill_name="claude-code-dispatch", args="--prompt '创建一个 Python 脚本，读取 CSV 文件并生成数据分析报告' --name data-analysis --max-turns 20")
```

---

## 结果查看

任务完成后结果自动写入 `outputs/claude-code-results/` 目录：

- `latest.json` — 完整结果（JSON 格式）
- `task-output.txt` — Claude Code 原始输出
- `task-meta.json` — 任务元数据（名称、耗时、状态）
- `hook.log` — 通知日志

用文件工具（read_file）查看，不要用 exec：

```
read_file(path="outputs/claude-code-results/latest.json")
read_file(path="outputs/claude-code-results/task-output.txt")
```

---

## 注意事项

- **仅外网可用** — 需要 Anthropic API 访问，内网环境无法使用
- **后台运行** — `run_skill` 立即返回"任务已派发"，这是正常行为，不是失败
- **自动通知** — 不需要轮询，完成后飞书 + Web 端自动收到结果
- **成本控制** — 多代理任务消耗大量 token，务必设置 `--max-budget-usd`
