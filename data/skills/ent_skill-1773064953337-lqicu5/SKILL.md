---
name: echarts-visualization
description: 智能可视化分析技能，基于 Excel/数据库数据自动生成 ECharts 仪表盘
version: 1.0.0
command-dispatch: tool
command-tool: run_skill
---

# ECharts 可视化分析助手

> **调用方式**：所有脚本通过 `run_skill` 工具调用，不要用 exec/bash 直接执行。
>
> **路径规则**：`run_skill` 工作目录是用户 workspace 根目录。所有文件路径用**相对路径**。**不要用 `/workspace/` 等绝对路径。**
>
> **目录约定**：`temp/` 放 JSON 中间文件，`data/` 放 CSV 数据文件，`outputs/` 放最终 HTML。

---

## 核心流程

```
Phase 1: 获取数据 → 查询数据库 / 读取文件 → 转成 CSV
Phase 2: 规划图表 → 写一个简单的 JSON 数组：[标题, 图表类型, CSV文件]
Phase 3: 一键生成 → auto_dashboard.py 自动推断维度/度量，生成 HTML
```

- **你只需决定 2 件事：图表类型 / 用哪个 CSV 文件**
- **不需要指定**：dimensions、measures、col_span、smooth、horizontal 等 —— 全部由生成器自动推断
- **执行原则**：先完整规划所有分析维度和查询，再批量执行，不要想一个做一个
- **不要每步暂停**：拿到数据后连贯执行全部流程直到生成 HTML

---

## 数据源

1. 📁 **文件** — Excel/CSV/JSON 文件
2. 🗄️ **数据库** — 通过 MCP `execute_sql` 查询

### 数据库流程

> **执行原则**：拿到数据后连贯执行全部流程，不要每步暂停等用户确认。

```
1. 调用 list_connections 获取所有可用连接（返回连接名列表）
   - 用户可能配置了多个数据库连接（如 sales_db、hr_db、log_db 等）
   - 根据用户指定的表或分析目标，选择正确的连接名
   - 如果不确定用哪个连接，列出可用连接让用户选择
2. 调用 execute_sql（指定 connection 参数）查看表结构（DESCRIBE）和样本数据（LIMIT 5）
3. 【重要】一次性规划所有分析维度和 SQL，写成 SQL 计划 JSON：
   - connection 字段必须填第 1 步获取到的连接名
   - 用户要求"深度分析"时，至少从 6-8 个角度设计查询
   - 【KPI 数据】必须单独写一条汇总 SQL（输出单行），name 为 "kpi_summary"
4. 用 exec 将 SQL 计划写入 temp/sql_plan.json
5. 调用 batch_sql.py 一键并行执行全部 SQL → 自动保存 CSV 到 data/
6. 进入 Phase 2-3（写图表配置 + 生成仪表盘）
```

---

## 脚本调用

### Phase 1: 数据准备

**文件数据源**（Excel/CSV）：

第一步：分析文件结构
```
run_skill(skill_name="echarts-visualization", script="scripts/data_analyzer.py", args="数据文件.xlsx --json")
```

第二步：根据分析结果，规划查询计划并用 exec 写入 `temp/excel_plan.json`：
```json
{
  "file": "data/sales_data.xlsx",
  "sheet": "Sheet1",
  "queries": [
    {"name": "kpi_summary",    "agg": "summary"},
    {"name": "region_sales",   "group_by": ["region"],           "measures": {"amount": "sum", "quantity": "sum"}},
    {"name": "monthly_trend",  "group_by": ["month"],            "measures": {"amount": "sum"}},
    {"name": "product_compare","group_by": ["product"],          "measures": {"amount": "sum", "quantity": "mean"}},
    {"name": "region_product", "group_by": ["region", "product"],"measures": {"amount": "sum"}},
    {"name": "top_customers",  "group_by": ["customer"],         "measures": {"amount": "sum"}, "sort": "amount", "limit": 20}
  ]
}
```

第三步：一条命令批量聚合，输出所有 CSV：
```
run_skill(skill_name="echarts-visualization", script="scripts/excel_query.py", args="--input temp/excel_plan.json")
```

聚合函数：`sum`、`mean`、`count`、`min`、`max`、`nunique`、`median`
特殊类型：`"agg": "summary"` 自动生成 KPI 汇总，`"agg": "raw"` 不聚合直接取列

**数据库数据源** — 用 exec 写 SQL 计划 JSON（`temp/sql_plan.json`），然后一条命令批量执行：

