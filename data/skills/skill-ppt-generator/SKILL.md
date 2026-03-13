---
name: ppt-generator
description: PPT 自动生成技能，将文档/需求自动转化为专业 .pptx 演示文稿
license: MIT
compatibility: opencode
metadata:
  audience: 业务人员、项目经理、汇报人
  workflow: 文档转演示
  category: 办公自动化
---

# PPT 自动生成助手

> 路径约定：`{{SKILL_DIR}}` 代表本技能根目录，执行时由 Agent 运行环境解析为实际路径。

## 功能概述

本技能将用户提供的文档或需求自动转化为专业 PPT 演示文稿。核心流程：

- **内容分析** — 解析文档或需求，提取关键信息与结构
- **方案设计** — 生成 `ppt_config.json` 配置，展示大纲供用户审核
- **交互确认** — 用户检查并调整页数、布局、内容
- **渲染生成** — 调用 Python 渲染脚本，输出 `.pptx` 文件

---

## When NOT to Use This Skill

- 仅需简单文字排版（无演示需求）→ 直接用 Markdown
- 仅需数据可视化（无演示文稿需求）→ 使用 ECharts 可视化技能
- 仅需 PDF 文档 → 直接生成 PDF

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
│ ├── 用户说"快速生成/直接生成/一键生成" → 跳过 Phase 2-3，直接      │
│ │   使用推荐配置进入 Phase 4                                         │
│ └── 否则 → 进入 Phase 2 交互设计                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 2: 方案设计                                                    │
│ ├── 根据内容分析结果，生成 ppt_config.json 配置                      │
│ ├── 输出 Markdown 格式大纲（含每页布局、标题、内容摘要）             │
│ └── 请用户审核大纲                                                   │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 3: 用户确认（最多 5 轮迭代）                                   │
│ ├── 用户可要求：增删页面、更换布局、调整内容                         │
│ ├── 根据反馈修改 ppt_config.json                                     │
│ ├── 超过 5 轮 → 主动提示"是否直接使用当前方案生成？"                │
│ └── 用户确认后进入 Phase 4                                           │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 4: 渲染生成                                                    │
│ ├── 将 ppt_config.json 写入 workspace 的 temp/ 目录                  │
│ ├── exec 调用 ppt_renderer.py 渲染脚本                               │
│ ├── 输出 .pptx 文件到 outputs/ 目录                                  │
│ └── 告知用户输出文件路径                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### 快速模式

当用户在请求中使用"快速生成"、"直接生成"、"一键生成"等关键词时，Phase 1 完成后**跳过 Phase 2-3 的交互审核**，直接使用推荐配置生成 PPT（进入 Phase 4）。适用于用户信任自动推荐结果、或时间紧迫的场景。

### Phase 转换条件

| 当前阶段 | 触发条件 | 下一阶段 |
|---------|---------|---------|
| Phase 1 → Phase 2 | 内容分析完成，且非快速模式 | Phase 2 |
| Phase 1 → Phase 4 | 内容分析完成，且为快速模式 | Phase 4 |
| Phase 2 → Phase 3 | 用户提出修改意见 | Phase 3 |
| Phase 2 → Phase 4 | 用户说"确认"/"OK"/"可以了"/"没问题"/"就这样" | Phase 4 |
| Phase 3 → Phase 4 | 用户确认满意，或迭代达到 5 次上限且用户同意生成 | Phase 4 |

---

## 支持的 10 种布局

| 布局 | 用途 | 必填字段 | 说明 |
|------|------|----------|------|
| `title` | 封面页 | title, subtitle | 大标题 + 副标题，居中展示 |
| `agenda` | 目录页 | title, items[] | 展示汇报大纲或目录结构 |
| `section_divider` | 章节分隔页 | title | 章节过渡，简洁醒目 |
| `content` | 要点正文页 | title, bullets[] | 常规要点列表，最通用的布局 |
| `two_column` | 对比/并列页 | title, left{heading, bullets[]}, right{heading, bullets[]} | 左右双栏对比或并列展示 |
| `chart` | 数据图表页 | title, chart_type, data{categories[], series[]} | 嵌入柱状图/折线图/饼图等 |
| `table` | 数据表格页 | title, headers[], rows[][] | 结构化数据展示 |
| `image_text` | 图文混排页 | title, image_path, text | 左图右文或右图左文 |
| `quote` | 引言强调页 | quote, attribution | 名言、核心观点、总结语 |
| `thank_you` | 结束页 | title | 致谢或联系方式 |

