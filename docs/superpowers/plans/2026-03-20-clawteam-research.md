# ClawTeam 多智能体协作研究 Skill 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `clawteam-research` 企业 Skill，通过并行 LLM 调用实现多角色协作研究（调研报告/头脑风暴/发言稿）

**Architecture:** Leader-Worker-Editor 三阶段流水线。Leader 拆分课题为 N 个维度，N 个 Worker 并行调用 DeepSeek API 各自研究一个维度，Editor 整合为最终报告。全部逻辑在一个 Python 脚本中，通过 run_skill 工具触发，企业 Skill 在宿主机执行。

**Tech Stack:** Python 3.12 (tomllib 内置), requests, argparse, concurrent.futures

**Spec:** `docs/superpowers/specs/2026-03-20-clawteam-research-design.md`

**重要发现（与 spec 的差异）：**
- `executeSkillInProcess` 硬编码 **300 秒超时**（`plugins/mcp/src/index.ts`），config.toml 中 `total_timeout` 必须 < 300，设为 **280 秒**
- Python 3.12 内置 `tomllib`，无需安装 `tomli`
- `.venv` 中未安装 `requests`，需先安装
- 进度信息写 stderr（run_skill 返回 stderr 字段），结果 JSON 写 stdout
- 入口脚本通过 `resolveSkillScript()` 自动发现：在 `scripts/` 目录下找到 `.py` 文件

---

## File Map

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| Create | `data/skills/clawteam-research/SKILL.md` | Skill 描述（Agent 发现 + run_skill 匹配） |
| Create | `data/skills/clawteam-research/config.toml` | API 地址 + 模型 + 参数配置 |
| Create | `data/skills/clawteam-research/scripts/research_coordinator.py` | 主协调脚本（~280 行） |
| Create | `data/skills/clawteam-research/templates/research-survey.toml` | 调研报告团队模板 |
| Create | `data/skills/clawteam-research/templates/brainstorm.toml` | 头脑风暴团队模板 |
| Create | `data/skills/clawteam-research/templates/speech-draft.toml` | 发言稿团队模板 |

---

### Task 1: 安装依赖

**Files:**
- Modify: `data/skills/.venv/` (pip install)

- [ ] **Step 1: 安装 requests 到共享 venv**

```bash
data/skills/.venv/bin/pip install requests
```

- [ ] **Step 2: 验证安装**

```bash
data/skills/.venv/bin/python3 -c "import requests; print(requests.__version__)"
```

Expected: 版本号输出（如 `2.32.3`）

- [ ] **Step 3: 验证 tomllib 内置可用**

```bash
data/skills/.venv/bin/python3 -c "import tomllib; print('tomllib OK')"
```

Expected: `tomllib OK`（Python 3.12 内置）

---

### Task 2: 创建目录结构和 SKILL.md

**Files:**
- Create: `data/skills/clawteam-research/SKILL.md`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p data/skills/clawteam-research/{scripts,templates}
```

- [ ] **Step 2: 创建 SKILL.md**

写入文件 `data/skills/clawteam-research/SKILL.md`：

```markdown
---
name: clawteam-research
description: 多角色团队协作式研究分析工具（调研报告/头脑风暴/发言稿）
license: MIT
compatibility: opencode
metadata:
  audience: 国企用户
  category: 研究分析
---

# ClawTeam 多智能体协作研究

## 能力
多角色团队协作式研究分析工具，借鉴 ClawTeam 多 Agent 协调模式。
支持三种工作模式：
- 调研报告（research-survey）：政策/行业/技术调研，输出正式调研报告
- 头脑风暴（brainstorm）：多视角创意发散与方案收敛
- 发言稿（speech-draft）：领导讲话稿/汇报材料撰写

## 参数
通过 run_skill 的 args 字符串传递命令行参数：

| 参数 | 必填 | 说明 |
|------|------|------|
| --topic | 是 | 研究/讨论主题 |
| --template | 否 | 模板名：research-survey / brainstorm / speech-draft。不指定时根据关键词自动匹配 |
| --context | 否 | 补充背景（目标受众、字数要求、特殊要求等） |
| --depth | 否 | 研究深度：quick(3 worker) / standard(5) / deep(7)，默认 standard |

