---
name: html-presentation
description: HTML 演示文稿生成技能，将需求自动转化为专业级单文件 HTML 演示文稿（支持 3 套主题 + 14 种布局）
license: MIT
compatibility: opencode
metadata:
  audience: 技术人员、项目经理、汇报人
  workflow: 需求转 HTML 演示
  category: 办公自动化
---

# HTML 演示文稿生成助手

> 路径约定：`{{SKILL_DIR}}` 代表本技能根目录，执行时由 Agent 运行环境解析为实际路径。

## 功能概述

本技能将用户提供的需求自动转化为专业级 HTML 演示文稿。核心特性：

- **单文件输出** — 生成完整独立的 HTML 文件，无需任何外部依赖（CDN、字体等）
- **3 套暗色主题** — tech-dark（科技深蓝）、professional（商务深蓝）、dark-green（科技深绿）
- **14 种页面布局** — 覆盖封面、目录、内容、对比、表格、流程图、架构图、同心圆、时间线、卡片网格、KPI 等
- **SVG 图表动画** — 流动光点、描边动画、脉冲效果
- **粒子动画背景** — 科技感数据流粒子 + 连线效果
- **丰富的翻页交互** — 键盘、鼠标边缘点击、滚轮防抖、双击全屏、底部页面选择器
- **自适应缩放** — 基于 1920x1080 设计稿，自动适配任意分辨率
- **入场动画** — 每页元素带渐进入场动画（飞入、缩放、百叶窗等）

### 核心流程

- **内容分析** — 解析需求，提取关键信息与结构
- **方案设计** — 生成 JSON 配置，展示大纲供用户审核
- **交互确认** — 用户检查并调整页数、布局、内容
- **渲染生成** — 调用 Python 脚本，输出 `.html` 文件

---

## When NOT to Use This Skill

- 需要 .pptx 格式（PowerPoint 原生编辑）→ 使用 `ppt-generator` 技能
- 仅需简单文字排版 → 直接用 Markdown
- 需要打印分发的静态文档 → 生成 PDF

---

## 工作流程（Phase 1-4）