### 布局字段详细说明

**`content` 布局**：
```json
{
  "layout": "content",
  "title": "页面标题",
  "bullets": ["要点一", "要点二", "要点三"],
  "notes": "演讲者备注（可选）"
}
```

**`two_column` 布局**：
```json
{
  "layout": "two_column",
  "title": "对比分析",
  "left": {
    "heading": "方案 A",
    "bullets": ["优点一", "优点二"]
  },
  "right": {
    "heading": "方案 B",
    "bullets": ["优点一", "优点二"]
  }
}
```

**`chart` 布局**：
```json
{
  "layout": "chart",
  "title": "季度营收趋势",
  "chart_type": "bar",
  "data": {
    "categories": ["Q1", "Q2", "Q3", "Q4"],
    "series": [
      {"name": "营收", "values": [320, 450, 380, 520]},
      {"name": "成本", "values": [210, 280, 250, 310]}
    ]
  }
}
```

**`table` 布局**：
```json
{
  "layout": "table",
  "title": "项目进度一览",
  "headers": ["项目", "负责人", "进度", "状态"],
  "rows": [
    ["配网改造", "张三", "85%", "进行中"],
    ["变电站巡检", "李四", "100%", "已完成"]
  ]
}
```

---

## 主题系统

| 主题名 | 中文别名 | 主色 | 辅色 | 适用场景 |
|--------|---------|------|------|----------|
| `sgcc` | 国网/国网绿 | #006550 RGB(0,101,80) | 金色 #C4A35A | 国网汇报、电力行业 |
| `professional` | 商务/专业 | #003DA5 | #F5F5F5 | 通用商务汇报 |
| `minimal` | 简约 | #333333 | #FFFFFF | 简约风格、学术汇报 |
| `tech` | 科技/技术 | #0078D4 | #1E1E2E | 技术方案、IT 汇报 |

### 主题视觉规范

- **封面**：主色背景 + 白色大标题，辅色用于装饰线/副标题
- **正文页**：白色背景 + 主色标题 + 深灰正文
- **章节分隔页**：主色背景 + 白色标题
- **结束页**：主色背景 + 白色致谢文字
- **图表配色**：主色为第一系列色，辅色衍生 4-6 个渐变色

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
| `author` | 否 | string | 作者/汇报人 |
| `date` | 否 | string | 日期，如 "2026年3月" |
| `theme` | 是 | string | 主题名：sgcc / professional / minimal / tech |
| `footer_text` | 否 | string | 页脚文字，如 "内部资料 注意保密" |

### slides 数组元素

每个元素必须包含 `layout` 字段，其余字段根据布局类型而定。可选的 `notes` 字段用于演讲者备注。

---

## 完整 JSON 配置示例

以下是一个国网风格的季度工作汇报示例（包含 10 页不同类型的幻灯片）：