## 触发示例
- "用 clawteam 调研 国企数字化转型中AI大模型的落地路径"
- "用 clawteam 头脑风暴 如何提升集团内部知识管理效率"
- "用 clawteam 写发言稿 集团年度科技创新大会领导致辞"

## 调用方式
run_skill(skill_name="clawteam-research", args="--topic '国企数字化转型' --template research-survey --depth standard")

## 输出
Markdown 格式报告，保存至 outputs/ 目录。
```

---

### Task 3: 创建 config.toml

**Files:**
- Create: `data/skills/clawteam-research/config.toml`

- [ ] **Step 1: 创建 config.toml**

写入文件 `data/skills/clawteam-research/config.toml`：

```toml
[api]
# 内网 DeepSeek 代理地址
# 推荐通过环境变量 CLAWTEAM_API_URL / CLAWTEAM_API_KEY 配置
base_url = "http://10.x.x.x:port/v1"
api_key = ""  # 留空，优先从环境变量 CLAWTEAM_API_KEY 读取
timeout = 60  # 单次 API 调用超时（有意低于 spec 的 120s，见时间预算分析）
# 全局超时必须 < 300s（run_skill 硬编码 300s 进程超时）
total_timeout = 280
# 时间预算：Leader(60s,重试120s) + Workers(并行60s) + Editor(60s) = 最多240s < 280s

[models]
leader = "deepseek-chat"
worker = "deepseek-chat"
editor = "deepseek-chat"

