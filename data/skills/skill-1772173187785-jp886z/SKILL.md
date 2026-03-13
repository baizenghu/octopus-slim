---
name: echarts-visualization
description: 智能可视化分析技能，基于 Excel/数据库数据自动生成 ECharts 仪表盘
license: MIT
compatibility: opencode
metadata:
  audience: 数据分析师、业务人员
  workflow: 数据可视化
  category: 数据分析
---

# ECharts 可视化分析助手

> **调用方式**：本技能所有脚本必须通过 `run_skill` 工具调用，严禁用 exec/bash 直接执行。
>
> **路径规则**：`run_skill` 的工作目录是用户 workspace 根目录。所有 `--config`、`--data`、`--output` 等参数中的文件路径都是**相对于 workspace 根目录**的。如果文件在 `outputs/` 子目录下，路径必须写成 `outputs/文件名`。**绝对不要使用 `/workspace/` 等绝对路径。**

## 功能概述

本技能支持**两种数据源**的智能可视化分析：

1. 📁 **文件数据源** - Excel/CSV/JSON 文件
2. 🗄️ **数据库数据源** - 通过 MCP 执行 SQL 查询（需配置 database-connector）

### 核心流程

- 📊 **数据获取** - 解析文件或执行数据库查询
- 🔍 **智能分析** - LLM 识别维度、度量，推荐图表组合
- 💬 **交互迭代** - 用户审核设计方案，提出修改建议
- 🖥️ **生成仪表盘** - 输出专业的响应式 HTML 仪表盘

---

## When NOT to Use This Skill

- 仅需查询数据库（无可视化需求）→ 直接使用 MCP execute_sql
- 仅需简单数据表格展示 → 无需本技能

---

## Step 0: 判断数据源类型

根据用户请求判断数据源：

| 用户请求中包含 | 数据源类型 | 执行流程 |
|--------------|-----------|---------|
| Excel/CSV/JSON 文件路径 | 文件 | Phase 1-4（文件流程） |
| SQL 查询 + 数据库连接名 | 数据库 | Step 1-4（数据库流程）→ Phase 2-4 |

---

## 数据库可视化流程（Step 1-4）

### Step 1: 验证 MCP 连接

使用 `list_connections` 工具检查可用连接：

**如果连接不存在：** 告知用户需要在 `connections.json` 中配置数据库连接。

**如果连接存在：** 继续 Step 2。

### Step 2: 执行 SQL 查询

用户提供多个 SQL 查询配置：

```json
{
  "connection": "postgres_local",
  "queries": [
    {"name": "kpi_total", "sql": "SELECT SUM(amount) as total_amount FROM sales"},
    {"name": "monthly_trend", "sql": "SELECT month, SUM(amount) as amount FROM sales GROUP BY month ORDER BY month"},
    {"name": "region_dist", "sql": "SELECT region, SUM(amount) as amount FROM sales GROUP BY region"}
  ]
}
```

**对每个查询，按以下步骤依次执行：**

1. **调用 MCP `execute_sql` 工具**执行 SQL（默认 max_rows=10000），获取返回的 JSON 结果
2. **将返回的 JSON 写入临时文件**，例如 `mcp_result_kpi_total.json`
3. **调用 `db_data_adapter.py` 将 JSON 转换为 CSV**

```
# 完整步骤示例：
# 1) 调用 execute_sql 获取结果后，将 JSON 写入文件
# 2) 转换为 CSV
run_skill(skill_name="echarts-visualization", script="scripts/db_data_adapter.py", args="--input mcp_result_kpi_total.json --output ./data --name kpi_total")
```

**多文件处理说明：** 当多个查询生成多个 CSV 时，每个 CSV 独立分析。后续生成图表配置时，每个图表必须通过 `data_file` 字段指定其对应的数据文件，例如 `"data_file": "./data/monthly_trend.csv"`。

> **大数据量处理：** 建议用户在 SQL 中使用 GROUP BY 聚合，避免返回百万行明细数据。

### Step 3: 分析数据字段

对每个 CSV 文件执行分析：

```
run_skill(skill_name="echarts-visualization", script="scripts/data_analyzer.py", args="./data/kpi_total.csv --json")
```

### Step 4: 继续 Phase 2-4

使用分析结果进入标准可视化流程（设计方案 → 用户反馈 → 生成仪表盘）。

---

## 文件数据可视化流程（Phase 1-4）