```json
{
  "metadata": {
    "title": "2026年第一季度工作汇报",
    "subtitle": "配电运维管理部",
    "author": "张三",
    "date": "2026年3月",
    "theme": "sgcc",
    "footer_text": "内部资料 注意保密"
  },
  "slides": [
    {
      "layout": "title",
      "title": "2026年第一季度工作汇报",
      "subtitle": "配电运维管理部 | 张三"
    },
    {
      "layout": "agenda",
      "title": "汇报提纲",
      "items": [
        "一、季度工作总结",
        "二、核心指标完成情况",
        "三、重点项目进展",
        "四、问题与风险分析",
        "五、下季度工作计划"
      ]
    },
    {
      "layout": "section_divider",
      "title": "一、季度工作总结"
    },
    {
      "layout": "content",
      "title": "Q1 主要工作成果",
      "bullets": [
        "完成配网改造项目 12 项，投资额 3200 万元",
        "设备巡检覆盖率达 98.5%，同比提升 3.2%",
        "故障抢修平均响应时间缩短至 25 分钟",
        "安全生产零事故，连续运行 720 小时"
      ],
      "notes": "重点强调零事故记录和响应时间缩短"
    },
    {
      "layout": "chart",
      "title": "月度供电可靠率趋势",
      "chart_type": "line",
      "data": {
        "categories": ["1月", "2月", "3月"],
        "series": [
          {"name": "实际可靠率", "values": [99.92, 99.95, 99.97]},
          {"name": "目标值", "values": [99.90, 99.90, 99.90]}
        ]
      },
      "notes": "3月可靠率创历史新高"
    },
    {
      "layout": "two_column",
      "title": "重点项目进展对比",
      "left": {
        "heading": "配网改造工程",
        "bullets": [
          "计划 15 项，完成 12 项",
          "完成率 80%，达预期进度",
          "剩余 3 项预计 Q2 完工"
        ]
      },
      "right": {
        "heading": "智能巡检系统",
        "bullets": [
          "一期部署完成，覆盖 6 个站点",
          "二期方案已通过评审",
          "预计 Q3 全面上线"
        ]
      }
    },
    {
      "layout": "table",
      "title": "核心指标完成情况",
      "headers": ["指标", "目标值", "实际值", "完成率"],
      "rows": [
        ["供电可靠率", "99.90%", "99.95%", "100.05%"],
        ["线损率", "≤5.2%", "4.8%", "达标"],
        ["故障响应时间", "≤30分钟", "25分钟", "达标"],
        ["巡检覆盖率", "≥95%", "98.5%", "103.7%"],
        ["客户满意度", "≥90分", "93分", "103.3%"]
      ]
    },
    {
      "layout": "chart",
      "title": "各区域故障分布",
      "chart_type": "pie",
      "data": {
        "categories": ["城区", "郊区", "农村", "工业园区"],
        "series": [
          {"name": "故障次数", "values": [15, 28, 42, 8]}
        ]
      }
    },
    {
      "layout": "content",
      "title": "下季度工作计划",
      "bullets": [
        "完成剩余 3 项配网改造工程",
        "推进智能巡检系统二期部署",
        "开展夏季高峰保供电专项行动",
        "启动配电自动化升级项目立项"
      ]
    },
    {
      "layout": "thank_you",
      "title": "谢谢"
    }
  ]
}
```

---

## 设计规则

### 字体规范

| 元素 | 字体 | 字号 | 样式 |
|------|------|------|------|
| 封面标题 | 微软雅黑 | 36pt | Bold |
| 页面标题 | 微软雅黑 | 28pt | Bold |
| 正文内容 | 微软雅黑 | 18pt | Regular |
| 表格文字 | 微软雅黑 | 14pt | Regular |
| 页脚文字 | 微软雅黑 | 10pt | Regular |
| 备注文字 | 微软雅黑 | 12pt | Regular |

### 内容限制

| 限制项 | 最大值 | 超出处理 |
|--------|--------|----------|
| 每页 bullet 条数 | 5 条 | 自动拆分为多页 |
| 每条 bullet 字数 | 20 字 | 超出部分折行 |
| 图表分类数 | 6 个 | 超出合并为"其他" |
| 图表系列数 | 6 个 | 超出取前 6 个 |
| 表格行数（含表头） | 8 行 | 自动拆分为多页 |
| 表格列数 | 6 列 | 超出缩小字号或拆分 |
| 总页数建议 | 30 页 | 超过 30 页建议分批 |

### 页面尺寸

- 标准 16:9 宽屏（33.867cm x 19.05cm / 13.333in x 7.5in）
- 安全边距：上下左右各 1.5cm
- 标题区域高度：3cm
- 页脚区域高度：1cm

---

## Phase 1: 内容分析

### 分析步骤

1. **读取用户提供的文档**（如有）：使用 `read` 工具读取文件内容
2. **提取结构化信息**：
   - 识别主题和副标题
   - 划分章节/段落结构
   - 提取关键数据（数字、百分比、对比项）
   - 识别可用图表的数据
