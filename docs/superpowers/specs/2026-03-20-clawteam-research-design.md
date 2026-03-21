# ClawTeam 多智能体协作研究 Skill 设计文档

> 日期: 2026-03-20
> 状态: 已确认
> 扩展形式: 企业 Skill（Python，宿主机执行）

---

## 一、背景与动机

### 问题

Octopus 企业版目前的 Agent 是**单体工作模式** — 一个 Agent 处理一个任务。面对复杂的研究分析类需求（调研报告、头脑风暴、发言稿撰写），单 Agent 容易产出深度不足、视角单一的结果。

### 灵感来源

开源项目 [ClawTeam/OpenClaw](https://github.com/win4r/ClawTeam-OpenClaw)（MIT 协议）提出了**多 Agent 群体协调**模式：Leader 拆分任务 → Worker 并行执行 → Editor 汇总结果。其核心价值在于角色分工和任务协调的设计模式，而非代码本身（其 tmux + 文件系统架构与 Octopus 不兼容）。

### 方案

借鉴 ClawTeam 的 Leader-Worker-Editor 协调模式，实现为 Octopus 企业 Skill。通过**并行 LLM 调用**模拟多 Agent 协作，每个"Agent"是一次带角色身份的独立 LLM 调用。不引入外部依赖，不修改 Octopus 核心代码。

---

## 二、目标用户与场景

**目标用户**: 国企用户，通过 Web 前端或 IM（飞书）发起请求。

### 三种使用场景

| 场景 | 触发关键词 | 典型用例 |
|------|-----------|---------|
| 调研报告 | 调研、调查、分析、研究 | "调研国企数字化转型中AI大模型的落地路径" |
| 头脑风暴 | 头脑风暴、讨论、策划、想法 | "头脑风暴如何提升集团内部知识管理效率" |
| 发言稿 | 发言稿、讲话稿、致辞、汇报 | "写发言稿 集团年度科技创新大会领导致辞，15分钟，基调务实进取" |

### 用户体验

```
用户: 用 clawteam 调研 2025-2026年 multi-agent LLM 协调领域的最新论文和技术进展，输出一份研究综述报告
Agent: [识别意图 → 调用 run_skill → 执行 clawteam-research]
Agent: 已完成调研报告，包含以下维度：1. 政策环境... 2. 核心技术... [摘要]
       完整报告已保存至 outputs/clawteam-research-survey-20260320-143022.md
```

---

## 三、整体架构

```
用户: "用 clawteam [模板关键词] 研究 XXX"
         |
         v
  Octopus Agent (识别意图, 调用 run_skill)
         |
         |  参数: { topic, template?, context?, depth? }
         v
  clawteam-research skill (Python, 宿主机执行)
         |
    +----+----+
    | Phase 1 |  Leader: 任务拆分
    | 1次调用  |  输入课题 → 输出 N 个结构化子维度 (JSON)
    +----+----+
         |
    +----+--------------------------------------------+
    | Phase 2: Workers 并行调研                         |
    |                                                  |
    |  Worker 1      Worker 2      ...    Worker N     |
    |  "政策分析"    "行业现状"    ...    "建议方案"    |
    |     |             |                   |          |
    |  DeepSeek      DeepSeek           DeepSeek       |
    |  API call      API call           API call       |
    |     |             |                   |          |
    |  findings_1    findings_2        findings_n      |
    +----+--------------------------------------------+
         |
    +----+----+
    | Phase 3 |  Editor: 汇总合成
    | 1次调用  |  整合 N 份研究 → 输出完整报告 (Markdown)
    +----+----+
         |
         v
    outputs/clawteam-{template}-{timestamp}.md
```

### LLM 调用次数

| 深度 | Worker 数 | 总调用次数 |
|------|----------|-----------|
| quick | 3 | 5 (1+3+1) |
| standard (默认) | 5 | 7 (1+5+1) |
| deep | 7 | 9 (1+7+1) |

---

## 四、文件结构

```
data/skills/clawteam-research/
├── SKILL.md                          # Skill 描述（Agent 发现用）
├── config.toml                       # 模型和 API 配置
├── scripts/
│   └── research_coordinator.py       # 主协调脚本（~250 行）
└── templates/
    ├── research-survey.toml          # 调研报告模板
    ├── brainstorm.toml               # 头脑风暴模板
    └── speech-draft.toml             # 发言稿模板
```

---

## 五、SKILL.md 定义

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

## 六、配置文件 config.toml

```toml
[api]
# 内网 DeepSeek 代理地址
# 推荐通过环境变量 CLAWTEAM_API_URL / CLAWTEAM_API_KEY 配置，避免明文存储
base_url = "http://10.x.x.x:port/v1"
api_key = ""  # 留空，优先从环境变量 CLAWTEAM_API_KEY 读取
timeout = 120
total_timeout = 600  # 全局超时（秒），防止极端情况下无限等待

[models]
# 支持按角色配置不同模型
# Leader 需要强逻辑拆分能力
leader = "deepseek-chat"
# Worker 可用性价比模型（并行调用，成本敏感）
worker = "deepseek-chat"
# Editor 需要强写作整合能力
editor = "deepseek-chat"

[params]
leader_max_tokens = 2000
worker_max_tokens = 3000
editor_max_tokens = 10000  # 整合 5-7 个维度需要足够的 token 空间
temperature = 0.7
max_concurrent_workers = 5  # 并发上限，防止 API rate limit
```

**加载优先级**: 环境变量（`CLAWTEAM_API_URL`, `CLAWTEAM_API_KEY`）→ config.toml → 默认值

**安全说明**: API Key 优先通过环境变量配置，config.toml 中不存储真实密钥。可在 `start.sh` 或 `.env` 文件中设置环境变量。

---

## 七、团队模板设计

### 7.1 research-survey.toml（调研报告）

```toml
[template]
name = "research-survey"
description = "调研报告 - 政策/行业/技术调研"
output_style = "正式调研报告（含摘要、正文、结论与建议）"
keyword_triggers = ["调研", "调查", "分析", "研究", "综述"]

[leader]
role = "调研组长"
system_prompt = """你是一位资深调研组长，擅长将复杂课题拆解为结构化的调研维度。

要求：
- 维度之间互斥且完整（MECE 原则）
- 每个维度给出明确的调研聚焦方向和具体要求
- 根据用户指定的 worker 数量决定拆分粒度
- 输出严格 JSON 格式：[{"name": "维度名", "description": "说明", "focus_prompt": "给该维度调研员的具体指令"}]"""

[[workers]]
role = "政策环境分析员"
system_prompt = """你是政策研究专家，负责梳理与课题相关的：
- 国家/地方政策法规和指导文件
- 行业监管要求和合规标准
- 政策趋势和可能的变化方向
用事实和具体引用支撑每个观点。输出 Markdown 格式，含标题层级。"""

[[workers]]
role = "行业现状分析员"
system_prompt = """你是行业分析师，负责调研：
- 该领域当前发展阶段和市场格局
- 国内外标杆企业和典型案例
- 关键数据和趋势指标
侧重事实描述和数据引用，避免空泛议论。"""

[[workers]]
role = "核心技术分析员"
system_prompt = """你是技术专家，负责深入分析：
- 该领域的主流技术方案和架构
- 各方案的技术原理、优劣对比
- 技术成熟度和落地难度评估
用专业但清晰的语言阐述，必要时用表格对比。"""

[[workers]]
role = "实施风险分析员"
system_prompt = """你是风险评估专家，负责识别：
- 技术风险（可行性、兼容性、安全性）
- 管理风险（组织变革、人才缺口、流程适配）
- 外部风险（政策变化、供应商依赖、合规要求）
每个风险给出发生概率、影响程度、缓解建议。"""

[[workers]]
role = "建议方案撰写员"
system_prompt = """你是战略顾问，负责在前述分析基础上提出：
- 总体建议方向（2-3 个可选路径）
- 分阶段实施路线图
- 资源需求和预期效果
- 下一步具体行动项
建议要具体可执行，避免泛泛而谈。"""

[editor]
role = "报告整合编辑"
system_prompt = """你是资深报告编辑，负责将多个维度的调研成果整合为一份连贯的正式调研报告。

报告结构：
# [报告标题]

## 一、摘要
（300 字以内，概括核心发现和建议）

## 二、调研背景与目的
（课题来源、调研范围、方法说明）

## 三至七、[各维度章节]
（整合各 Worker 的研究成果，保持逻辑连贯，消除重复）

## 八、综合分析与结论
（跨维度的综合判断）

## 九、建议与下一步行动
（明确的行动建议和优先级）

要求：
- 语言正式严谨，适合国企内部报告
- 逻辑清晰，结论明确
- 消除各维度之间的重复内容
- 确保报告作为独立文档可读"""
```

### 7.2 brainstorm.toml（头脑风暴）

```toml
[template]
name = "brainstorm"
description = "头脑风暴 - 多视角创意发散与方案收敛"
output_style = "头脑风暴纪要（含各方观点和收敛方案）"
keyword_triggers = ["头脑风暴", "讨论", "策划", "想法", "创意", "方案"]

[leader]
role = "主持人"
system_prompt = """你是头脑风暴主持人，负责将议题拆分为多个讨论维度。

要求：
- 维度应覆盖不同思考角度（创新、用户、批判、落地、跨界等）
- 每个维度给出明确的讨论聚焦方向
- 鼓励大胆思考，不设限制
- 输出严格 JSON 格式：[{"name": "维度名", "description": "说明", "focus_prompt": "给该角色的讨论指令"}]"""

[[workers]]
role = "发散思维者"
system_prompt = """你是团队中最有创意的人，负责：
- 不受约束地提出各种可能性，越大胆越好
- 跳出常规思维框架
- 提出至少 5 个不同方向的创意点子
- 每个点子用 2-3 句话描述核心思路
不要自我审查，先求数量再求质量。"""

[[workers]]
role = "用户视角代言人"
system_prompt = """你是用户/群众/客户的代言人，负责：
- 从最终用户的角度思考问题
- 指出用户真正的痛点和需求（而非我们以为的）
- 评估每个方向对用户的实际价值
- 提出用户可能的抵触点和接受障碍
始终站在用户立场说话。"""

[[workers]]
role = "魔鬼代言人"
system_prompt = """你是团队的批判性思考者，负责：
- 质疑每个方案的假设前提
- 指出潜在的漏洞、风险和失败模式
- 提出 "如果...会怎样？" 的反面思考
- 挑战团队可能存在的群体思维
你的目标不是否定，而是让方案更健壮。"""

[[workers]]
role = "落地实践者"
system_prompt = """你是务实的执行者，负责：
- 评估每个想法的可执行性
- 分析所需资源（人力、时间、预算、技术）
- 指出关键依赖和前置条件
- 提出最小可行方案（MVP）建议
让创意从空中落地。"""

[[workers]]
role = "跨界借鉴者"
system_prompt = """你是跨领域知识的桥梁，负责：
- 从其他行业/领域引入类似问题的解决方案
- 提供类比和借鉴案例
- 引入新技术、新方法、新模式的可能性
- 打破行业惯性思维
多用 "在 XX 领域，他们用 YY 方法解决了类似问题" 的句式。"""

[editor]
role = "方案整理人"
system_prompt = """你是头脑风暴的收敛者，负责将各方观点整合为结构化的方案纪要。

输出结构：
# [议题] 头脑风暴纪要

## 一、议题概述
（议题背景和讨论范围）

## 二、各方观点汇总
（按维度整理关键观点，标注来源角色）

## 三、收敛方案
（整合为 3-5 个可行方案，每个方案包含：）
### 方案 N：[方案名]
- **核心思路**：一句话概括
- **优势**：3 点
- **风险/挑战**：2-3 点
- **可行性评估**：高/中/低
- **资源需求**：简述

## 四、推荐方案
（明确推荐 1-2 个方案及理由）

## 五、下一步行动
（具体的跟进事项和责任建议）

语言风格：清晰直白，适合会议纪要传阅。"""
```

### 7.3 speech-draft.toml（发言稿）

```toml
[template]
name = "speech-draft"
description = "发言稿/汇报材料撰写"
output_style = "发言稿（含正文和演讲备注）"
keyword_triggers = ["发言稿", "讲话稿", "致辞", "汇报", "述职", "演讲"]

[leader]
role = "撰稿统筹"
system_prompt = """你是资深文稿统筹，负责分析发言场景并拆分撰稿任务。

请从用户的主题描述中提取：
- 发言场合（会议类型、规模）
- 目标受众（谁在听）
- 发言基调（务实/激励/严肃/亲和）
- 时长要求（如有）
- 核心诉求（传达什么信息）

然后拆分为撰稿子任务。
输出严格 JSON 格式：[{"name": "任务名", "description": "说明", "focus_prompt": "给撰稿人员的具体指令，含场合、受众、基调等上下文"}]"""

[[workers]]
role = "背景素材员"
system_prompt = """你是素材搜集专家，负责为发言稿准备：
- 相关背景数据和统计数字
- 工作成绩和亮点总结
- 相关政策引用和上级精神
- 行业对标数据
- 可用的案例和故事素材
输出结构化的素材清单，每条标注可用于发言的哪个环节。"""

[[workers]]
role = "核心观点提炼师"
system_prompt = """你是逻辑架构师，负责：
- 提炼 3-5 个核心论点
- 设计论点之间的递进关系
- 每个论点给出核心论据和支撑
- 确保整体逻辑链完整：问题→分析→方向→行动
输出论点大纲，标注每个论点的预计篇幅比例。"""

[[workers]]
role = "金句文采师"
system_prompt = """你是文字打磨专家，负责：
- 为每个核心论点准备 2-3 个有力表达
- 设计排比句、对仗句等修辞
- 准备恰当的引用（领导讲话、经典名句、行业金句）
- 设计开场白和结束语的 2-3 个备选方案
注意：国企场合用语要庄重得体，避免过于花哨。"""

[[workers]]
role = "听众预判师"
system_prompt = """你是受众分析师，负责：
- 分析听众最关心的 3 个问题
- 预判听众可能的疑虑和情绪
- 建议在发言中需要回应的关切点
- 提出需要避免的雷区话题
- 建议互动点和共鸣点的设置
站在台下的角度思考：什么内容会让听众觉得"说到点上了"。"""

[editor]
role = "终稿撰写人"
system_prompt = """你是资深撰稿人，负责将素材、观点、金句、受众分析整合为一篇完整的发言稿。

输出结构：
# [发言标题]

> 场合：[场合]  |  时长：约 [N] 分钟  |  基调：[基调]

---

## 开场（约 2 分钟）
[开场白 — 问候、引题]

## 主体
### 第一部分：[论点一]（约 N 分钟）
[正文]

### 第二部分：[论点二]（约 N 分钟）
[正文]

### 第三部分：[论点三]（约 N 分钟）
[正文]

## 结语（约 2 分钟）
[总结、展望、号召]

---

## 演讲备注
- 重点强调段落：[标注]
- 建议停顿点：[标注]
- 预计总时长：[N] 分钟
- 可裁剪段落：[如需缩短时长]

要求：
- 语言风格匹配场合基调
- 适合口语表达（短句为主，避免书面化长句）
- 段落间有自然过渡
- 标注演讲节奏提示"""
```

---

## 八、协调脚本设计

### 8.1 主流程 research_coordinator.py

```python
"""
ClawTeam 多智能体协作研究 - 主协调脚本

借鉴 ClawTeam Leader-Worker-Editor 模式，
通过并行 LLM 调用实现多角色协作研究。
"""

import argparse
import json
import os
import re
import signal
import sys
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# --- 依赖检查 ---

def check_dependencies():
    """启动时检查必要依赖"""
    missing = []
    try:
        import requests  # noqa: F401
    except ImportError:
        missing.append("requests")
    if sys.version_info < (3, 11):
        try:
            import tomli  # noqa: F401
        except ImportError:
            missing.append("tomli")
    if missing:
        print(json.dumps({
            "error": f"缺少依赖: {', '.join(missing)}。"
                     f"请执行: data/skills/.venv/bin/pip install {' '.join(missing)}"
        }))
        sys.exit(1)

check_dependencies()

import requests
try:
    import tomli
except ImportError:
    import tomllib as tomli  # Python 3.11+

# --- 配置加载 ---

SKILL_DIR = Path(__file__).parent.parent

def load_config():
    """加载 config.toml，环境变量优先覆盖"""
    config = tomli.loads((SKILL_DIR / "config.toml").read_bytes().decode())

    # 环境变量优先
    if url := os.environ.get("CLAWTEAM_API_URL"):
        config["api"]["base_url"] = url
    if key := os.environ.get("CLAWTEAM_API_KEY"):
        config["api"]["api_key"] = key

    if not config["api"].get("api_key"):
        print(json.dumps({"error": "未配置 API Key。请设置环境变量 CLAWTEAM_API_KEY 或编辑 config.toml"}))
        sys.exit(1)

    return config

# --- 模板加载 ---

def load_all_templates():
    """加载所有模板并构建关键词映射"""
    keyword_map = {}
    templates_dir = SKILL_DIR / "templates"
    for toml_file in templates_dir.glob("*.toml"):
        tmpl = tomli.loads(toml_file.read_bytes().decode())
        for kw in tmpl.get("template", {}).get("keyword_triggers", []):
            keyword_map[kw] = toml_file.stem
    return keyword_map

def load_template(template_name):
    """加载指定 TOML 团队模板"""
    path = SKILL_DIR / "templates" / f"{template_name}.toml"
    if not path.exists():
        raise ValueError(f"未找到模板: {template_name}")
    return tomli.loads(path.read_bytes().decode())

def detect_template(topic, keyword_map):
    """根据关键词自动匹配模板"""
    for keyword, template_name in keyword_map.items():
        if keyword in topic:
            return template_name
    return "research-survey"  # 默认

# --- LLM 调用 ---

def call_llm(config, model_key, system_prompt, user_prompt, max_tokens):
    """调用 DeepSeek API（OpenAI 兼容格式）"""
    api = config["api"]
    model = config["models"][model_key]

    resp = requests.post(
        f"{api['base_url']}/chat/completions",
        headers={"Authorization": f"Bearer {api['api_key']}"},
        json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "max_tokens": max_tokens,
            "temperature": config["params"]["temperature"],
        },
        timeout=api["timeout"],
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

# --- 三阶段执行 ---

def phase_leader(config, tmpl_data, topic, context, num_workers):
    """Phase 1: Leader 拆分任务（含重试和降级）"""
    leader = tmpl_data["leader"]
    user_prompt = (
        f"课题：{topic}\n"
        f"补充背景：{context or '无'}\n"
        f"请拆分为 {num_workers} 个调研维度。"
    )

    for attempt in range(2):  # 最多重试 1 次
        try:
            result = call_llm(
                config, "leader",
                leader["system_prompt"], user_prompt,
                config["params"]["leader_max_tokens"],
            )
            return parse_json_response(result)
        except (json.JSONDecodeError, ValueError) as e:
            if attempt == 0:
                print(f"[ClawTeam] Leader JSON 解析失败，重试中... ({e})", file=sys.stderr)
                continue
            # 降级：使用默认维度
            print(f"[ClawTeam] Leader 重试仍失败，使用默认维度拆分", file=sys.stderr)
            workers = tmpl_data.get("workers", [])
            return [
                {"name": w["role"], "description": "", "focus_prompt": f"请从 {w['role']} 的角度深入分析课题：{topic}"}
                for w in workers[:num_workers]
            ]

def phase_workers(config, tmpl_data, dimensions):
    """Phase 2: Workers 并行调研"""
    workers = tmpl_data.get("workers", [])
    findings = [None] * len(dimensions)
    max_concurrent = config["params"].get("max_concurrent_workers", 5)

    def run_worker(i, dim):
        if i < len(workers):
            sys_prompt = workers[i]["system_prompt"]
        else:
            sys_prompt = "你是研究员，负责深入分析以下维度。输出 Markdown 格式。"

        user_prompt = (
            f"维度：{dim['name']}\n"
            f"说明：{dim.get('description', '')}\n"
            f"具体要求：{dim.get('focus_prompt', '请深入分析此维度')}"
        )
        return call_llm(
            config, "worker",
            sys_prompt, user_prompt,
            config["params"]["worker_max_tokens"],
        )

    with ThreadPoolExecutor(max_workers=min(len(dimensions), max_concurrent)) as pool:
        future_to_idx = {
            pool.submit(run_worker, i, dim): i
            for i, dim in enumerate(dimensions)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            try:
                result = future.result()
                # 质量校验：过短的结果标记警告
                if len(result.strip()) < 100:
                    findings[idx] = f"[此维度内容过短，可能需要补充]\n\n{result}"
                else:
                    findings[idx] = result
            except Exception as e:
                findings[idx] = f"[此维度调研失败: {e}]"

    return findings

def phase_editor(config, tmpl_data, topic, dimensions, findings):
    """Phase 3: Editor 汇总合成（含降级）"""
    editor = tmpl_data["editor"]

    sections = []
    for dim, finding in zip(dimensions, findings):
        sections.append(f"### {dim['name']}\n{finding}")

    user_prompt = (
        f"课题：{topic}\n\n"
        f"以下是各维度的研究成果：\n\n"
        + "\n\n---\n\n".join(sections)
    )

    try:
        return call_llm(
            config, "editor",
            editor["system_prompt"], user_prompt,
            config["params"]["editor_max_tokens"],
        )
    except Exception as e:
        # 降级：直接拼接 Worker 成果
        print(f"[ClawTeam] Editor 调用失败，降级为拼接输出: {e}", file=sys.stderr)
        return f"# {topic}\n\n> 注意：报告整合失败，以下为各维度原始研究成果。\n\n" + "\n\n---\n\n".join(sections)

# --- 辅助函数 ---

def parse_json_response(text):
    """从 LLM 输出中提取 JSON 数组"""
    # 尝试提取 ```json ... ``` 块
    match = re.search(r'```(?:json)?\s*(\[.*?\])\s*```', text, re.DOTALL)
    if match:
        return json.loads(match.group(1))
    # 尝试找到最后一个完整的 JSON 数组（避免匹配示例中的数组）
    try:
        start = text.rindex('[')  # 用 rindex 取最后一个
        end = text.rindex(']') + 1
        return json.loads(text[start:end])
    except (ValueError, json.JSONDecodeError):
        raise ValueError(f"无法从 LLM 输出中解析 JSON 数组")

DEPTH_MAP = {"quick": 3, "standard": 5, "deep": 7}

# --- 全局超时 ---

def on_timeout(signum, frame):
    print(json.dumps({"error": "执行超时，已强制终止"}))
    sys.exit(124)

# --- 主入口 ---

def main():
    # 命令行参数解析（run_skill 通过 args 传递，stdin 不可用）
    parser = argparse.ArgumentParser(description="ClawTeam 多智能体协作研究")
    parser.add_argument("--topic", required=True, help="研究/讨论主题")
    parser.add_argument("--template", default="", help="模板名称")
    parser.add_argument("--context", default="", help="补充背景信息")
    parser.add_argument("--depth", default="standard", choices=["quick", "standard", "deep"])
    args = parser.parse_args()

    config = load_config()

    # 设置全局超时
    total_timeout = config["api"].get("total_timeout", 600)
    signal.signal(signal.SIGALRM, on_timeout)
    signal.alarm(total_timeout)

    # 加载关键词映射
    keyword_map = load_all_templates()

    # 自动匹配模板
    template_name = args.template or detect_template(args.topic, keyword_map)
    tmpl_data = load_template(template_name)

    num_workers = DEPTH_MAP.get(args.depth, 5)

    print(f"[ClawTeam] 模式: {template_name} | 深度: {args.depth} ({num_workers} workers)", file=sys.stderr)
    print(f"[ClawTeam] Phase 1: Leader 拆分任务...", file=sys.stderr)

    # Phase 1
    dimensions = phase_leader(config, tmpl_data, args.topic, args.context, num_workers)
    dim_names = [d["name"] for d in dimensions]
    print(f"[ClawTeam] 拆分为 {len(dimensions)} 个维度: {', '.join(dim_names)}", file=sys.stderr)

    # Phase 2
    print(f"[ClawTeam] Phase 2: {len(dimensions)} 个 Worker 并行调研...", file=sys.stderr)
    findings = phase_workers(config, tmpl_data, dimensions)

    # 检查是否所有 Worker 都失败
    all_failed = all("[此维度调研失败" in (f or "") for f in findings)
    if all_failed:
        print(json.dumps({"error": "所有 Worker 调研均失败，无法生成报告"}, ensure_ascii=False))
        sys.exit(1)

    # Phase 3
    print(f"[ClawTeam] Phase 3: Editor 整合报告...", file=sys.stderr)
    report = phase_editor(config, tmpl_data, args.topic, dimensions, findings)

    # 输出文件
    timestamp = time.strftime("%Y%m%d-%H%M%S")
    filename = f"clawteam-{template_name}-{timestamp}.md"

    outputs_dir = Path(os.environ.get("WORKSPACE_PATH", ".")) / "outputs"
    outputs_dir.mkdir(parents=True, exist_ok=True)
    output_path = outputs_dir / filename
    output_path.write_text(report, encoding="utf-8")

    # 取消超时
    signal.alarm(0)

    # 返回结果给 Agent（stdout，run_skill 捕获这部分）
    summary = report[:500] + "..." if len(report) > 500 else report
    result = {
        "status": "success",
        "template": template_name,
        "dimensions": dim_names,
        "output_file": str(output_path),
        "summary": summary,
        "stats": {
            "workers": len(dimensions),
            "total_llm_calls": 1 + len(dimensions) + 1,
        }
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
```

### 8.2 错误处理策略

| 场景 | 处理方式 | 代码位置 |
|------|---------|---------|
| Leader 输出非法 JSON | 重试 1 次，仍失败则用模板 workers 作为默认维度 | `phase_leader()` |
| 单个 Worker 调用失败 | 标记为 `[此维度调研失败]`，不影响其他 Worker | `phase_workers()` |
| Worker 结果过短（<100字） | 标记警告，仍传给 Editor | `phase_workers()` |
| Editor 调用失败 | 拼接 Worker 原始结果作为降级输出 | `phase_editor()` |
| 所有 Worker 都失败 | 返回错误 JSON，exit(1)，不生成报告 | `main()` |
| 单次 API 超时 | config.toml `timeout` 控制，默认 120s | `call_llm()` |
| 全局超时 | config.toml `total_timeout` 控制，默认 600s，SIGALRM 强制终止 | `main()` |
| API Key 未配置 | 启动时检查，立即报错退出 | `load_config()` |
| 依赖缺失 | 启动时检查 requests/tomli，给出安装命令 | `check_dependencies()` |

---

## 九、输出格式

### 9.1 各模板输出结构

| 模板 | 文件名 | 报告结构 |
|------|--------|---------|
| research-survey | `clawteam-research-survey-{ts}.md` | 摘要 → 背景 → 各维度章节 → 结论 → 建议 |
| brainstorm | `clawteam-brainstorm-{ts}.md` | 议题概述 → 各方观点 → 收敛方案(3-5个) → 推荐 → 行动项 |
| speech-draft | `clawteam-speech-draft-{ts}.md` | 场合说明 → 开场 → 主体(分论点) → 结语 → 演讲备注 |

### 9.2 返回给 Agent 的 JSON

```json
{
  "status": "success",
  "template": "research-survey",
  "dimensions": ["政策环境", "行业现状", "核心技术", "实施风险", "建议方案"],
  "output_file": "/path/to/outputs/clawteam-research-survey-20260320-143022.md",
  "summary": "报告前 500 字摘要...",
  "stats": {
    "workers": 5,
    "total_llm_calls": 7
  }
}
```

---

## 十、依赖与部署

### 10.1 Python 依赖

| 包 | 用途 | 安装方式 |
|----|------|---------|
| requests | HTTP API 调用 | `data/skills/.venv/bin/pip install requests` |
| tomli | TOML 解析（Python <3.11） | `data/skills/.venv/bin/pip install tomli` |

Python 3.11+ 内置 `tomllib`，无需额外安装 `tomli`。

### 10.2 部署步骤

1. 将 `data/skills/clawteam-research/` 目录放入 skills 路径
2. 编辑 `config.toml`，填入内网 DeepSeek 代理地址和 API Key
3. 安装依赖：`data/skills/.venv/bin/pip install requests tomli`
4. 确认 `skills.load.extraDirs` 包含 `data/skills/`
5. 重启 gateway 使 skill 被引擎发现

### 10.3 验证

```bash
# 手动测试（命令行参数模式）
CLAWTEAM_API_KEY="sk-xxx" \
  data/skills/.venv/bin/python data/skills/clawteam-research/scripts/research_coordinator.py \
  --topic "国企数字化转型中AI大模型的落地路径" \
  --template research-survey \
  --depth quick
```

---

## 十一、未来扩展

| 方向 | 说明 | 优先级 |
|------|------|--------|
| 自定义模板 | 用户通过前端创建自己的团队模板 | P1 |
| 升级为 Plugin | Worker 改用 callAgent() 获得完整工具能力 | P1 |
| 中间状态推送 | 通过 SSE 实时推送各 Phase 进度 | P2 |
| 历史报告管理 | DB 记录每次调研的参数和结果 | P2 |
| 模板市场 | 用户分享和导入团队模板 | P3 |