```
┌─────────────────────────────────────────────────────────────────────┐
│ Phase 1: 数据解析与分析                                              │
│ ├── 执行 data_analyzer.py 解析数据文件                              │
│ ├── LLM 识别维度（分类/时间）和度量（数值）                          │
│ └── 输出字段分析报告                                                 │
├─────────────────────────────────────────────────────────────────────┤
│ ★ 快速模式判断                                                       │
│ ├── 用户说"快速生成/直接生成/一键生成" → 跳过 Phase 2-3，直接      │
│ │   使用推荐配置进入 Phase 4                                         │
│ └── 否则 → 进入 Phase 2 交互设计                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 2: 初版设计方案                                                │
│ ├── LLM 根据数据特征推荐多样化图表组合                               │
│ ├── 生成设计方案文档（含推荐理由）                                   │
│ ├── 同时生成 chart_config.json 配置文件                              │
│ └── 🔔 请用户审核设计方案                                            │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 3: 用户反馈迭代（最多 5 轮）                                   │
│ ├── 用户可要求：增删图表、更换类型、调整配置                         │
│ ├── LLM 根据反馈调整图表配置                                         │
│ ├── 超过 5 轮迭代 → 主动提示"是否直接使用当前方案生成？"            │
│ └── 用户确认后进入 Phase 4                                           │
├─────────────────────────────────────────────────────────────────────┤
│ Phase 4: 生成终版仪表盘                                              │
│ ├── 执行 echarts_generator.py 生成 HTML                             │
│ ├── 告知用户输出文件路径，在浏览器中打开即可查看                     │
│ └── 🔔 交付最终成果（可修改 JSON 配置重新生成）                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 快速模式

当用户在请求中使用"快速生成"、"直接生成"、"一键生成"等关键词时，Phase 1 完成后**跳过 Phase 2-3 的交互审核**，直接使用 LLM 推荐的默认配置生成仪表盘（进入 Phase 4）。适用于用户信任自动推荐结果、或时间紧迫的场景。

### Phase 转换条件

| 当前阶段 | 触发条件 | 下一阶段 |
|---------|---------|---------|
| Phase 1 → Phase 2 | 数据分析完成，且非快速模式 | Phase 2 |
| Phase 1 → Phase 4 | 数据分析完成，且为快速模式 | Phase 4 |
| Phase 2 → Phase 3 | 用户提出修改意见 | Phase 3 |
| Phase 2 → Phase 4 | 用户说"确认"/"OK"/"可以了"/"没问题"/"就这样" | Phase 4 |
| Phase 3 → Phase 4 | 用户确认满意，或迭代达到 5 次上限且用户同意生成 | Phase 4 |

---

## 支持的图表类型

### 当前已实现图表类型列表

| 类别 | 图表类型 | type 值 | 适用场景 |
|-----|---------|--------|---------|
| **趋势分析** | 折线图 | `line` | 时间序列趋势 |
| | 面积图 | `area` | 趋势 + 量级强调 |
| **对比分析** | 柱状图 | `bar` | 分类对比 |
| | 条形图 | `bar` + horizontal | 长标签对比 |
| | 堆叠柱状图 | `bar` + stack | 分类 + 构成 |
| **占比分析** | 饼图 | `pie` | 简单占比（<8项） |
| | 环形图 | `donut` | 带中心指标的占比 |
| | 玫瑰图 | `rose` | 占比 + 量级差异 |
| | 旭日图 | `sunburst` | 多层级占比 |
| **多维分析** | 雷达图 | `radar` | 多指标综合评估 |
| | 热力图 | `heatmap` | 二维数据分布 |
| **流程分析** | 漏斗图 | `funnel` | 转化率分析 |
| | 瀑布图 | `waterfall` | 增减因素分解（如利润构成、成本拆分） |
| **特殊用途** | 仪表盘 | `gauge` | 单指标进度/评分 |
| | KPI 卡片 | `kpi` | 关键指标展示 |
| | 矩形树图 | `treemap` | 层级 + 占比 |
| | 散点图 | `scatter` | 相关性分析 |
| | 组合图 | `combo` | 柱状图 + 折线图 |
| | 数据表格 | `table` | 明细数据展示、多字段对比排名 |

### 图表推荐规则

```
数据特征                    →  推荐图表
──────────────────────────────────────────────────────
时间维度 + 单数值            →  折线图 / 面积图
时间维度 + 多数值            →  多折线图 / 堆叠面积图 / 组合图
分类(<8) + 数值              →  柱状图 / 饼图 / 环形图
分类(8-15) + 数值            →  条形图 / 玫瑰图
分类(>15) + 数值             →  条形图 Top N / 矩形树图
多指标评估(3-8个维度)        →  雷达图
阶段性数据(漏斗形态)         →  漏斗图
增减因素分解                 →  瀑布图
两分类 + 数值 (交叉分析)     →  热力图 / 堆叠柱状图
层级结构数据                 →  旭日图 / 矩形树图
单 KPI 进度显示              →  仪表盘 / KPI 卡片
两数值变量                   →  散点图
需要展示明细或排名           →  数据表格
```

> 说明：`parallel`、`sankey`、`graph`、`tree`、`bubble`、`calendar` 当前文档流程中可作为设计参考，但脚本生成器尚未实现，请勿直接输出这些 type。

---

## Phase 1: 数据解析与分析

### 执行数据分析脚本

```
# 分析数据文件
run_skill(skill_name="echarts-visualization", script="scripts/data_analyzer.py", args="数据文件.xlsx --json")