3. **输出分析报告**（Markdown 格式）：
   - 建议的 PPT 结构（页数、每页布局）
   - 提取的核心要点
   - 推荐的主题

### 主题推荐规则

根据用户内容自动推荐最合适的主题：

| 主题 | 推荐场景 | 关键词识别 |
|------|---------|-----------|
| `sgcc` | 电力行业、政府机关、国企央企汇报 | 国网、供电、配网、变电站、电力、能源、政府、国企 |
| `professional` | 商务汇报、管理报告、金融分析 | 商务、管理、金融、营收、市场、投资、运营 |
| `minimal` | 学术报告、技术论文、简约风格 | 学术、论文、研究、分析、简约、简洁 |
| `tech` | IT 技术方案、研发汇报、系统架构 | 技术、开发、系统、架构、代码、IT、研发、AI |

> 如果用户明确指定主题，以用户指定为准；如果无法判断，默认使用 `professional`。

### 分析 Prompt

```
请分析以下内容，为生成 PPT 做准备：

用户需求/文档内容：
{content}

请完成以下分析：
1. 确定演示主题和副标题
2. 划分逻辑章节（3-5 个章节为宜）
3. 每个章节提取 3-5 个核心要点
4. 识别可用数据图表的内容（数字、对比、趋势）
5. 推荐 PPT 总页数和每页布局类型
6. 推荐适合的主题（sgcc/professional/minimal/tech）
```

### Phase 1 结构化输出格式

内容分析完成后，**必须**按以下 JSON Schema 输出分析结果，不允许自由文本格式：

```json
{
  "title": "演示文稿主标题",
  "subtitle": "副标题（可为空字符串）",
  "chapters": [
    {
      "name": "章节名称",
      "key_points": ["要点一", "要点二", "要点三"],
      "suggested_layout": "content | two_column | chart | table"
    }
  ],
  "chartable_data": [
    {
      "type": "bar | line | pie | doughnut",
      "title": "图表标题",
      "description": "数据来源及说明"
    }
  ],
  "recommended_theme": "sgcc | professional | minimal | tech",
  "theme_reason": "推荐该主题的原因（一句话）",
  "total_pages": 10,
  "page_outline": [
    {
      "page": 1,
      "layout": "title",
      "note": "封面页，主标题 + 副标题"
    },
    {
      "page": 2,
      "layout": "agenda",
      "note": "汇报提纲，列出各章节"
    }
  ]
}
```

**字段说明：**

| 字段 | 必填 | 类型 | 约束 |
|------|------|------|------|
| `title` | 是 | string | 不超过 30 字 |
| `subtitle` | 是 | string | 可为空字符串 |
| `chapters` | 是 | array | 3-5 个章节 |
| `chapters[].name` | 是 | string | 章节标题 |
| `chapters[].key_points` | 是 | string[] | 3-5 个要点，每条不超过 20 字 |
| `chapters[].suggested_layout` | 是 | string | 10 种标准布局之一 |
| `chartable_data` | 是 | array | 可为空数组 |
| `chartable_data[].type` | 是 | string | bar / line / pie / doughnut |
| `chartable_data[].title` | 是 | string | 图表标题 |
| `chartable_data[].description` | 是 | string | 数据说明 |
| `recommended_theme` | 是 | string | sgcc / professional / minimal / tech |
| `theme_reason` | 是 | string | 推荐理由 |
| `total_pages` | 是 | number | 3-30 |
| `page_outline` | 是 | array | 与 total_pages 数量一致 |
| `page_outline[].page` | 是 | number | 页码（从 1 开始） |
| `page_outline[].layout` | 是 | string | 10 种标准布局之一 |
| `page_outline[].note` | 是 | string | 该页内容简述 |

---

## Phase 2: 方案设计

### 设计方案输出要求

设计方案必须**同时输出两份内容**：

1. **Markdown 大纲文档**（便于用户审核）
2. **`ppt_config.json` 配置文件**（写入 workspace 的 `temp/` 目录，供 Phase 4 直接使用）