[params]
leader_max_tokens = 2000
worker_max_tokens = 3000
editor_max_tokens = 10000
temperature = 0.7
max_concurrent_workers = 5
```

- [ ] **Step 2: 填入实际 API 地址**

编辑 config.toml，将 `base_url` 替换为实际的内网 DeepSeek 代理地址。从 `.octopus-state/octopus.json` 中查找当前配置的 DeepSeek API 地址作为参考。

---

### Task 4: 创建 research-survey.toml 模板

**Files:**
- Create: `data/skills/clawteam-research/templates/research-survey.toml`

- [ ] **Step 1: 创建调研报告模板**

写入文件 `data/skills/clawteam-research/templates/research-survey.toml`，内容完整复制 spec 文档第七章 7.1 节的 TOML 定义（`[template]` + `[leader]` + 5 个 `[[workers]]` + `[editor]`）。

关键内容：
- `keyword_triggers = ["调研", "调查", "分析", "研究", "综述"]`
- Leader: 调研组长（MECE 拆分，输出 JSON）
- Workers: 政策环境分析员、行业现状分析员、核心技术分析员、实施风险分析员、建议方案撰写员
- Editor: 报告整合编辑（摘要→背景→各维度→结论→建议）

---

### Task 5: 创建 brainstorm.toml 模板

**Files:**
- Create: `data/skills/clawteam-research/templates/brainstorm.toml`

- [ ] **Step 1: 创建头脑风暴模板**

写入文件 `data/skills/clawteam-research/templates/brainstorm.toml`，内容完整复制 spec 文档第七章 7.2 节的 TOML 定义。

关键内容：
- `keyword_triggers = ["头脑风暴", "讨论", "策划", "想法", "创意", "方案"]`
- Leader: 主持人
- Workers: 发散思维者、用户视角代言人、魔鬼代言人、落地实践者、跨界借鉴者
- Editor: 方案整理人（议题→各方观点→3-5 个收敛方案→推荐→行动项）

---

### Task 6: 创建 speech-draft.toml 模板

**Files:**
- Create: `data/skills/clawteam-research/templates/speech-draft.toml`

- [ ] **Step 1: 创建发言稿模板**

写入文件 `data/skills/clawteam-research/templates/speech-draft.toml`，内容完整复制 spec 文档第七章 7.3 节的 TOML 定义。

关键内容：
- `keyword_triggers = ["发言稿", "讲话稿", "致辞", "汇报", "述职", "演讲"]`
- Leader: 撰稿统筹（分析场合、受众、基调）
- Workers: 背景素材员、核心观点提炼师、金句文采师、听众预判师
- Editor: 终稿撰写人（开场→主体→结语 + 演讲备注）

---

### Task 7: 创建 research_coordinator.py 主脚本

**Files:**
- Create: `data/skills/clawteam-research/scripts/research_coordinator.py`

这是核心任务。代码完整定义在 spec 文档第八章 8.1 节。以下列出关键实现要点：

- [ ] **Step 1: 创建脚本文件**

写入文件 `data/skills/clawteam-research/scripts/research_coordinator.py`，完整代码来自 spec 第八章。

关键模块（按文件内顺序）：

1. **依赖检查** `check_dependencies()` — 启动时检查 requests，缺失则 JSON 报错退出
2. **配置加载** `load_config()` — 读 config.toml，环境变量优先覆盖，API Key 缺失则报错
3. **模板加载** `load_all_templates()` + `load_template()` + `detect_template()` — 扫描 templates/*.toml 构建关键词映射
4. **LLM 调用** `call_llm()` — OpenAI 兼容格式 POST 请求
5. **Phase 1** `phase_leader()` — Leader 拆分任务，含重试 1 次 + 降级为模板默认维度
6. **Phase 2** `phase_workers()` — ThreadPoolExecutor 并行调用，单个失败不影响整体，过短结果标记警告
7. **Phase 3** `phase_editor()` — 整合报告，失败降级为拼接输出
8. **JSON 解析** `parse_json_response()` — 提取 ```json``` 块或 rindex 找最后一个 JSON 数组
9. **全局超时** `signal.SIGALRM` + `on_timeout()` — 280s 超时保护
10. **主入口** `main()` — argparse 解析参数，三阶段串行执行，输出到 WORKSPACE_PATH/outputs/

**与 spec 的调整**：
- `total_timeout` 默认值改为 280（适配 run_skill 的 300s 硬限）
- `SKILL_DIR` 改为优先读环境变量：`SKILL_DIR = Path(os.environ.get("SKILL_DIR", Path(__file__).parent.parent))`
- `tomllib` 导入顺序修正：先 `import tomllib`（标准库优先），fallback `import tomli`
- `signal.SIGALRM` 加 `hasattr(signal, 'SIGALRM')` 平台防御（Unix-only API）

- [ ] **Step 2: 验证脚本语法**

```bash
data/skills/.venv/bin/python3 -c "import py_compile; py_compile.compile('data/skills/clawteam-research/scripts/research_coordinator.py', doraise=True)"
```

Expected: 无输出（编译成功）

- [ ] **Step 3: 验证 --help 输出**

```bash
data/skills/.venv/bin/python3 data/skills/clawteam-research/scripts/research_coordinator.py --help
```

Expected: 显示 argparse 帮助信息（`--topic`, `--template`, `--context`, `--depth`）

---

### Task 8: 注册 Skill 到数据库并配置 API

**Files:**
- Modify: MySQL `Skill` 表（INSERT）
- Modify: `data/skills/clawteam-research/config.toml`（填入真实 API 地址）

- [ ] **Step 1: 从 octopus.json 获取 DeepSeek API 配置**

```bash
cat .octopus-state/octopus.json | python3 -c "
import sys, json
cfg = json.load(sys.stdin)
models = cfg.get('models', {}).get('providers', [])
for p in models:
    if 'deepseek' in p.get('name', '').lower() or 'deepseek' in str(p.get('baseUrl', '')).lower():
        print(f\"baseUrl: {p.get('baseUrl')}\")
        print(f\"apiKey: {p.get('apiKey', '***')[:10]}...\")
        break
"
```

- [ ] **Step 2: 更新 config.toml 中的 API 地址**

将 Step 1 获取到的 `baseUrl` 填入 config.toml 的 `[api].base_url` 字段。API Key 通过环境变量配置（在 start.sh 中 export `CLAWTEAM_API_KEY`）或直接写入 config.toml。

- [ ] **Step 3: 注册 Skill 到数据库**

查看现有 Skill 记录作为参考，然后插入新记录：

```sql
-- 先查看现有 skill 的实际列名和数据格式
SELECT * FROM skills LIMIT 3;

-- 插入 clawteam-research（注意：Prisma 模型字段名与 DB 列名有映射）
-- id -> skill_id, scriptPath -> script_path, createdAt -> created_at
INSERT INTO skills (skill_id, name, scope, description, status, script_path, enabled, created_at)
VALUES (
  'clawteam-research',
  'clawteam-research',
  'enterprise',
  '多角色团队协作式研究分析工具（调研报告/头脑风暴/发言稿）',
  'approved',
  'scripts/research_coordinator.py',
  1,
  NOW()
);
```

注意：先用 `SELECT *` 确认实际列名，根据实际情况调整 INSERT 语句。

---

### Task 9: 手动端到端测试

- [ ] **Step 1: 命令行测试（quick 模式）**

```bash
CLAWTEAM_API_KEY="<从 step 8.1 获取>" \
WORKSPACE_PATH="/tmp/clawteam-test" \
  data/skills/.venv/bin/python3 \
  data/skills/clawteam-research/scripts/research_coordinator.py \
  --topic "国企数字化转型中AI大模型的应用现状" \
  --template research-survey \
  --depth quick
```

Expected:
- stderr 显示三阶段进度
- stdout 输出 JSON（status: success, dimensions, output_file）
- `/tmp/clawteam-test/outputs/clawteam-research-survey-*.md` 文件存在且内容完整

- [ ] **Step 2: 验证报告质量**

```bash
# 查看报告长度和结构
wc -l /tmp/clawteam-test/outputs/clawteam-research-survey-*.md
head -50 /tmp/clawteam-test/outputs/clawteam-research-survey-*.md
```

Expected: 报告至少 100 行，包含标题、摘要、各维度章节

- [ ] **Step 3: 测试关键词自动匹配**

```bash
CLAWTEAM_API_KEY="<key>" \
WORKSPACE_PATH="/tmp/clawteam-test" \
  data/skills/.venv/bin/python3 \
  data/skills/clawteam-research/scripts/research_coordinator.py \
  --topic "头脑风暴如何提升知识管理效率" \
  --depth quick
```

Expected: stderr 显示 `模式: brainstorm`（自动匹配而非默认 research-survey）

- [ ] **Step 4: 测试错误降级**

```bash
# 测试无效 API Key 的错误提示
CLAWTEAM_API_KEY="" \
  data/skills/.venv/bin/python3 \
  data/skills/clawteam-research/scripts/research_coordinator.py \
  --topic "测试"
```

Expected: JSON 输出 `{"error": "未配置 API Key..."}`，exit code 1

---

### Task 10: 提交代码

- [ ] **Step 1: 检查文件完整性**

```bash
find data/skills/clawteam-research/ -type f | sort
```

Expected:
```
data/skills/clawteam-research/SKILL.md
data/skills/clawteam-research/config.toml
data/skills/clawteam-research/scripts/research_coordinator.py
data/skills/clawteam-research/templates/brainstorm.toml
data/skills/clawteam-research/templates/research-survey.toml
data/skills/clawteam-research/templates/speech-draft.toml
```

- [ ] **Step 2: 提交**

```bash
git add data/skills/clawteam-research/
git commit -m "feat: add clawteam-research multi-agent collaboration skill

Implements Leader-Worker-Editor pattern inspired by ClawTeam/OpenClaw.
Three team templates: research-survey, brainstorm, speech-draft.
Parallel LLM calls via ThreadPoolExecutor for multi-perspective analysis."
```

---

## 执行检查清单

完成所有 Task 后，确认以下全部通过：

- [ ] `grep -A2 'extraDirs' .octopus-state/octopus.json` 包含 `data/skills`
- [ ] `data/skills/.venv/bin/python3 -c "import requests"` 成功
- [ ] `data/skills/clawteam-research/SKILL.md` 存在且有 YAML frontmatter
- [ ] `config.toml` 中 `base_url` 已填入实际地址
- [ ] 3 个 `.toml` 模板文件均在 `templates/` 目录下
- [ ] `research_coordinator.py --help` 正常输出
- [ ] quick 模式命令行测试产出 Markdown 报告
- [ ] 关键词自动匹配工作正常
- [ ] 错误情况（无 API Key）给出友好提示
- [ ] DB 中已注册 Skill 记录
- [ ] 代码已提交