```json
{
  "connection": "从 list_connections 获取到的连接名",
  "queries": [
    {"name": "kpi_summary",   "sql": "SELECT COUNT(*) as total, COUNT(DISTINCT user_id) as users, ROUND(SUM(success)/COUNT(*)*100,2) as success_rate FROM audit_logs"},
    {"name": "daily_trend",   "sql": "SELECT DATE(created_at) as date, COUNT(*) as log_count FROM audit_logs GROUP BY date ORDER BY date"},
    {"name": "action_dist",   "sql": "SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action ORDER BY count DESC"},
    {"name": "user_activity",  "sql": "SELECT user_id, COUNT(*) as log_count FROM audit_logs GROUP BY user_id ORDER BY log_count DESC"},
    {"name": "success_rate",   "sql": "SELECT CASE WHEN success=1 THEN '成功' ELSE '失败' END as status, COUNT(*) as count FROM audit_logs GROUP BY success"},
    {"name": "hourly_dist",    "sql": "SELECT HOUR(created_at) as hour, COUNT(*) as log_count FROM audit_logs GROUP BY hour ORDER BY hour"},
    {"name": "user_action",    "sql": "SELECT user_id, action, COUNT(*) as count FROM audit_logs GROUP BY user_id, action"}
  ]
}
```

```
run_skill(skill_name="echarts-visualization", script="scripts/batch_sql.py", args="--input temp/sql_plan.json")
```

脚本会**并行执行**所有 SQL，直接保存为 `data/{name}.csv`。一次调用完成全部数据准备。

### Phase 2-3: 写配置 + 一键生成

**第一步**：用 exec 将图表计划写入 JSON 文件（`temp/dashboard_plan.json`）：

```json
{
  "title": "审计日志分析仪表盘",
  "theme": "executive",
  "charts": [
    ["KPI汇总",          "kpi",     "data/kpi_summary.csv"],
    ["日志数量日趋势",     "line",    "data/daily_trend.csv"],
    ["操作类型分布",       "bar",     "data/action_dist.csv"],
    ["用户活动对比",       "bar",     "data/user_activity.csv"],
    ["成功率分布",         "donut",   "data/success_rate.csv"],
    ["资源使用分布",       "bar",     "data/resource_usage.csv"],
    ["小时活动分布",       "line",    "data/hourly_dist.csv"],
    ["用户×操作交叉",      "heatmap", "data/user_action.csv"]
  ]
}
```

每项只需 3 个值：`[标题, 图表类型, CSV文件路径]`。dimensions/measures 由脚本自动推断。
KPI 类型会自动拆分：CSV 有几个数值列就生成几个 KPI 卡片。

**第二步**：一条命令生成仪表盘：
```
run_skill(skill_name="echarts-visualization", script="scripts/auto_dashboard.py", args="--input temp/dashboard_plan.json --output outputs/dashboard.html")
```

---

## 图表类型

| type | 用途 |
|------|------|
| `kpi` | 关键指标卡片 |
| `line` | 时间趋势 |
| `area` | 面积趋势 |
| `bar` | 分类对比 |
| `combo` | 柱+线双轴 |
| `pie` | 饼图占比 |
| `donut` | 环形占比 |
| `rose` | 玫瑰图 |
| `radar` | 多维对比 |
| `funnel` | 转化漏斗 |
| `scatter` | 散点/相关性 |
| `heatmap` | 热力交叉 |
| `sunburst` | 层级占比 |
| `treemap` | 矩形树图 |
| `waterfall` | 瀑布/增减 |
| `table` | 数据表格 |

### 选择参考

```
时间维度 + 数值       → line / area
分类 + 数值           → bar / pie / donut / rose
多指标评估            → radar
阶段转化              → funnel
增减分解              → waterfall
两分类交叉            → heatmap
层级结构              → sunburst / treemap
单指标               → kpi
明细或排名            → table
```

---

## 自动处理（你不需要操心）

| 功能 | 自动规则 |
|------|---------|
| **布局** | KPI→3列×4个/行，大图(line/area)→8列配4列小图，中图→6+6，自动凑满12列 |
| **排序** | 时间维度按时间正序，数值维度按自然数序，分类维度按值降序 |
| **平滑** | line/area 默认平滑曲线 |
| **横向** | bar 维度标签平均超 4 字符时自动横向 |
| **截取** | bar/pie 类别超 10 个时自动 top_n=10 |
| **颜色** | 不同图表自动轮转 8 色，不会全部同色 |
| **字段修正** | x_field/y_field/value_field → dimensions/measures |

---

## 主题

| 主题名 | 风格 |
|--------|------|
| `default` | 紫色渐变 |
| `executive` | 商务蓝 |
| `dark` | 暗色科技风 |
| `fresh` | 清新自然绿 |
| `warm` | 暖色活力橙红 |
| `minimal` | 极简灰白 |
| `sgcc` | 国网绿 |

---

## 注意事项

1. `dimensions`/`measures` 的值必须与 CSV 列名**完全一致**
2. 生成配置前先用 `data_analyzer.py` 查看实际列名
3. 多数据源时每个图表都要指定 `data_file`
4. 热力图必须有 **2 个** dimensions