Markdown 大纲模板：

```markdown
# PPT 设计方案

## 基本信息
- 主题：{theme}
- 总页数：{page_count}
- 预计生成时间：约 5-10 秒

## 页面大纲

| 页码 | 布局 | 标题 | 内容摘要 |
|------|------|------|----------|
| 1 | title | 封面标题 | 主标题 + 副标题 |
| 2 | agenda | 汇报提纲 | 5 个章节目录 |
| 3 | section_divider | 第一章 | 章节过渡 |
| 4 | content | 工作成果 | 4 个核心要点 |
| ... | ... | ... | ... |

---

请审核以上设计方案，您可以提出以下修改：
- 增加/删除某一页
- 更换页面布局
- 调整内容要点
- 更换主题风格
- 其他建议
```

---

## Phase 3: 用户反馈迭代

### 迭代上限与轮次追踪

Phase 3 最多进行 **5 轮**迭代。使用 context 变量追踪当前轮次：

```
当前迭代轮次：{iteration_count}/5
```

每轮迭代的标准流程：

1. **接收用户反馈**
2. **解析修改意图**（参见下方常见反馈处理表）
3. **修改 `ppt_config.json`**
4. **重新输出 Markdown 大纲**（标注本轮修改的页面）
5. **更新轮次计数**，提示用户确认或继续修改

### 迭代 Prompt 模板

每轮迭代时使用以下标准模板回复用户：

```
## 第 {iteration_count}/5 轮修改

### 本轮修改内容
- {修改描述 1}
- {修改描述 2}

### 更新后的页面大纲

| 页码 | 布局 | 标题 | 变更 |
|------|------|------|------|
| ... | ... | ... | 🔄 已修改 / ➕ 新增 / — 无变化 |

已更新 `temp/ppt_config.json`。

请确认当前方案，或继续提出修改意见。
```

### 允许修改的范围

用户在迭代中可以要求以下修改：

- **增删页面**：添加或移除指定页面
- **切换布局**：将某页从一种布局换为另一种（如 content → two_column）
- **更换主题**：切换整体主题风格（sgcc / professional / minimal / tech）
- **修改文字内容**：调整标题、要点、备注等文字
- **调整数据**：修改图表数据、表格数据
- **调整顺序**：调整页面先后顺序

### 第 5 轮终止提示

第 5 轮迭代完成后，如果用户仍有修改意见，使用以下固定提示语：

> "已完成 5 轮迭代调整，当前方案已经过多次优化。建议直接使用当前配置生成 PPT——生成后仍可修改 `ppt_config.json` 重新渲染，无需重走全流程。是否现在生成？"

### 常见反馈处理

| 用户反馈 | 调整方式 |
|---------|---------|
| "增加一页xx" | 在 slides 数组中追加对应布局 |
| "删掉第 N 页" | 从 slides 数组中移除 |
| "把要点页换成双栏" | 修改 layout 为 two_column |
| "加一个图表" | 追加 chart 布局页 |
| "换成科技风格" | 修改 metadata.theme 为 tech |
| "要点太多了" | 精简 bullets 为 3-4 条 |
| "加上页脚保密标识" | 设置 metadata.footer_text |

---

## Phase 4: 渲染生成

### 执行前检查

> **生成前必须确认**：
> 1. `ppt_config.json` 已写入 workspace 的 `temp/` 目录
> 2. JSON 格式合法（无多余逗号、引号闭合）
> 3. 每页的 `layout` 字段是 10 种布局之一
> 4. `metadata.theme` 是 4 种主题之一
> 5. `chart` 布局的 `data.series[].values` 全部是数字
> 6. `image_text` 布局的 `image_path` 指向 workspace 内的有效文件
> 7. 每页 bullets 不超过 5 条

### 执行渲染脚本

```
run_skill(skill_name="ppt-generator", args="temp/ppt_config.json -o outputs/演示文稿.pptx -t sgcc")
```