# 输出分析结果到文件
run_skill(skill_name="echarts-visualization", script="scripts/data_analyzer.py", args="数据文件.xlsx --json -o analysis.json")
```

### LLM 分析 Prompt

在获取 data_analyzer.py 输出后，使用以下思路分析：

```
请分析以下数据字段，识别维度和度量：

字段元数据：
{data_analyzer_output}

请完成以下分析：
1. 识别时间维度字段（日期、时间戳等）
2. 识别分类维度字段（类别、地区、产品等）
3. 识别度量字段及其聚合方式（sum/avg/count/max/min）
4. 给出数据整体描述
5. 建议可能的分析方向
```

---

## 🚨 历史教训（来自真实失败案例的复盘）

> **以下是在实际使用中反复出现的错误，每一条都导致了任务失败或返工。请在开始任务前逐条阅读。**

### 教训 1：跳过 Phase 2-3 直接生成 → 配置质量极差

**错误行为**：Phase 1 分析完数据后，直接跳到 Phase 4 生成仪表盘，跳过了设计方案审核和用户反馈。

**后果**：生成的图表配置字段名错误、布局混乱、图表类型选择不合理，需要全部返工。

**强制规则**：
- **非快速模式下，必须完整执行 Phase 1 → 2 → 3 → 4，不得跳过任何阶段**
- Phase 2 必须输出 Markdown 设计方案 + chart_config.json，等用户审核
- Phase 3 必须等用户说"确认"/"OK"/"没问题"后才能进入 Phase 4
- 只有用户明确说"快速生成"/"直接生成"时才能跳过 Phase 2-3

### 教训 2：尝试合并多个数据文件 → 数据混乱

**错误行为**：把多个 SQL 查询结果合并到一个 CSV 文件中，试图让所有图表共用一个数据源。

**后果**：字段名冲突、数据行数不对、聚合结果被展开、图表全部空白。

**强制规则**：
- **每个 SQL 查询结果保持独立 CSV 文件**
- 每个图表通过 `data_file` 字段引用自己的数据文件
- 绝对不要自行合并数据文件

### 教训 3：配置中使用了错误的字段名 → 图表全部失败

**错误行为**：使用 `x_field`、`y_fields`、`value_field` 等字段名。

**后果**：脚本不识别这些字段，所有图表生成失败。

**强制规则**：见下方"致命错误清单 - 错误 1"。

### 教训 4：数据文件字段名与配置不一致 → 图表空白

**错误行为**：SQL 查询返回 `log_count`，但配置中写 `count`。

**后果**：图表数据为空，显示空白。

**强制规则**：
- **在写 chart_config.json 之前，先读取每个 CSV 文件的表头确认实际列名**
- `dimensions` 和 `measures` 中的值必须与 CSV 列名**完全一致**（区分大小写）
- 不要凭记忆猜测列名，必须验证

### 教训 5：没有为每个图表指定 data_file → 数据错位

**错误行为**：多数据源场景下，部分图表没有指定 `data_file`，导致使用了错误的数据。

**强制规则**：
- 多数据源场景（多个 CSV）：**每个图表都必须有 `data_file` 字段**
- 单数据源场景（一个文件）：可以省略 `data_file`

---

## ⛔ 致命错误清单（生成配置前必读）

> **以下错误会导致图表生成直接失败，脚本会报错退出。你必须在生成 chart_config.json 之前逐条核对。**

### 错误 1：使用错误的字段名（最高频致命错误）

脚本**只认识** `dimensions` 和 `measures` 两个字段名。以下写法全部会导致失败：

```
❌ 错误写法（脚本不认识，图表直接报错）：
  "x_field": "date"           ← 错！
  "y_field": "count"          ← 错！
  "value_field": "amount"     ← 错！
  "name_field": "category"    ← 错！
  "indicator_field": "user"   ← 错！
  "y_fields": ["a", "b"]     ← 错！
  "category": "region"        ← 错！

✅ 正确写法（唯一合法的字段名）：
  "dimensions": ["date"]           ← 对！维度（分类轴/时间轴）
  "measures": ["count"]            ← 对！度量（数值）
  "dimensions": ["region"]         ← 对！
  "measures": ["amount", "profit"] ← 对！多个度量
```

**规则：不管你在其他系统中见过什么字段名，这里只用 `dimensions` 和 `measures`，没有例外。**

### 错误 2：把字段映射放在 config 内部

字段映射必须放在图表条目的**顶层**，不能放在 `config` 里：

```
❌ 错误（放在 config 里，脚本读不到）：
  {"type": "line", "config": {"x_field": "date", "y_fields": ["count"]}}

✅ 正确（放在顶层）：
  {"type": "line", "dimensions": ["date"], "measures": ["count"]}
```

### 错误 3：KPI 卡片合并为一个条目

每个 KPI 卡片必须是**独立的图表条目**，不能合并：

```
❌ 错误（多个 KPI 合并在一个条目里）：
  {"type": "kpi", "config": {"kpis": [
    {"label": "总数", "value_field": "total"},
    {"label": "成功率", "value_field": "rate"}
  ]}}