```
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 1: 内容分析                                                    │
│ ├── 分析用户提供的文档或需求描述                                     │
│ ├── 提取关键信息：标题、章节结构、数据、要点                         │
│ └── 输出内容分析报告                                                 │
├─────────────────────────────────────────────────────────────────────┤
│ ★ 快速模式判断                                                       │
│ ├── 用户说"快速生成/直接生成/一键生成" → 跳过 Phase 2-3             │
│ └── 否则 → 进入 Phase 2 交互设计                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 2: 方案设计                                                    │
│ ├── 根据内容分析结果，生成 JSON 配置                                 │
│ ├── 输出 Markdown 格式大纲（含每页布局、标题、内容摘要）             │
│ └── 请用户审核大纲                                                   │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 3: 用户确认（最多 5 轮迭代）                                   │
│ ├── 用户可要求：增删页面、更换布局、调整内容                         │
│ ├── 根据反馈修改 JSON 配置                                           │
│ └── 用户确认后进入 Phase 4                                           │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 4: 渲染生成                                                    │
│ ├── 将 JSON 配置写入 workspace 的 temp/ 目录                         │
│ ├── exec 调用 html_ppt_generator.py 渲染脚本                         │
│ ├── 输出 .html 文件到 outputs/ 目录                                  │
│ └── 告知用户输出文件路径                                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 主题系统

通过 `metadata.theme` 切换主题，支持 3 套暗色主题：

| 主题名 | 风格 | 适用场景 |
|--------|------|----------|
| `tech-dark` | 科技深蓝（默认） | 技术汇报、产品演示 |
| `professional` | 商务深蓝 | 商务汇报、管理层演示 |
| `dark-green` | 科技深绿 | 能源企业、环保主题 |

**配色对照**：

| 变量 | tech-dark | professional | dark-green |
|------|-----------|-------------|------------|
| `--bg-primary` | #1e293b | #1a1f36 | #0f2318 |
| `--bg-secondary` | #273549 | #252d4a | #1a3328 |
| `--accent` | #3b82f6 | #4f8df5 | #22c55e |
| `--accent2` | #8b5cf6 | #7c6cf5 | #10b981 |
| `--text-primary` | #f1f5f9 | #eef2f7 | #f0fdf4 |
| `--text-secondary` | #94a3b8 | #8c9ab5 | #86efac |

---

## 颜色名称系统

SVG 图表布局中 `color` 字段使用名称而非 hex 值：

| 名称 | 主色(main) | 浅色(light) | 背景(bg) |
|------|-----------|-------------|----------|
| `blue` | #3b82f6 | #60a5fa | rgba(59,130,246,0.12) |
| `purple` | #8b5cf6 | #a78bfa | rgba(139,92,246,0.12) |
| `green` | #22c55e | #4ade80 | rgba(34,197,94,0.12) |
| `yellow` | #fbbf24 | #fcd34d | rgba(251,191,36,0.12) |
| `pink` | #ec4899 | #f472b6 | rgba(236,72,153,0.12) |
| `red` | #ef4444 | #f87171 | rgba(239,68,68,0.12) |
| `cyan` | #06b6d4 | #22d3ee | rgba(6,182,212,0.12) |

---

## 支持的 14 种布局

### 基础布局（8 种）

| 布局 | 用途 | 必填字段 | 说明 |
|------|------|----------|------|
| `title` | 封面页 | title | 大标题 + 副标题居中，底部渐变装饰线 |
| `agenda` | 目录页 | title, items[] | 编号圆圈卡片式目录 |
| `chapter` | 章节分隔页 | title | 大字居中 + 装饰线，章节过渡 |
| `content` | 要点正文页 | title, bullets[] | 蓝色圆点列表，最通用布局 |
| `two_column` | 对比/并列页 | title, left{}, right{} | 左右玻璃态卡片 + 图标列表 |
| `table` | 数据表格页 | title, headers[], rows[][] | 深色表头 + 交替行高亮 |
| `quote` | 引言强调页 | text | 大字居中 + 装饰引号 |
| `thank_you` | 结束页 | (无必填) | 致谢页，自动使用 metadata.title |

### SVG 图表布局（6 种）

| 布局 | 用途 | 必填字段 | 说明 |
|------|------|----------|------|
| `flow_chart` | 横向流程图 | title, nodes[] | 节点+箭头连线，可选流动光点动画 |
| `arch_diagram` | 层级架构图 | title, layers[] | 从上到下分层，层间箭头 |
| `concentric` | 同心圆层级图 | title, rings[] | 从内到外的圆环，可选右侧详情 |
| `timeline` | 时间线 | title, items[] | 横向时间线，状态着色 |
| `cards_grid` | 卡片网格 | title, cards[] | 2列或3列卡片网格 |
| `kpi` | 大数字展示 | title, metrics[] | 发光大数字指标 |

---

## JSON 配置格式（完整 Schema）

### 顶层结构

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `metadata` | 是 | object | 演示文稿元信息 |
| `slides` | 是 | array | 幻灯片数组，每个元素代表一页 |

### metadata 字段

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 是 | string | 演示文稿主标题 |
| `subtitle` | 否 | string | 副标题 |
| `date` | 否 | string | 日期，如 "2026年3月" |
| `theme` | 否 | string | 主题名：`tech-dark`（默认）/ `professional` / `dark-green` |

### slides 数组元素

每个元素必须包含 `layout` 字段，其余字段根据布局类型而定。

---

## 布局字段详细说明

### `title` 封面页

```json
{
  "layout": "title",
  "title": "主标题（大字发光效果）",
  "subtitle": "副标题（蓝紫渐变色）"
}
```

- `title` 和 `subtitle` 可覆盖 metadata 中的值
- 日期自动取 metadata.date

### `agenda` 目录页

```json
{
  "layout": "agenda",
  "title": "汇报提纲",
  "items": [
    {"num": "01", "title": "背景与痛点", "desc": "企业 AI 现状分析"},
    {"num": "02", "title": "平台架构", "desc": "三层分层设计"},
    {"num": "03", "title": "核心能力", "desc": "智能记忆与扩展"}
  ]
}
```

- `items` 可以是对象数组（含 num/title/desc），也可以是简单字符串数组
- 字符串数组时自动编号

### `chapter` 章节分隔页

```json
{
  "layout": "chapter",
  "num": "01",
  "title": "背景与痛点"
}
```

- `num` 可选，显示在右上角的大号半透明编号

### `content` 要点页

```json
{
  "layout": "content",
  "title": "页面标题",
  "subtitle": "描述文字（可选）",
  "bullets": ["要点一", "要点二", "要点三"]
}
```

- 每条 bullet 带蓝色发光圆点
- 建议每页不超过 5 条

### `two_column` 对比页

```json
{
  "layout": "two_column",
  "title": "对比分析",
  "subtitle": "描述文字（可选）",
  "left": {
    "heading": "现有方案",
    "color": "red",
    "items": [
      {"icon": "✕", "label": "问题一", "desc": "详细描述"},
      {"icon": "✕", "label": "问题二", "desc": "详细描述"}
    ]
  },
  "right": {
    "heading": "新方案",
    "color": "blue",
    "items": [
      {"icon": "✓", "label": "优势一", "desc": "详细描述"},
      {"icon": "✓", "label": "优势二", "desc": "详细描述"}
    ]
  }
}
```

**color 可选值**：
- `red` / `danger` — 红色系（适合问题、风险）
- `blue` / `primary` / `accent` — 蓝色系（适合优势、推荐）
- `green` / `success` — 绿色系（适合已完成、达标）
- 不填 — 默认灰色

### `table` 表格页

```json
{
  "layout": "table",
  "title": "核心指标完成情况",
  "subtitle": "2026年Q1数据（可选）",
  "headers": ["指标", "目标值", "实际值", "状态"],
  "rows": [
    ["供电可靠率", "99.90%", "99.95%", "达标"],
    ["故障响应", "≤30min", "25min", "达标"]
  ]
}
```

- `rows` 每行列数必须与 `headers` 一致

### `quote` 引言页

```json
{
  "layout": "quote",
  "text": "让 AI 真正融入企业业务流程",
  "label": "OCTOPUS"
}
```

- `label` 可选，显示在引言下方

### `thank_you` 结束页

```json
{
  "layout": "thank_you",
  "title": "谢谢"
}
```

- `title` 可选，默认 "谢谢"
- 自动显示 metadata.title 作为副标题

### `flow_chart` 横向流程图

```json
{
  "layout": "flow_chart",
  "title": "数据处理流程",
  "subtitle": "描述文字（可选）",
  "nodes": [
    {"label": "输入", "color": "blue"},
    {"label": "处理", "color": "purple"},
    {"label": "输出", "color": "green"}
  ],
  "show_flow_animation": true
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 是 | string | 页面标题 |
| `subtitle` | 否 | string | 副标题 |
| `nodes` | 是 | array | 流程节点数组，支持 2-8 个 |
| `nodes[].label` | 是 | string | 节点文字 |
| `nodes[].color` | 否 | string | 颜色名称（默认 blue） |
| `show_flow_animation` | 否 | boolean | 是否显示流动光点动画（默认 false） |

### `arch_diagram` 层级架构图

```json
{
  "layout": "arch_diagram",
  "title": "系统架构",
  "subtitle": "描述（可选）",
  "layers": [
    {"label": "前端层", "desc": "React + SSE", "color": "blue"},
    {"label": "网关层", "desc": "认证 + 审计", "color": "purple"},
    {"label": "引擎层", "desc": "AI 推理", "color": "green"}
  ],
  "show_flow_animation": true
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 是 | string | 页面标题 |
| `subtitle` | 否 | string | 副标题 |
| `layers` | 是 | array | 层级数组，从上到下排列，支持 2-5 层 |
| `layers[].label` | 是 | string | 层名称 |
| `layers[].desc` | 否 | string | 层描述（显示在名称下方） |
| `layers[].color` | 否 | string | 颜色名称（默认 blue） |
| `show_flow_animation` | 否 | boolean | 是否显示层间流动光点（默认 false） |

### `concentric` 同心圆层级图

```json
{
  "layout": "concentric",
  "title": "安全体系",
  "subtitle": "描述（可选）",
  "rings": [
    {"label": "核心数据", "color": "red"},
    {"label": "审计层", "color": "pink"},
    {"label": "网络层", "color": "blue"}
  ],
  "details": [
    {"label": "第一层 · 网络隔离", "desc": "Docker iptables 封锁公网", "color": "blue"},
    {"label": "第二层 · 身份认证", "desc": "JWT + LDAP", "color": "purple"}
  ]
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 是 | string | 页面标题 |
| `subtitle` | 否 | string | 副标题 |
| `rings` | 是 | array | 圆环数组，第一个是最内层，支持 2-6 个 |
| `rings[].label` | 是 | string | 圆环标签 |
| `rings[].color` | 否 | string | 颜色名称（默认 blue） |
| `details` | 否 | array | 右侧详情卡片列表（有此字段时同心圆居左） |
| `details[].label` | 是 | string | 卡片标题 |
| `details[].desc` | 否 | string | 卡片描述 |
| `details[].color` | 否 | string | 卡片左侧边框颜色（默认 blue） |

### `timeline` 时间线

```json
{
  "layout": "timeline",
  "title": "发展路线图",
  "subtitle": "描述（可选）",
  "items": [
    {"label": "Phase 1", "desc": "基础架构", "status": "done"},
    {"label": "Phase 2", "desc": "能力扩展", "status": "active"},
    {"label": "Phase 3", "desc": "智能进化", "status": "planned"}
  ]
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 是 | string | 页面标题 |
| `subtitle` | 否 | string | 副标题 |
| `items` | 是 | array | 时间线节点数组，支持 1-8 个 |
| `items[].label` | 是 | string | 节点标签（如 "Phase 1"） |
| `items[].desc` | 否 | string | 节点描述（显示在节点下方卡片中） |
| `items[].status` | 否 | string | 状态：`done`（绿色实心✓）/ `active`（蓝色脉冲）/ `planned`（灰色虚线，默认） |

### `cards_grid` 卡片网格

```json
{
  "layout": "cards_grid",
  "title": "应用场景",
  "subtitle": "描述（可选）",
  "columns": 3,
  "cards": [
    {"icon": "📊", "title": "数据分析", "desc": "自然语言查询"},
    {"icon": "📄", "title": "文档生成", "desc": "自动化报告"},
    {"icon": "🔍", "title": "合规检查", "desc": "制度比对"},
    {"icon": "⏰", "title": "定时巡检", "desc": "异常告警"}
  ]
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 是 | string | 页面标题 |
| `subtitle` | 否 | string | 副标题 |
| `columns` | 否 | number | 列数：`2` 或 `3`（默认 2） |
| `cards` | 是 | array | 卡片数组 |
| `cards[].icon` | 否 | string | 图标（支持 emoji） |
| `cards[].title` | 是 | string | 卡片标题 |
| `cards[].desc` | 否 | string | 卡片描述 |

### `kpi` 大数字展示页

```json
{
  "layout": "kpi",
  "title": "关键指标",
  "subtitle": "描述（可选）",
  "metrics": [
    {"value": "99.9%", "label": "系统可用性", "color": "green"},
    {"value": "<200ms", "label": "检索延迟", "color": "blue"},
    {"value": "6层", "label": "安全防御", "color": "purple"},
    {"value": "100%", "label": "审计覆盖率", "color": "yellow"}
  ]
}
```

| 字段 | 必填 | 类型 | 说明 |
|------|------|------|------|
| `title` | 是 | string | 页面标题 |
| `subtitle` | 否 | string | 副标题 |
| `metrics` | 是 | array | 指标数组 |
| `metrics[].value` | 是 | string | 大数字（如 "99.9%"、"<200ms"） |
| `metrics[].label` | 是 | string | 指标标签 |
| `metrics[].color` | 否 | string | 颜色名称（默认 blue） |

---

## 完整 JSON 配置示例

```json
{
  "metadata": {
    "title": "Octopus 企业级智能 Agent 平台",
    "subtitle": "技术架构汇报",
    "date": "2026年3月",
    "theme": "tech-dark"
  },
  "slides": [
    {
      "layout": "title",
      "title": "Octopus",
      "subtitle": "企业级智能 Agent 平台"
    },
    {
      "layout": "agenda",
      "title": "汇报提纲",
      "items": [
        {"num": "01", "title": "背景与痛点", "desc": "企业 AI 现状分析"},
        {"num": "02", "title": "平台架构", "desc": "三层分层设计"},
        {"num": "03", "title": "核心能力", "desc": "智能记忆与扩展"},
        {"num": "04", "title": "安全体系", "desc": "六层纵深防御"}
      ]
    },
    {
      "layout": "chapter",
      "num": "01",
      "title": "背景与痛点"
    },
    {
      "layout": "content",
      "title": "企业 AI 应用现状",
      "bullets": [
        "能力单一，只能简单问答",
        "无长期记忆，每次对话从零开始",
        "安全合规缺失，无审计日志",
        "无法接入企业内部系统"
      ]
    },
    {
      "layout": "flow_chart",
      "title": "数据处理流程",
      "nodes": [
        {"label": "数据采集", "color": "cyan"},
        {"label": "清洗转换", "color": "blue"},
        {"label": "模型推理", "color": "purple"},
        {"label": "结果输出", "color": "green"}
      ],
      "show_flow_animation": true
    },
    {
      "layout": "arch_diagram",
      "title": "三层架构设计",
      "layers": [
        {"label": "前端层", "desc": "React + Admin Console", "color": "blue"},
        {"label": "网关层", "desc": "认证 · 审计 · RBAC", "color": "purple"},
        {"label": "引擎层", "desc": "Agent · Session · Tools", "color": "green"}
      ],
      "show_flow_animation": true
    },
    {
      "layout": "concentric",
      "title": "六层安全纵深防御",
      "rings": [
        {"label": "核心数据", "color": "red"},
        {"label": "审计", "color": "pink"},
        {"label": "执行", "color": "yellow"},
        {"label": "授权", "color": "green"},
        {"label": "身份", "color": "purple"},
        {"label": "网络", "color": "blue"}
      ],
      "details": [
        {"label": "网络隔离", "desc": "Docker iptables 封锁公网", "color": "blue"},
        {"label": "身份认证", "desc": "JWT + LDAP", "color": "purple"},
        {"label": "权限控制", "desc": "RBAC 细粒度授权", "color": "green"}
      ]
    },
    {
      "layout": "kpi",
      "title": "关键指标",
      "metrics": [
        {"value": "99.9%", "label": "系统可用性", "color": "green"},
        {"value": "<200ms", "label": "检索延迟", "color": "blue"},
        {"value": "6层", "label": "安全防御", "color": "purple"},
        {"value": "100%", "label": "审计覆盖率", "color": "yellow"}
      ]
    },
    {
      "layout": "timeline",
      "title": "发展路线图",
      "items": [
        {"label": "Phase 1", "desc": "基础架构", "status": "done"},
        {"label": "Phase 2", "desc": "能力扩展", "status": "done"},
        {"label": "Phase 3", "desc": "深度集成", "status": "active"},
        {"label": "Phase 4", "desc": "智能进化", "status": "planned"}
      ]
    },
    {
      "layout": "cards_grid",
      "title": "应用场景",
      "columns": 2,
      "cards": [
        {"icon": "📊", "title": "数据分析", "desc": "自然语言查询数据库"},
        {"icon": "📄", "title": "文档生成", "desc": "自动化报告与演示文稿"},
        {"icon": "🔍", "title": "合规检查", "desc": "制度文件比对审核"},
        {"icon": "⏰", "title": "定时巡检", "desc": "异常告警自动通知"}
      ]
    },
    {
      "layout": "two_column",
      "title": "能力全景对比",
      "left": {
        "heading": "现有 AI 工具",
        "color": "red",
        "items": [
          {"icon": "✕", "label": "记忆能力", "desc": "单次对话，关闭即丢失"},
          {"icon": "✕", "label": "安全审计", "desc": "无操作日志"}
        ]
      },
      "right": {
        "heading": "Octopus 平台",
        "color": "blue",
        "items": [
          {"icon": "✓", "label": "智能记忆", "desc": "向量数据库永久存储"},
          {"icon": "✓", "label": "全链路审计", "desc": "双写 DB+文件"}
        ]
      }
    },
    {
      "layout": "table",
      "title": "技术指标对比",
      "headers": ["能力维度", "传统方案", "Octopus", "提升"],
      "rows": [
        ["记忆持久化", "无", "向量数据库", "从0到1"],
        ["工具扩展", "预定义", "Plugin+MCP+Skill", "3层递进"],
        ["安全隔离", "账号级", "Docker沙箱", "容器级"]
      ]
    },
    {
      "layout": "quote",
      "text": "让 AI 真正融入企业业务流程",
      "label": "OCTOPUS"
    },
    {
      "layout": "thank_you"
    }
  ]
}
```

---

## 调用方式

```
run_skill(skill_name="html-presentation", args="<config_path> [-o OUTPUT]")
```

**参数说明**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `config_path` | 位置参数 | 是 | JSON 配置文件路径（如 `temp/html_config.json`） |
| `-o OUTPUT` | 可选 | 否 | 输出 .html 文件路径（默认 `outputs/{title}.html`） |

**调用示例**：

```
run_skill(skill_name="html-presentation", args="temp/html_config.json -o outputs/技术汇报.html")
```

- **输入**：workspace 中的 JSON 配置文件
- **输出**：`outputs/` 目录下的 `.html` 文件
- **依赖**：无额外依赖（纯 Python 标准库）

---

## 设计规则

### 视觉规范

- **分辨率**：基于 1920x1080 设计稿，自动缩放适配
- **配色**：3 套主题可选，通过 metadata.theme 切换
- **字体**：PingFang SC / Microsoft YaHei / system-ui（系统字体栈，无外部依赖）
- **效果**：玻璃态卡片 + 粒子数据流背景 + 元素入场动画 + SVG 图表动画

### 内容限制

| 限制项 | 建议最大值 | 说明 |
|--------|-----------|------|
| 每页 bullet 条数 | 5 条 | 超出影响排版 |
| 每条 bullet 字数 | 25 字 | 超长自动折行 |
| agenda 卡片数 | 6 个 | 超出卡片过窄 |
| 表格列数 | 6 列 | 超出文字过小 |
| 表格行数 | 8 行 | 超出溢出区域 |
| flow_chart 节点数 | 8 个 | 超出自动截断 |
| arch_diagram 层数 | 5 层 | 超出自动截断 |
| concentric 圆环数 | 6 个 | 超出自动截断 |
| timeline 节点数 | 8 个 | 超出自动截断 |
| cards_grid 列数 | 2 或 3 | 其他值自动改为 2 |
| 总页数 | 30 页 | 超过建议分批 |

### 交互说明

| 操作 | 效果 |
|------|------|
| 右方向键 / 空格 | 下一页 |
| 左方向键 | 上一页 |
| Home | 第一页 |
| End | 最后一页 |
| F5 / F11 | 全屏切换 |
| 双击 | 全屏切换 |
| 鼠标左 15% 区域点击 | 上一页 |
| 鼠标右 15% 区域点击 | 下一页 |
| 鼠标滚轮 | 上下翻页（600ms 防抖） |
| 鼠标移到底部 | 显示页面选择器 |

---

## 致命错误清单

### 错误 1：使用不存在的 layout 名

脚本**只认识** 14 种布局名，其他写法会被跳过：

```
❌ 错误写法：
  "layout": "cover"           ← 用 "title"
  "layout": "toc"             ← 用 "agenda"
  "layout": "section_divider" ← 用 "chapter"
  "layout": "bullet"          ← 用 "content"
  "layout": "comparison"      ← 用 "two_column"
  "layout": "ending"          ← 用 "thank_you"
  "layout": "process"         ← 用 "flow_chart"
  "layout": "architecture"    ← 用 "arch_diagram"
  "layout": "radar"           ← 用 "concentric"
  "layout": "roadmap"         ← 用 "timeline"
  "layout": "grid"            ← 用 "cards_grid"
  "layout": "metrics"         ← 用 "kpi"

✅ 正确写法（14 选 1）：
  title / agenda / chapter / content / two_column /
  table / quote / thank_you /
  flow_chart / arch_diagram / concentric / timeline /
  cards_grid / kpi
```

### 错误 2：table 数据行列不对齐

`rows` 中每行的元素数必须与 `headers` 数量一致：

```
❌ 错误：  "headers": ["A", "B", "C"], "rows": [["1", "2"]]
✅ 正确：  "headers": ["A", "B", "C"], "rows": [["1", "2", "3"]]
```

### 错误 3：agenda items 格式混用

`items` 要么全部是对象（含 num/title/desc），要么全部是字符串，不要混用。

### 错误 4：SVG 图表 color 使用 hex 值

SVG 图表布局的 color 字段必须使用名称（blue/purple/green/yellow/pink/red/cyan），不支持直接写 hex 值。

### 错误 5：theme 名称拼写错误

只支持 `tech-dark`、`professional`、`dark-green` 三个主题名，拼错会使用默认 tech-dark 主题。

---

## 常见问题

### Q: 和 ppt-generator 有什么区别？
A: `ppt-generator` 输出 .pptx 文件，适合需要在 PowerPoint 中二次编辑的场景。`html-presentation` 输出单文件 HTML，适合直接在浏览器中展示，效果更炫酷（粒子背景、入场动画、SVG 图表等），且无需安装任何软件。

### Q: 如何在局域网内分享？
A: 生成的 HTML 是完全独立的单文件，直接发送文件即可。接收方用浏览器打开即可展示，无需网络连接。

### Q: 中文显示异常？
A: 模板使用系统字体栈（PingFang SC / Microsoft YaHei / system-ui），macOS 和 Windows 均有内置支持。Linux 下确保安装了中文字体：`sudo apt install fonts-wqy-microhei`。

### Q: 如何切换主题？
A: 在 `metadata.theme` 字段中指定主题名即可。支持 `tech-dark`（默认）、`professional`、`dark-green` 三套主题。

### Q: 超过 30 页怎么办？
A: 建议拆分为多个配置文件分别生成。每个文件独立运行，最终各自生成一份 HTML。

### Q: SVG 图表动画可以关闭吗？
A: flow_chart 和 arch_diagram 的流动光点动画通过 `show_flow_animation: false`（默认即为 false）关闭。concentric 的描边动画和 timeline 的脉冲动画是内置效果，无法单独关闭。