**参数格式（必须严格遵守）**：
- 第 1 个参数（位置参数）：配置文件路径，如 `temp/ppt_config.json`
- `-o OUTPUT`：输出文件路径，如 `outputs/xxx.pptx`
- `-t THEME`：主题名，如 `sgcc`（可选，默认用 config 中的 theme）

⚠️ **禁止使用 `--config`**，config 是位置参数，直接写路径即可。

- **输入**：workspace 中的 `ppt_config.json` 文件（相对路径）
- **输出**：`outputs/` 目录下的 `.pptx` 文件

### 产物输出

生成完成后告知用户：
- 输出文件路径（如 `outputs/2026年第一季度工作汇报.pptx`）
- 总页数
- 使用的主题

### 迭代修改

Phase 4 生成完成后，用户如果不满意，可以：

1. **直接修改 `ppt_config.json`** 中的配置（布局、内容、主题等）
2. 重新执行渲染命令即可更新 PPT，无需重走 Phase 1-3

```
# 修改 ppt_config.json 后重新生成
run_skill(skill_name="ppt-generator", args="temp/ppt_config.json -o outputs/演示文稿.pptx")
```

---

## 完整工作流示例

### 示例场景：季度工作汇报

**用户**：「帮我把这个季度总结文档做成 PPT，国网风格」

**Phase 1 - 内容分析**：
```
分析结果：
- 主题：2026年Q1工作汇报
- 章节：工作总结(4点)、指标完成(5项)、项目进展(2个)、问题风险(3项)、下季度计划(4点)
- 可用图表：月度趋势数据(line)、故障分布数据(pie)
- 推荐：10 页，sgcc 主题
```

**Phase 2 - 方案设计**：

| 页码 | 布局 | 标题 |
|------|------|------|
| 1 | title | 封面 |
| 2 | agenda | 汇报提纲 |
| 3 | section_divider | 工作总结 |
| 4 | content | 主要成果 |
| 5 | chart | 月度趋势 |
| 6 | table | 指标完成情况 |
| 7 | two_column | 项目对比 |
| 8 | chart | 故障分布 |
| 9 | content | 下季度计划 |
| 10 | thank_you | 谢谢 |

同时生成 `temp/ppt_config.json` 文件。

### Phase 2 AI 自检清单

在生成 `ppt_config.json` **之前**，必须逐条自检以下内容。任何一条不通过，先修正再输出：

```
□ JSON 格式合法（无尾逗号、引号闭合、括号匹配）
□ metadata.theme 在 4 个主题之内：sgcc / professional / minimal / tech
□ slides 数量在 3-30 之间
□ 每页 layout 在 10 种标准布局之内：
  title / agenda / section_divider / content / two_column /
  chart / table / image_text / quote / thank_you
□ 每页 bullets 条数 ≤ 5，每条字数 ≤ 20
□ chart 布局的 chart_type 在 bar / line / pie / doughnut 之内
□ chart 布局的 data.series[].values 全部为数字，无 null / 字符串
□ table 布局的 rows 每行列数 == headers 列数
□ image_text 布局的 image_path 是 workspace 内相对路径
```

> **自检未通过就输出 JSON = 致命错误**。必须全部通过后再写入 `temp/ppt_config.json`。

**Phase 3 - 用户反馈**：「加一页引言，用领导讲话原文」

**Phase 4 - 渲染生成**：
```
run_skill(skill_name="ppt-generator", args="temp/ppt_config.json -o outputs/演示文稿.pptx")
```

输出：`outputs/2026年第一季度工作汇报.pptx`

### 示例场景：快速生成

**用户**：「快速生成一个项目介绍 PPT」

Phase 1 完成内容分析后，跳过 Phase 2-3 交互，直接使用推荐配置生成：
```
run_skill(skill_name="ppt-generator", args="temp/ppt_config.json -o outputs/演示文稿.pptx")
```

---

## 历史教训（来自真实失败案例的复盘）

### 教训 1：跳过 Phase 2-3 直接生成 → 内容质量差

**错误行为**：Phase 1 分析完内容后，直接跳到 Phase 4 生成 PPT，跳过了大纲审核和用户反馈。

**后果**：生成的 PPT 页数不合适、内容要点遗漏、布局选择不当，需要全部返工。