✅ 正确（每个 KPI 是独立条目）：
  {"type": "kpi", "title": "总数", "measures": ["total"], "col_span": 3},
  {"type": "kpi", "title": "成功率", "measures": ["rate"], "col_span": 3}
```

### 错误 4：热力图只给 1 个 dimension

热力图**必须 2 个 dimensions**（X 轴分类 + Y 轴分类），1 个 measure（颜色深浅）：

```
❌ 错误（只有 1 个 dimension）：
  {"type": "heatmap", "dimensions": ["hour"], "measures": ["count"]}

✅ 正确（2 个 dimensions）：
  {"type": "heatmap", "dimensions": ["hour", "weekday"], "measures": ["count"]}
```

### 错误 5：使用不存在的主题名

支持 **7 个主题**：

| 主题名 | 风格 | KPI 模式 | 适用场景 |
|--------|------|---------|---------|
| `default` | 紫色渐变 | 渐变背景白字 | 通用 |
| `executive` | 商务蓝 | 渐变背景白字 | 正式汇报 |
| `dark` | 暗色科技风 | 发光描边 + 渐变文字 | 大屏展示 |
| `fresh` | 清新自然绿 | 底部彩色条 | 环保/健康/农业 |
| `warm` | 暖色活力橙红 | 渐变背景白字 | 营销/电商 |
| `minimal` | 极简灰白 | 左侧竖条 | 正式报告/学术 |
| `sgcc` | 国网绿 | 左侧竖条 | 国家电网/电力 |

别名也可用：`light`→default、`tech`/`科技`→dark、`nature`/`清新`→fresh、`活力`→warm、`简约`→minimal、`国网`/`电网`/`state_grid`→sgcc

```
❌ 错误：  "theme": "blue"      ← 不存在
✅ 正确：  "theme": "default" / "executive" / "dark" / "fresh" / "warm" / "minimal" / "sgcc"
```

### 错误 6：使用 col_span 以外的布局字段

布局宽度**只用 `col_span`**，不用 `size`、`width`、`position`：

```
❌ 错误：  "size": {"width": 6}     ← 不识别
❌ 错误：  "position": {"row": 1}   ← 不识别

✅ 正确：  "col_span": 6
```

### 错误 7：使用 dashboard_title 作为顶层标题

```
❌ 错误：  "dashboard_title": "仪表盘"    ← 不识别
✅ 正确：  "title": "仪表盘"
```

### 自检清单

生成 `chart_config.json` 后，逐条检查：

- [ ] 所有图表都用了 `dimensions`/`measures`，没有 `x_field`/`y_field`/`value_field`
- [ ] `dimensions` 和 `measures` 在图表条目**顶层**，不在 `config` 内部
- [ ] 每个 KPI 是独立条目，不是合并数组
- [ ] 热力图有 2 个 dimensions
- [ ] 主题是 7 个之一：`default`/`executive`/`dark`/`fresh`/`warm`/`minimal`/`sgcc`
- [ ] 布局用 `col_span`，不用 `size`
- [ ] 顶层标题用 `title`，不用 `dashboard_title`
- [ ] 所有 `dimensions`/`measures` 中的字段名与 CSV 列名**完全一致**（大小写敏感）

---

## Phase 2: 初版设计方案

### 图表推荐 Prompt

```
基于以下数据分析结果，设计仪表盘图表组合：

维度字段：{dimensions}
度量字段：{measures}
数据行数：{row_count}
用户分析目的：{purpose}（如用户未说明则推测）

设计原则：
1. 选择 5-8 个图表，覆盖不同分析角度
2. 图表类型要多样化（避免全是柱状图/饼图）
3. 考虑使用：雷达图、漏斗图、热力图、仪表盘等丰富图表
4. 每个图表说明推荐理由
```

### 设计方案输出要求

设计方案必须**同时输出两份内容**：

1. **Markdown 设计文档**（便于用户审核）
2. **`chart_config.json` 配置文件**（写入磁盘，供 Phase 4 直接使用）

Markdown 文档模板：

```markdown
# 📊 仪表盘设计方案

## 数据概览
- 数据来源：{file_name}
- 数据行数：{row_count}
- 维度字段：{dimensions}
- 度量字段：{measures}

## 图表设计

### 第一行：KPI 概览
| 位置 | 图表类型 | 标题 | 数据 | 推荐理由 |
|-----|---------|-----|-----|---------|
| 1-1 | KPI 卡片 | 总销售额 | sum(销售额) | 突出核心指标 |
| 1-2 | 仪表盘 | 达成率 | avg(达成率) | 直观显示进度 |
| 1-3 | KPI 卡片 | 订单数 | count(*) | 业务量指标 |

