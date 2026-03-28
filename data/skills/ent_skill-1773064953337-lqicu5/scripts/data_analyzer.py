#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECharts Visualization Skill - Data Analyzer
解析 Excel/CSV/JSON 数据，提取字段元数据用于可视化分析
"""

import re
import sys
import json
import warnings
import argparse
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    import pandas as pd
except ImportError:
    print("Error: pandas not installed. Run: pip install pandas openpyxl xlrd")
    sys.exit(1)


SEMANTIC_RULES = {
    "identifier": [r"(^|_)(id|uuid|编号|编码|单号|序号|工号|员工id|订单id|code|sku|条码|barcode)(_|$)"],
    "time": [r"(^|_)(date|time|day|week|month|quarter|year|日期|时间|月份|年度|年份|created_at|updated_at|创建时间|更新时间|登记日期|交易日期|入职日期|期间)(_|$)"],
    "rate": [r"(^|_)(rate|ratio|pct|percent|达成率|利润率|离职率|占比|比例|转化率|增长率|完成率|合格率|良品率|同比|环比)(_|$)"],
    "amount": [r"(^|_)(amount|revenue|sales|fee|cost|price|income|profit|budget|利润|收入|销售额|薪资|金额|费用|成本|营收|毛利|净利|单价|总价|税额|折扣)(_|$)"],
    "count": [r"(^|_)(count|qty|quantity|num|total|用户数|订单数|人数|数量|库存|访问量|点击量|次数|件数)(_|$)"],
    "category": [r"(^|_)(name|type|category|region|dept|department|status|level|grade|产品|地区|部门|类别|阶段|学历|性别|渠道|品牌|行业|省份|城市|状态|等级)(_|$)"],
    "geography": [r"(^|_)(country|province|city|district|address|国家|省|市|区|县|地址|邮编|zip)(_|$)"],
    "flag": [r"(^|_)(is_|has_|flag|enabled|active|是否|标记)"],
}

# 日期预筛正则：匹配常见日期格式
_DATE_PRE_SCREEN_RE = re.compile(
    r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}"  # 2024-01-01 or 2024/1/1
    r"|^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}"  # 01-01-2024
    r"|^\d{4}年\d{1,2}月"  # 2024年1月
    r"|^\d{8}$"  # 20240101
)

# 数字型标识符字段名匹配
_NUMERIC_ID_NAME_RE = re.compile(
    r"(^|_)(id|编号|编码|单号|序号|工号|code|sku|条码|barcode|phone|手机|电话|mobile|邮编|zip|身份证|idcard|证件号)(_|$)",
    re.IGNORECASE,
)


def normalize_name(name: str) -> str:
    """标准化字段名，支持 camelCase → snake_case 转换"""
    s = str(name).strip()
    # camelCase → snake_case: insertBefore 'userId' → 'user_id'
    s = re.sub(r"([a-z])([A-Z])", r"\1_\2", s)
    return re.sub(r"\s+", "_", s).lower()


def detect_semantic(name: str) -> Optional[str]:
    normalized = normalize_name(name)
    for semantic, patterns in SEMANTIC_RULES.items():
        for pattern in patterns:
            if re.search(pattern, normalized, re.IGNORECASE):
                return semantic
    return None


def infer_default_aggregation(field_info: Dict[str, Any]) -> str:
    semantic = field_info.get("semantic")
    ftype = field_info.get("type")
    if semantic == "rate":
        return "mean"
    if semantic == "identifier":
        return "count"
    if semantic in {"amount", "count"}:
        return "sum"
    if ftype == "numeric" and field_info.get("numeric_type") == "continuous":
        return "sum"
    if ftype == "numeric":
        return "mean"
    # 非 numeric 字段也给 default_aggregation
    if ftype == "datetime":
        return "count"
    if ftype == "categorical":
        if semantic == "flag":
            return "count"
        return "count"
    return "count"


def profile_sample(series: pd.Series, limit: int = 5) -> List[Any]:
    sample = []
    for value in series.dropna().head(limit).tolist():
        if isinstance(value, pd.Timestamp):
            sample.append(value.isoformat())
        elif hasattr(value, "item"):
            sample.append(value.item())
        else:
            sample.append(value)
    return sample


def _is_likely_identifier(series: pd.Series, field_name: str) -> bool:
    """检测数字型标识符（邮编、手机号、ID 等）"""
    normalized = normalize_name(field_name)
    # 字段名匹配 identifier 模式
    if _NUMERIC_ID_NAME_RE.search(normalized):
        return True
    # 高唯一率 + 大数值：可能是手机号、身份证等
    non_null = series.dropna()
    if len(non_null) == 0:
        return False
    unique_ratio = series.nunique() / max(len(non_null), 1)
    if unique_ratio > 0.9 and non_null.min() > 10000:
        return True
    return False


def _date_pre_screen(series: pd.Series, sample_size: int = 100) -> bool:
    """采样预筛：判断 object 列是否可能是日期"""
    non_null = series.dropna()
    if len(non_null) == 0:
        return False
    sample = non_null.head(sample_size).astype(str)
    match_count = sum(1 for v in sample if _DATE_PRE_SCREEN_RE.match(v.strip()))
    return match_count / len(sample) > 0.5


def _validate_date_range(parsed_dates: pd.Series) -> bool:
    """校验解析后的日期是否在合理范围（1900-2100）"""
    valid = parsed_dates.dropna()
    if len(valid) == 0:
        return False
    min_year = valid.min().year
    max_year = valid.max().year
    return 1900 <= min_year and max_year <= 2100


def detect_field_type(series: pd.Series) -> dict:
    """检测字段类型并返回详细信息"""
    non_null = series.dropna()
    field_info = {
        "name": series.name,
        "dtype": str(series.dtype),
        "null_count": int(series.isnull().sum()),
        "unique_count": int(series.nunique()),
        "semantic": detect_semantic(series.name),
    }

    if pd.api.types.is_datetime64_any_dtype(series):
        field_info["type"] = "datetime"
        field_info["min_date"] = str(series.min()) if not series.dropna().empty else None
        field_info["max_date"] = str(series.max()) if not series.dropna().empty else None
        field_info["sample"] = profile_sample(series)
        field_info["default_aggregation"] = infer_default_aggregation(field_info)
        return field_info

    if series.dtype == "object":
        # P0: 采样预筛，通过后再全量解析
        if _date_pre_screen(series):
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", UserWarning)
                parsed_dates = pd.to_datetime(series, errors="coerce")
            valid_dates = parsed_dates.notna().sum()
            # P1: 阈值 0.8 → 0.9，并增加年份范围校验
            if (
                len(series) > 0
                and valid_dates / len(series) > 0.9
                and _validate_date_range(parsed_dates)
            ):
                field_info["type"] = "datetime"
                field_info["min_date"] = str(parsed_dates.min())
                field_info["max_date"] = str(parsed_dates.max())
                field_info["sample"] = profile_sample(series)
                field_info["default_aggregation"] = infer_default_aggregation(field_info)
                return field_info

    if pd.api.types.is_numeric_dtype(series):
        # P1: 数字型标识符检测（邮编、手机号等）
        if _is_likely_identifier(series, str(series.name)):
            field_info["type"] = "categorical"
            field_info["semantic"] = "identifier"
            field_info["sample"] = profile_sample(series)
            field_info["cardinality"] = "high"
            field_info["default_aggregation"] = infer_default_aggregation(field_info)
            return field_info

        field_info["type"] = "numeric"
        field_info["min"] = float(series.min()) if not pd.isna(series.min()) else None
        field_info["max"] = float(series.max()) if not pd.isna(series.max()) else None
        field_info["mean"] = round(float(series.mean()), 4) if not pd.isna(series.mean()) else None
        field_info["std"] = round(float(series.std()), 4) if not pd.isna(series.std()) else None
        field_info["sample"] = [float(x) if not pd.isna(x) else None for x in series.head(5).tolist()]
        # P1: zero_count bug 修复 — 不再把 NaN 填充为 0 后误计
        field_info["zero_count"] = int((non_null == 0).sum())
        if field_info["unique_count"] < 20 and field_info["unique_count"] / max(len(series), 1) < 0.05:
            field_info["numeric_type"] = "discrete"
        else:
            field_info["numeric_type"] = "continuous"
        field_info["default_aggregation"] = infer_default_aggregation(field_info)
        return field_info

    # categorical
    field_info["type"] = "categorical"
    if field_info["unique_count"] <= 30:
        field_info["categories"] = profile_sample(non_null, 30)
    field_info["sample"] = profile_sample(series)
    ratio = field_info["unique_count"] / max(len(series), 1)
    field_info["cardinality"] = "low" if ratio < 0.05 else ("medium" if ratio < 0.3 else "high")
    field_info["default_aggregation"] = infer_default_aggregation(field_info)
    return field_info


def suggest_roles(fields: list) -> dict:
    """基于字段特征自动建议维度和度量"""
    dimensions = []
    measures = []

    for field in fields:
        name = field["name"]
        ftype = field["type"]
        semantic = field.get("semantic")

        if ftype == "datetime" or semantic == "time":
            dimensions.append({
                "name": name,
                "role": "time_dimension",
                "reason": "时间类型字段，适合作为时间轴",
            })
            continue

        if semantic == "identifier":
            measures.append({
                "name": name,
                "role": "count_measure",
                "aggregation": "count",
                "reason": "标识字段，适合计数而不是求和",
            })
            continue

        if semantic == "geography":
            dimensions.append({
                "name": name,
                "role": "geo_dimension",
                "reason": "地理字段，适合地图可视化",
            })
            continue

        if semantic == "flag":
            dimensions.append({
                "name": name,
                "role": "flag_dimension",
                "reason": "布尔标记字段，适合作为筛选维度",
            })
            continue

        if ftype == "categorical":
            if semantic == "category" or field.get("cardinality") in ["low", "medium"]:
                dimensions.append({
                    "name": name,
                    "role": "category_dimension",
                    "reason": f"分类字段，{field['unique_count']}个唯一值",
                })
            continue

        if ftype == "numeric":
            agg = field.get("default_aggregation", infer_default_aggregation(field))
            if semantic == "rate":
                measures.append({
                    "name": name,
                    "role": "ratio_measure",
                    "aggregation": agg,
                    "reason": "比率型指标，默认取平均值",
                })
            elif semantic in {"amount", "count"}:
                measures.append({
                    "name": name,
                    "role": "measure",
                    "aggregation": agg,
                    "reason": "业务数值字段，适合聚合分析",
                })
            elif field.get("numeric_type") == "continuous":
                measures.append({
                    "name": name,
                    "role": "measure",
                    "aggregation": agg,
                    "reason": "连续数值，适合作为度量字段",
                })
            else:
                dimensions.append({
                    "name": name,
                    "role": "possible_dimension",
                    "reason": f"离散数值，{field['unique_count']}个唯一值，可作为分组维度",
                })

    return {"dimensions": dimensions, "measures": measures}


def recommend_chart_types(fields: List[Dict[str, Any]], roles: Dict[str, Any], row_count: int) -> List[Dict[str, Any]]:
    recommendations: List[Dict[str, Any]] = []
    dimensions = roles.get("dimensions", [])
    measures = roles.get("measures", [])

    time_dims = [d for d in dimensions if d.get("role") == "time_dimension"]
    category_dims = [d for d in dimensions if d.get("role") in {"category_dimension", "possible_dimension"}]
    geo_dims = [d for d in dimensions if d.get("role") == "geo_dimension"]
    ratio_measures = [m for m in measures if m.get("role") == "ratio_measure"]
    count_measures = [m for m in measures if m.get("aggregation") == "count"]
    amount_measures = [m for m in measures if m["name"] not in {x["name"] for x in ratio_measures}]
    # 连续数值度量（排除 count_measure）
    numeric_measures = [m for m in measures if m.get("role") in {"measure", "ratio_measure"}]

    if measures:
        recommendations.append({"type": "kpi", "reason": "优先展示核心指标总览"})
    if time_dims and measures:
        recommendations.append({"type": "line", "reason": f"适合展示 {time_dims[0]['name']} 的时间趋势"})
    if time_dims and len(measures) > 1:
        recommendations.append({"type": "area", "reason": "多指标时间序列可用面积图或组合图"})
    if category_dims and amount_measures:
        target_dim = category_dims[0]
        target_field = next((f for f in fields if f.get("name") == target_dim["name"]), None)
        if target_field and target_field.get("cardinality") == "high":
            recommendations.append({"type": "bar", "reason": "高基数字段建议使用 Top N 条形图"})
            recommendations.append({"type": "treemap", "reason": "层级或长尾占比可用矩形树图"})
        else:
            recommendations.append({"type": "bar", "reason": "分类维度适合做对比分析"})
            # P1: 饼图基数限制 — unique_count <= 8 时才推荐
            if target_field and target_field.get("unique_count", 999) <= 8:
                recommendations.append({"type": "pie", "reason": "低基数分类（≤8）适合占比展示"})
    # P1: 散点图推荐 — 2 个连续数值度量时
    if len(numeric_measures) >= 2:
        recommendations.append({
            "type": "scatter",
            "reason": f"两个数值字段（{numeric_measures[0]['name']} vs {numeric_measures[1]['name']}）适合散点图相关性分析",
        })
    if len(category_dims) >= 2 and amount_measures:
        recommendations.append({"type": "heatmap", "reason": "两个分类维度交叉分析可用热力图"})
    if len(category_dims) >= 1 and len(measures) >= 3:
        recommendations.append({"type": "radar", "reason": "多指标评估适合雷达图"})
    if ratio_measures:
        recommendations.append({"type": "gauge", "reason": "比率指标适合用仪表盘突出"})
    # P1: 地图推荐 — geography 语义字段 + measures
    if geo_dims and measures:
        recommendations.append({"type": "map", "reason": f"地理字段 {geo_dims[0]['name']} 配合度量，适合地图可视化"})
    # P1: 漏斗图条件收紧 — 需要包含"阶段|stage|step|phase|funnel|转化"的分类字段
    _funnel_re = re.compile(r"(阶段|stage|step|phase|funnel|转化)", re.IGNORECASE)
    has_funnel_dim = any(
        _funnel_re.search(normalize_name(d["name"])) for d in category_dims
    )
    if has_funnel_dim and count_measures:
        recommendations.append({"type": "funnel", "reason": "存在阶段字段，适合做漏斗转化分析"})

    seen = set()
    deduped = []
    for item in recommendations:
        if item["type"] in seen:
            continue
        seen.add(item["type"])
        deduped.append(item)
    return deduped[:8]


def build_analysis_summary(fields: List[Dict[str, Any]], roles: Dict[str, Any]) -> Dict[str, Any]:
    semantics = {}
    for field in fields:
        semantic = field.get("semantic")
        if semantic:
            semantics.setdefault(semantic, []).append(field["name"])

    return {
        "time_dimensions": [item["name"] for item in roles.get("dimensions", []) if item.get("role") == "time_dimension"],
        "category_dimensions": [item["name"] for item in roles.get("dimensions", []) if item.get("role") not in {"time_dimension", "geo_dimension", "flag_dimension"}],
        "geo_dimensions": [item["name"] for item in roles.get("dimensions", []) if item.get("role") == "geo_dimension"],
        "measures": [item["name"] for item in roles.get("measures", [])],
        "semantic_groups": semantics,
    }


def read_data(file_path: str, max_rows: Optional[int] = None) -> pd.DataFrame:
    """读取数据文件，支持 Excel/CSV/JSON/JSON Lines"""
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix in [".xlsx", ".xls"]:
        df = pd.read_excel(file_path)
        if max_rows is not None:
            df = df.head(max_rows)
        return df
    if suffix == ".csv":
        for encoding in ["utf-8", "gbk", "gb2312", "utf-8-sig"]:
            try:
                return pd.read_csv(file_path, encoding=encoding, nrows=max_rows)
            except UnicodeDecodeError:
                continue
        raise ValueError("Unable to read CSV file with common encodings")
    if suffix == ".json":
        # P2: JSON Lines 兜底
        try:
            df = pd.read_json(file_path)
        except ValueError:
            df = pd.read_json(file_path, lines=True)
        if max_rows is not None:
            df = df.head(max_rows)
        return df
    raise ValueError(f"Unsupported file format: {suffix}")


def analyze_data(file_path: str, sample_rows: int = 10, max_rows: Optional[int] = None) -> dict:
    df = read_data(file_path, max_rows=max_rows)
    fields = [detect_field_type(df[col]) for col in df.columns]
    roles = suggest_roles(fields)
    summary = build_analysis_summary(fields, roles)
    recommendations = recommend_chart_types(fields, roles, len(df))
    sample_data = df.head(sample_rows).to_dict(orient="records")

    return {
        "file_path": str(file_path),
        "row_count": len(df),
        "column_count": len(df.columns),
        "fields": fields,
        "suggested_dimensions": roles["dimensions"],
        "suggested_measures": roles["measures"],
        "recommended_charts": recommendations,
        "summary": summary,
        "sample_data": sample_data,
        "analysis_time": datetime.now().isoformat(),
    }


def print_summary(result: dict):
    print("\n" + "=" * 60)
    print(f"[Data Analysis Report]: {result['file_path']}")
    print("=" * 60)
    print(f"Rows: {result['row_count']:,}")
    print(f"Columns: {result['column_count']}")

    print("\n[Fields Overview]:")
    print("-" * 60)
    for field in result["fields"]:
        icon = {"numeric": "[NUM]", "datetime": "[DATE]", "categorical": "[CAT]"}.get(field["type"], "[?]")
        semantic = f" / {field['semantic']}" if field.get("semantic") else ""
        print(f"  {icon} {field['name']}: {field['type']}{semantic} ({field['unique_count']} unique)")

    print("\n[Suggested Dimensions]:")
    for dim in result["suggested_dimensions"]:
        print(f"  * {dim['name']}: {dim['reason']}")

    print("\n[Suggested Measures]:")
    for measure in result["suggested_measures"]:
        print(f"  * {measure['name']} [{measure['aggregation']}]: {measure['reason']}")

    print("\n[Recommended Charts]:")
    for chart in result.get("recommended_charts", []):
        print(f"  * {chart['type']}: {chart['reason']}")

    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(description="ECharts Data Analyzer")
    parser.add_argument("file", nargs="?", help="Data file path (Excel/CSV/JSON)")
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--output", "-o", help="Output file path")
    parser.add_argument("--sample", type=int, default=10, help="Number of sample rows")
    parser.add_argument("--max-rows", type=int, default=None, help="Max rows to read (default: unlimited)")
    parser.add_argument("--test", action="store_true", help="Run self-test")

    args = parser.parse_args()

    if args.test:
        print("[OK] Data analyzer module loaded successfully!")
        print("Dependencies: pandas, openpyxl")
        return

    if not args.file:
        parser.error("file argument is required when not using --test")

    try:
        result = analyze_data(args.file, args.sample, max_rows=args.max_rows)
        if args.json or args.output:
            json_output = json.dumps(result, ensure_ascii=False, indent=2, default=str)
            if args.output:
                with open(args.output, "w", encoding="utf-8") as file:
                    file.write(json_output)
                print(f"[OK] Analysis saved to: {args.output}")
            else:
                print(json_output)
        else:
            print_summary(result)
    except Exception as exc:
        print(f"[ERROR] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