**强制规则**：
- **非快速模式下，必须完整执行 Phase 1 → 2 → 3 → 4，不得跳过任何阶段**
- Phase 2 必须输出 Markdown 大纲 + ppt_config.json，等用户审核
- Phase 3 必须等用户说"确认"/"OK"/"没问题"后才能进入 Phase 4

### 教训 2：bullets 过长 → 文字溢出页面

**错误行为**：把整段话塞进一个 bullet，每条超过 20 字。

**后果**：文字超出页面边界，排版混乱。

**强制规则**：
- 每条 bullet 不超过 20 字，超长内容拆分为多条
- 每页 bullet 不超过 5 条，超出拆分为多页

### 教训 3：chart 的 values 混入非数字 → 渲染报错

**错误行为**：`values` 数组中混入字符串（如 `"N/A"`、`"--"`）。

**后果**：Python 渲染脚本抛出 TypeError，PPT 生成失败。

**强制规则**：
- `data.series[].values` 必须是**纯数字数组**，不允许 null、字符串
- 缺失数据用 0 代替，不要用 "N/A"

---

## 致命错误清单（生成配置前必读）

### 错误 1：使用不存在的 layout 名

脚本**只认识** 10 种布局名，其他写法直接报错：

```
❌ 错误写法：
  "layout": "cover"           ← 错！用 "title"
  "layout": "toc"             ← 错！用 "agenda"
  "layout": "bullet"          ← 错！用 "content"
  "layout": "comparison"      ← 错！用 "two_column"
  "layout": "ending"          ← 错！用 "thank_you"

✅ 正确写法（10 选 1）：
  title / agenda / section_divider / content / two_column /
  chart / table / image_text / quote / thank_you
```

### 错误 2：chart_type 使用不支持的类型

`chart` 布局的 `chart_type` 只支持 4 种：

```
✅ 正确：  "chart_type": "bar" / "line" / "pie" / "doughnut"
❌ 错误：  "chart_type": "radar"      ← 不支持
❌ 错误：  "chart_type": "funnel"     ← 不支持
❌ 错误：  "chart_type": "heatmap"    ← 不支持
```

### 错误 3：theme 使用不存在的主题名

```
✅ 正确：  "theme": "sgcc" / "professional" / "minimal" / "tech"
❌ 错误：  "theme": "dark"          ← 不存在
❌ 错误：  "theme": "executive"     ← 不存在
❌ 错误：  "theme": "default"       ← 不存在
```

### 错误 4：image_path 指向 workspace 外部

```
❌ 错误：  "image_path": "/etc/passwd"               ← workspace 外部
❌ 错误：  "image_path": "../../other/image.png"      ← 路径逃逸
✅ 正确：  "image_path": "images/logo.png"            ← workspace 内相对路径
```

### 错误 5：table 数据行列不对齐

`rows` 中每行的元素数必须与 `headers` 数量一致：

```
❌ 错误：  "headers": ["A", "B", "C"], "rows": [["1", "2"]]       ← 少一列
✅ 正确：  "headers": ["A", "B", "C"], "rows": [["1", "2", "3"]]  ← 列数一致
```

### 自检清单

生成 `ppt_config.json` 后，逐条检查：

- [ ] `metadata.theme` 是 4 个主题之一：sgcc / professional / minimal / tech
- [ ] 每页 `layout` 是 10 种布局之一
- [ ] `chart` 布局的 `chart_type` 是 bar / line / pie / doughnut 之一
- [ ] `chart` 布局的 `data.series[].values` 全部是数字
- [ ] `table` 布局的 `rows` 每行列数与 `headers` 一致
- [ ] 每页 `bullets` 不超过 5 条，每条不超过 20 字
- [ ] `image_text` 的 `image_path` 是 workspace 内的相对路径
- [ ] JSON 格式合法（无尾逗号、引号闭合）

---

## 配置字段规范（必须严格遵守）

**顶层字段（只有 2 个）：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `metadata` | 是 | 演示文稿元信息（title, subtitle, author, date, theme, footer_text） |
| `slides` | 是 | 幻灯片数组 |