### 第二行：趋势与对比
| 位置 | 图表类型 | 标题 | 维度 | 度量 | 推荐理由 |
|-----|---------|-----|-----|-----|---------|
| 2-1 | 折线图 | 月度趋势 | 月份 | 销售额 | 展示时间趋势 |
| 2-2 | 雷达图 | 产品评分 | 评分维度 | 各项评分 | 多维度对比 |

### 第三行：分布与占比
| 位置 | 图表类型 | 标题 | 维度 | 度量 | 推荐理由 |
|-----|---------|-----|-----|-----|---------|
| 3-1 | 漏斗图 | 转化漏斗 | 阶段 | 转化数 | 转化率分析 |
| 3-2 | 热力图 | 销售热力 | 地区×产品 | 销售额 | 交叉分析 |

---

请审核以上设计方案，您可以提出以下修改：
- 增加/删除某个图表
- 更换图表类型
- 调整图表配置（标题、颜色等）
- 其他建议
```

同时必须将对应的 JSON 配置写入 `chart_config.json` 文件，确保后续 Phase 4 可直接使用。

> ⚠️ **写入 chart_config.json 之前，回顾上方"致命错误清单"逐条核对。**
>
> 特别注意：
> - 字段映射**只用** `dimensions` 和 `measures`，绝对不用 `x_field`/`y_field`/`value_field`
> - 每个 KPI 是**独立条目**，不要合并到 `config.kpis` 数组
> - 热力图必须有 **2 个** dimensions
> - 布局只用 `col_span`，不用 `size`/`width`/`position`

---

## Phase 3: 用户反馈迭代

### 迭代上限

Phase 3 最多进行 **5 轮**迭代。如果第 5 轮后用户仍有修改意见，主动提示：

> "已进行 5 轮调整，当前方案已基本完善。是否直接使用当前配置生成仪表盘？如需继续调整也可以。"

### 常见反馈处理

| 用户反馈 | 调整方式 |
|---------|---------|
| "增加一个xx图表" | 在配置中追加对应图表 |
| "把饼图换成玫瑰图" | 修改 type 为 rose |
| "不需要xx图表" | 从配置中删除 |
| "图表太多了" | 精简为 4-5 个核心图表 |
| "想看xx的趋势" | 增加对应维度的折线图 |
| "颜色不好看" | 调整主题配色 |

### 配置调整示例

```json
// 用户：把饼图换成玫瑰图，增加一个仪表盘显示达成率
{
  "charts": [
    // 原有配置...
    {
      "type": "rose",  // 从 pie 改为 rose
      "title": "产品销售占比",
      "dimensions": ["产品"],
      "measures": ["销售额"]
    },
    {
      "type": "gauge",  // 新增仪表盘
      "title": "年度目标达成率",
      "measures": ["达成率"],
      "config": {
        "max": 100,
        "unit": "%"
      }
    }
  ]
}
```

---

## Phase 4: 生成终版仪表盘

> ⚠️ **执行前最后检查**：打开 `chart_config.json`，确认以下内容：
> 1. 没有 `x_field`/`y_field`/`value_field`（只有 `dimensions`/`measures`）
> 2. 没有 `dashboard_title`（只有 `title`）
> 3. 没有 `size`/`position`（只有 `col_span`）
> 4. 热力图有 2 个 dimensions
> 5. 每个 KPI 是独立条目
> 6. 字段名与 CSV 列名大小写完全一致
>
> 如果发现以上任何问题，先修正 `chart_config.json` 再执行生成命令。

### 执行生成脚本

> **重要路径规则**：`run_skill` 的工作目录是用户工作空间根目录（`workspace/`）。所有文件路径都是相对于此目录的。如果文件在 `outputs/` 子目录中，参数必须写 `outputs/文件名`，不能省略目录前缀。

```
# 生成仪表盘 HTML
# 注意：所有路径相对于 workspace 根目录，如文件在 outputs/ 下必须加前缀
run_skill(skill_name="echarts-visualization", script="scripts/echarts_generator.py", args="--config outputs/chart_config.json --output outputs/dashboard.html --title 销售数据分析仪表盘")
```

> **`--local-echarts` 参数说明**：脚本会自动检测本地 echarts.min.js 并嵌入，通常无需手动指定。

**多数据源配置示例**（当图表使用不同 CSV 文件时，每个图表必须指定 `data_file`）：

```json
{
  "title": "分析仪表盘",
  "theme": "executive",
  "charts": [
    {"type": "kpi", "title": "总数", "data_file": "data/kpi.csv", "measures": ["total"], "col_span": 3},
    {"type": "line", "title": "趋势", "data_file": "data/trend.csv", "dimensions": ["date"], "measures": ["count"], "col_span": 12}
  ]
}
```

### 图表配置 JSON 格式

```json
{
  "title": "仪表盘标题",
  "theme": "executive",
  "charts": [
    {
      "type": "kpi",
      "title": "总销售额",
      "measures": ["销售额"],
      "config": { "agg": "sum" },
      "col_span": 3
    },
    {
      "type": "line",
      "title": "销售趋势",
      "dimensions": ["日期"],
      "measures": ["销售额"],
      "config": { "smooth": true, "agg": "sum" },
      "col_span": 8
    },
    {
      "type": "radar",
      "title": "产品评分对比",
      "dimensions": ["产品"],
      "measures": ["质量", "价格", "服务", "物流"],
      "col_span": 4
    },
    {
      "type": "funnel",
      "title": "转化漏斗",
      "dimensions": ["阶段"],
      "measures": ["用户数"],
      "col_span": 4
    },
    {
      "type": "heatmap",
      "title": "销售热力图",
      "dimensions": ["地区", "产品"],
      "measures": ["销售额"],
      "config": { "agg": "sum", "top_n": 10, "others_label": "其他产品" },
      "col_span": 6
    },
    {
      "type": "gauge",
      "title": "目标达成率",
      "measures": ["达成率"],
      "config": { "max": 100 },
      "col_span": 3
    }
  ]
}
```

### 配置字段规范（必须严格遵守）

> ⚠️ **回顾"致命错误清单"**：在写配置之前，务必已阅读上方的致命错误清单。

**顶层字段（只有 3 个）：**

| 字段 | 必填 | 说明 | 常见错误 |
|------|------|------|---------|
| `title` | 是 | 仪表盘标题 | ❌ 不要写 `dashboard_title` |
| `theme` | 否 | 7 选 1：default/executive/dark/fresh/warm/minimal/sgcc | 支持中文别名如 `国网`/`科技`/`清新` |
| `charts` | 是 | 图表数组 | — |

**每个图表的字段（只有 7 个）：**

| 字段 | 必填 | 说明 | 常见错误 |
|------|------|------|---------|
| `type` | 是 | 图表类型（见类型表） | ❌ 不要用未实现的类型 |
| `title` | 是 | 图表标题 | — |
| `dimensions` | 大部分必填 | 维度字段名数组，值必须与 CSV 列名一致 | ❌ 不要写 `x_field`/`name_field`/`category` |
| `measures` | 是 | 度量字段名数组，值必须与 CSV 列名一致 | ❌ 不要写 `y_field`/`value_field`/`y_fields` |
| `col_span` | 否 | 列宽：3/4/6/8/12 | ❌ 不要写 `size`/`width`/`position` |
| `data_file` | 多数据源必填 | 相对于配置文件目录的路径 | — |
| `config` | 否 | 图表特定配置（见下方参数表） | ❌ 不要在这里放字段映射 |

**config 内部只放图表参数，不放字段映射：**
```
✅ config 内可以放的：  {"smooth": true, "stack": true, "top_n": 10, "agg": "sum", "max": 100}
❌ config 内不能放的：  {"x_field": "...", "y_field": "...", "value_field": "...", "kpis": [...]}
```

**禁止使用的字段（脚本完全不识别，写了也没用）：**
- `id`、`description`、`position`、`size`、`width`、`layout`
- `dashboard_title`、`dashboard_subtitle`、`color_scheme`
- `auto_refresh`、`responsive`、`grid_columns`
- `x_field`、`y_field`、`value_field`、`name_field`、`indicator_field`、`y_fields`、`category`

### 数据库多文件场景的配置

当数据来源于多个 SQL 查询（多个 CSV 文件）时，每个图表需指定 `data_file` 字段：

```json
{
  "title": "销售数据分析仪表盘",
  "charts": [
    {
      "type": "kpi",
      "title": "总销售额",
      "data_file": "./data/kpi_total.csv",
      "measures": ["total_amount"],
      "config": { "agg": "sum" },
      "col_span": 3
    },
    {
      "type": "line",
      "title": "月度趋势",
      "data_file": "./data/monthly_trend.csv",
      "dimensions": ["month"],
      "measures": ["amount"],
      "col_span": 12
    }
  ]
}
```

### 新增配置能力

`config` 支持以下高频参数：

| 参数 | 类型 | 适用图表 | 说明 |
|-----|-----|---------|-----|
| `agg` | string / object | 大部分图表 | 聚合方式，支持 `sum` `mean` `avg` `count` `max` `min` `nunique` |
| `top_n` | number | `bar` `pie` `donut` `rose` `heatmap` `sunburst` `treemap` | 仅保留前 N 项，其余归并 |
| `others_label` | string | 同上 | 长尾归并后的显示名称 |
| `sort_by` | string | `bar` 等聚合图 | 按指定字段排序 |
| `sort_order` | string | `bar` 等聚合图 | `asc` / `desc` |
| `smooth` | boolean | `line` | 是否启用平滑曲线 |
| `stack` | boolean | `bar` `area` | 是否堆叠 |
| `max` | number | `gauge` | 仪表盘最大值 |
| `unit` | string | `gauge` | 仪表盘单位 |

### 产物输出

生成仪表盘时默认输出两个文件：

- `dashboard.html`：可直接在浏览器中打开的仪表盘页面
- `dashboard.manifest.json`：产物清单，包含主文件、图表列表、主题、警告信息

**输出文件位置：** HTML 文件生成在 `--output` 参数指定的路径（默认为当前目录下的 `dashboard.html`）。用户可直接在浏览器中打开该文件查看仪表盘。

### 迭代修改

Phase 4 生成完成后，用户如果不满意，可以：

1. **直接修改 `chart_config.json`** 中的图表配置（类型、标题、字段等）
2. 重新执行生成命令即可更新仪表盘，无需重走 Phase 1-3

```
# 修改 chart_config.json 后重新生成
run_skill(skill_name="echarts-visualization", script="scripts/echarts_generator.py", args="--data 数据文件.xlsx --config chart_config.json --output dashboard.html --title 销售数据分析仪表盘 --local-echarts")
```

---

## 完整工作流示例

### 示例场景：销售数据分析

**用户**：「帮我分析这个销售 Excel，生成一个仪表盘」

**Phase 1 - Agent 执行**：
```
run_skill(skill_name="echarts-visualization", script="scripts/data_analyzer.py", args="sales.xlsx --json")
```

输出：
```
维度识别：日期（时间）、地区（分类）、产品（分类）、销售阶段（分类）
度量识别：销售额（sum）、销售量（sum）、利润率（avg）、转化率（avg）
```

**Phase 2 - Agent 输出设计方案**：

| 图表 | 类型 | 用途 |
|-----|-----|-----|
| 总销售额 | KPI | 核心指标 |
| 利润率 | 仪表盘 | 进度显示 |
| 月度趋势 | 折线图 | 时间趋势 |
| 地区对比 | 条形图 | 分类对比 |
| 产品占比 | 玫瑰图 | 占比分析 |
| 销售漏斗 | 漏斗图 | 转化分析 |
| 地区×产品 | 热力图 | 交叉分析 |

同时生成 `chart_config.json` 文件。

**Phase 3 - 用户反馈**：「把玫瑰图换成环形图，再加一个雷达图看各地区综合表现」

**Phase 4 - 生成仪表盘**：
```
run_skill(skill_name="echarts-visualization", script="scripts/echarts_generator.py", args="--data sales.xlsx --config chart_config.json --output sales_dashboard.html --local-echarts")
```

输出文件：`sales_dashboard.html`，在浏览器中打开即可查看。

---

### 示例场景：数据库销售数据分析

**用户**：「帮我分析 postgres_local 数据库中的销售数据，生成仪表盘」

```json
{
  "connection": "postgres_local",
  "queries": [
    {"name": "kpi_total", "sql": "SELECT SUM(amount) as total_amount FROM sales"},
    {"name": "monthly_trend", "sql": "SELECT month, SUM(amount) as amount FROM sales GROUP BY month ORDER BY month"},
    {"name": "region_dist", "sql": "SELECT region, SUM(amount) as amount FROM sales GROUP BY region"}
  ]
}
```

**Step 1 - 验证连接**：调用 `list_connections` 确认 postgres_local 存在

**Step 2 - 执行查询**（对每个查询依次执行）：
1. 调用 MCP `execute_sql` 工具执行 SQL，获取 JSON 结果
2. 将返回的 JSON 写入临时文件（如 `mcp_result_kpi_total.json`）
3. 调用 `db_data_adapter.py` 将 JSON 转换为 CSV：
   ```
   run_skill(skill_name="echarts-visualization", script="scripts/db_data_adapter.py", args="--input mcp_result_kpi_total.json --output ./data --name kpi_total")
   ```

**Step 3 - 分析字段**：对每个 CSV 执行 `data_analyzer.py`

**Step 4 → Phase 2-4**：设计方案 → 用户确认 → 生成仪表盘

**chart_config.json 各图表类型速查**（共 15 种已实现类型，根据数据特征灵活选用）：

| type | 用途 | dimensions | measures | 推荐 col_span | config 常用参数 |
|------|------|-----------|----------|--------------|----------------|
| `kpi` | 关键指标卡片 | 不需要 | 1 个度量 | 3 | `agg`, `format` |
| `gauge` | 仪表盘/进度 | 不需要 | 1 个度量 | 3 | `max`, `unit` |
| `line` | 时间趋势 | 1 个时间维度 | 1-N 个度量 | 6-12 | `smooth`, `stack` |
| `area` | 面积趋势 | 1 个时间维度 | 1-N 个度量 | 6-12 | `smooth`, `stack` |
| `bar` | 分类对比/排名 | 1 个分类维度 | 1-N 个度量 | 4-8 | `horizontal`, `sort_order`, `top_n`, `stack` |
| `combo` | 双轴混合（柱+线） | 1 个维度 | 2+ 个度量 | 6-12 | `bar_measures`, `line_measures` |
| `pie` | 占比分析 | 1 个分类维度 | 1 个度量 | 4-6 | `top_n`, `donut` |
| `donut` | 环形占比 | 1 个分类维度 | 1 个度量 | 4-6 | `top_n` |
| `rose` | 玫瑰图（极坐标占比） | 1 个分类维度 | 1 个度量 | 4-6 | `top_n` |
| `radar` | 多维对比 | 1 个分类维度 | 2+ 个度量 | 4-6 | — |
| `funnel` | 转化漏斗 | 1 个阶段维度 | 1 个度量 | 4-6 | `sort_order` |
| `scatter` | 散点/相关性 | 1 个维度 | 2 个度量 | 6-8 | — |
| `heatmap` | 热力交叉分析 | 2 个维度 | 1 个度量 | 6-8 | `top_n`, `agg` |
| `sunburst` | 层级占比 | 2+ 个维度 | 1 个度量 | 6 | — |
| `treemap` | 矩形树图 | 2+ 个维度 | 1 个度量 | 6 | — |

**单个图表条目格式**（以 KPI 为例）：
```json
{"type": "kpi", "title": "总销售额", "data_file": "./data/kpi.csv", "measures": ["total_amount"], "col_span": 3}
```

> **关键要点**：
> - 根据数据特征选择合适的图表类型，**不要只用 line/bar/pie**，充分利用 15 种类型
> - 每个 KPI 是**独立条目**，不要合并到数组中
> - `dimensions` 和 `measures` 的值必须与 CSV 文件的列名**完全一致**
> - 多数据源时每个图表必须指定 `data_file`
> - 布局用 `col_span`（总宽 12 列）：KPI/gauge 用 3，大图用 8 或 12，中图用 4 或 6

---

### 示例场景：快速生成

**用户**：「快速生成一个销售数据仪表盘」

Phase 1 完成数据分析后，跳过 Phase 2-3 交互，直接使用推荐配置生成：
```
run_skill(skill_name="echarts-visualization", script="scripts/echarts_generator.py", args="--data sales.xlsx --config chart_config.json --output sales_dashboard.html --local-echarts")
```

---

## 常见错误处理

| 错误现象 | 可能原因 | 解决方法 |
|---------|---------|---------|
| `FileNotFoundError` | 数据文件路径错误 | 检查文件路径是否正确，确认文件存在 |
| `UnicodeDecodeError` | 文件编码不是 UTF-8 | 尝试指定编码参数，如 `--encoding gbk` 或 `--encoding gb2312` |
| `ModuleNotFoundError: No module named 'pandas'` | Python 依赖未安装 | 执行 `pip install pandas openpyxl xlrd tabulate` |
| `ModuleNotFoundError: No module named 'openpyxl'` | Excel 读取库未安装 | 执行 `pip install openpyxl`（.xlsx）或 `pip install xlrd`（.xls） |
| 图表显示空白或数据为 0 | 字段名与数据不匹配 | 检查 `chart_config.json` 中的 `dimensions` 和 `measures` 字段名是否与数据文件中的列名完全一致（区分大小写） |
| `KeyError: '字段名'` | 配置中引用了不存在的列 | 运行 `data_analyzer.py` 查看实际列名，修正配置 |
| ECharts 图表不显示（内网） | 未使用 `--local-echarts` | 重新生成时添加 `--local-echarts` 参数 |
| `JSONDecodeError` | chart_config.json 格式错误 | 检查 JSON 语法（多余逗号、缺少引号等） |

---

## 依赖要求

```bash
# Python 依赖
pip install pandas openpyxl xlrd tabulate
```

---

## 主题配色

默认使用渐变紫色主题：
- 主色：`#667eea`
- 辅色：`#764ba2`
- 渐变：`linear-gradient(135deg, #667eea, #764ba2)`
- 图表色系：`["#667eea", "#764ba2", "#f093fb", "#f5576c", "#4facfe", "#00f2fe", "#43e97b", "#38f9d7"]`

---

## 布局系统

采用 12 列栅格，通过 `col_span` 控制宽度：

```
┌────┬────┬────┬────┐
│ 3  │ 3  │ 3  │ 3  │  KPI 卡片区
├────┴────┴────┴────┤
│        12         │  主图表区
├─────────┬─────────┤
│    6    │    6    │  对比图表区
├────┬────┴────┬────┤
│ 4  │    4    │ 4  │  辅助图表区
└────┴─────────┴────┘
```

响应式断点：
- 桌面 (>1024px)：完整栅格
- 平板 (768-1024px)：col-3→col-6, col-6→col-12
- 手机 (<768px)：全部 col-12

---

## 常见问题

### Q: 支持哪些数据格式？
A: Excel (.xlsx, .xls)、CSV、JSON、**数据库查询**（通过 MCP）

### Q: 如何处理大数据量？
A: 建议在 SQL 中使用 GROUP BY 聚合；MCP 默认限制 10000 行

### Q: 如何配置数据库连接？
A: 在 `.opencode/mcp/database-connector/connections.json` 中配置

### Q: 如何自定义配色？
A: 在配置中指定 `colors` 数组，或修改脚本中的 `THEME` 变量

### Q: 图表如何联动？
A: 在配置中添加 `"connect": true`