**metadata 内部字段：**

| 字段 | 必填 | 说明 | 常见错误 |
|------|------|------|---------|
| `title` | 是 | 主标题 | — |
| `subtitle` | 否 | 副标题 | — |
| `author` | 否 | 作者 | — |
| `date` | 否 | 日期 | — |
| `theme` | 是 | 主题名 | 只支持 sgcc/professional/minimal/tech |
| `footer_text` | 否 | 页脚 | — |

**每页幻灯片的公共字段：**

| 字段 | 必填 | 说明 |
|------|------|------|
| `layout` | 是 | 布局类型（10 选 1） |
| `notes` | 否 | 演讲者备注 |

**禁止使用的字段（脚本不识别）：**
- `slide_type`、`type`（用 `layout`）
- `background`、`transition`、`animation`
- `font_size`、`font_family`、`color`

---

## 调用方式

```
run_skill(skill_name="ppt-generator", args="<config_path> [-o OUTPUT] [-t THEME]")
```

**参数说明**：
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `config_path` | 位置参数 | 是 | JSON 配置文件路径（如 `temp/ppt_config.json`） |
| `-o OUTPUT` | 可选 | 否 | 输出 .pptx 文件路径（默认 `outputs/{title}.pptx`） |
| `-t THEME` | 可选 | 否 | 覆盖 config 中的主题（sgcc/professional/minimal/tech） |

**调用示例**：
```
run_skill(skill_name="ppt-generator", args="temp/ppt_config.json -o outputs/工作汇报.pptx -t sgcc")
```

⚠️ **注意**：`config` 是位置参数，**不能**写 `--config`。

- **输入**：workspace 中的 JSON 配置文件
- **输出**：`outputs/` 目录下的 `.pptx` 文件
- **依赖**：`python-pptx`（已预装在共享 venv 中）

---

## 常见问题

### Q: 如何自定义配色？不想用预设主题？
A: 当前版本仅支持 4 种预设主题（sgcc/professional/minimal/tech）。如需自定义配色，可在生成后使用 PowerPoint 手动调整，或修改 `ppt_renderer.py` 中的主题配置。

### Q: 如何在 PPT 中嵌入图表？
A: 使用 `chart` 布局，指定 `chart_type`（bar/line/pie/doughnut）并提供 `data` 字段。`data.series[].values` 必须是纯数字数组。图表在 PPT 中以原生 PowerPoint 图表渲染，支持在 PPT 中二次编辑。

### Q: 超过 30 页怎么办？
A: 建议拆分为多个 PPT 文件分批生成。每次生成一个 `ppt_config.json`，分别调用渲染脚本。例如将"总结"和"计划"拆成两份 PPT。

### Q: 中文字体显示为方块或乱码？
A: 渲染脚本默认使用"微软雅黑"字体。确保运行环境安装了该字体。Linux 环境下可安装 `fonts-wqy-microhei` 作为后备：`sudo apt install fonts-wqy-microhei`。如仍有问题，检查 `ppt_renderer.py` 中的字体配置。

### Q: 如何分批生成大型演示文稿？
A: 将内容拆分为多个 `ppt_config.json`（如 `ppt_part1.json`、`ppt_part2.json`），分别调用渲染脚本生成。最后可在 PowerPoint 中合并。

### Q: 图片插入失败怎么办？
A: `image_text` 布局的 `image_path` 必须是 workspace 内的相对路径，且图片文件必须存在。支持 PNG、JPG、BMP 格式。建议先用 `read` 工具确认文件存在后再配置。

### Q: 能否修改单页而不重新生成整个 PPT？
A: 当前版本每次调用都会重新生成完整 PPT。修改 `ppt_config.json` 中对应页面的配置后，重新执行渲染命令即可。生成速度很快（通常 5-10 秒），不会有明显延迟。

### Q: 表格数据太多放不下怎么办？
A: 表格最多支持 8 行（含表头）x 6 列。超出限制时，脚本会自动拆分为多页。建议在 Phase 2 阶段就控制表格数据量，精选最关键的数据展示。
