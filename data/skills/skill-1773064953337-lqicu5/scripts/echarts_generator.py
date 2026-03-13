#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECharts Visualization Skill - Chart Generator
基于数据和配置生成 ECharts 仪表盘 HTML
"""

import re
import sys
import json
import html
import math
import warnings
import argparse
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional

try:
    import pandas as pd
except ImportError:
    print("Error: pandas not installed. Run: pip install pandas openpyxl")
    sys.exit(1)


THEMES: Dict[str, Dict[str, Any]] = {
    "default": {
        "primary": "#667eea",
        "secondary": "#764ba2",
        "gradient": "linear-gradient(135deg, #667eea, #764ba2)",
        "colors": ["#667eea", "#764ba2", "#f093fb", "#f5576c", "#4facfe", "#00f2fe", "#43e97b", "#38f9d7"],
        "bg": "#f8fafc",
        "card": "#ffffff",
        "text": "#1e293b",
        "text_secondary": "#64748b",
        "border": "#e2e8f0",
        "style": {
            "kpi_mode": "gradient",
            "line_width": 3,
            "line_glow": False,
            "bar_radius": [4, 4, 0, 0],
            "bar_glass": False,
            "shadow": "0 6px 18px -10px rgba(15, 23, 42, 0.18), 0 8px 24px -16px rgba(15, 23, 42, 0.12)",
            "card_border": "1px solid rgba(148, 163, 184, 0.12)",
            "meta_bg": "rgba(255,255,255,0.72)",
            "zebra_bg": "rgba(0,0,0,0.02)",
            "hover_bg": "rgba(102,126,234,0.06)",
            "heatmap_colors": ["#f8fafc", "#667eea", "#764ba2"],
            "chart_bg": "transparent",
            "pie_inner": "40%",
            "pie_outer": "70%",
            "pie_gap": 2,
            "gauge_pointer_color": None,
        },
    },
    "executive": {
        "primary": "#0f4c81",
        "secondary": "#2b6cb0",
        "gradient": "linear-gradient(135deg, #0f4c81, #2b6cb0)",
        "colors": ["#0f4c81", "#2b6cb0", "#4c78a8", "#72b7b2", "#54a24b", "#eeca3b", "#f58518", "#e45756"],
        "bg": "#f4f7fb",
        "card": "#ffffff",
        "text": "#102a43",
        "text_secondary": "#486581",
        "border": "#d9e2ec",
        "style": {
            "kpi_mode": "gradient",
            "line_width": 2.5,
            "line_glow": False,
            "bar_radius": [3, 3, 0, 0],
            "bar_glass": False,
            "shadow": "0 4px 14px -6px rgba(16, 42, 67, 0.16), 0 6px 20px -12px rgba(16, 42, 67, 0.10)",
            "card_border": "1px solid rgba(15, 76, 129, 0.08)",
            "meta_bg": "rgba(255,255,255,0.72)",
            "zebra_bg": "rgba(0,0,0,0.02)",
            "hover_bg": "rgba(15,76,129,0.06)",
            "heatmap_colors": ["#f4f7fb", "#4c78a8", "#0f4c81"],
            "chart_bg": "transparent",
            "pie_inner": "42%",
            "pie_outer": "68%",
            "pie_gap": 2,
            "gauge_pointer_color": None,
        },
    },
    "dark": {
        "primary": "#00d4ff",
        "secondary": "#a78bfa",
        "gradient": "linear-gradient(135deg, #0f172a, #1e293b)",
        "colors": ["#00d4ff", "#a78bfa", "#34d399", "#fb923c", "#f472b6", "#38bdf8", "#fbbf24", "#4ade80"],
        "bg": "#0f172a",
        "card": "#1e293b",
        "text": "#e2e8f0",
        "text_secondary": "#94a3b8",
        "border": "#334155",
        "style": {
            "kpi_mode": "glow_border",
            "line_width": 2.5,
            "line_glow": True,
            "bar_radius": [6, 6, 0, 0],
            "bar_glass": True,
            "shadow": "0 0 20px rgba(0, 212, 255, 0.08), 0 4px 16px rgba(0, 0, 0, 0.3)",
            "card_border": "1px solid rgba(0, 212, 255, 0.15)",
            "meta_bg": "rgba(30, 41, 59, 0.8)",
            "zebra_bg": "rgba(255,255,255,0.03)",
            "hover_bg": "rgba(0,212,255,0.08)",
            "heatmap_colors": ["#0f172a", "#00d4ff", "#a78bfa"],
            "chart_bg": "transparent",
            "pie_inner": "45%",
            "pie_outer": "72%",
            "pie_gap": 3,
            "gauge_pointer_color": "#00d4ff",
        },
    },
    "fresh": {
        "primary": "#10b981",
        "secondary": "#06b6d4",
        "gradient": "linear-gradient(135deg, #10b981, #06b6d4)",
        "colors": ["#10b981", "#06b6d4", "#8b5cf6", "#f59e0b", "#ec4899", "#14b8a6", "#6366f1", "#84cc16"],
        "bg": "#f0fdf4",
        "card": "#ffffff",
        "text": "#064e3b",
        "text_secondary": "#6b7280",
        "border": "#d1fae5",
        "style": {
            "kpi_mode": "accent_bar",
            "line_width": 2.5,
            "line_glow": False,
            "bar_radius": [8, 8, 0, 0],
            "bar_glass": False,
            "shadow": "0 4px 14px -4px rgba(16, 185, 129, 0.12), 0 6px 20px -8px rgba(16, 185, 129, 0.08)",
            "card_border": "1px solid rgba(16, 185, 129, 0.12)",
            "meta_bg": "rgba(255,255,255,0.85)",
            "zebra_bg": "rgba(16,185,129,0.03)",
            "hover_bg": "rgba(16,185,129,0.06)",
            "heatmap_colors": ["#f0fdf4", "#6ee7b7", "#059669"],
            "chart_bg": "transparent",
            "pie_inner": "38%",
            "pie_outer": "72%",
            "pie_gap": 3,
            "gauge_pointer_color": None,
        },
    },
    "warm": {
        "primary": "#f59e0b",
        "secondary": "#ef4444",
        "gradient": "linear-gradient(135deg, #f59e0b, #ef4444)",
        "colors": ["#f59e0b", "#ef4444", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#e11d48"],
        "bg": "#fffbeb",
        "card": "#ffffff",
        "text": "#78350f",
        "text_secondary": "#92400e",
        "border": "#fde68a",
        "style": {
            "kpi_mode": "gradient",
            "line_width": 3,
            "line_glow": False,
            "bar_radius": [12, 12, 0, 0],
            "bar_glass": False,
            "shadow": "0 6px 18px -6px rgba(245, 158, 11, 0.16), 0 8px 24px -12px rgba(239, 68, 68, 0.10)",
            "card_border": "1px solid rgba(245, 158, 11, 0.15)",
            "meta_bg": "rgba(255,255,255,0.85)",
            "zebra_bg": "rgba(245,158,11,0.03)",
            "hover_bg": "rgba(245,158,11,0.06)",
            "heatmap_colors": ["#fffbeb", "#fbbf24", "#dc2626"],
            "chart_bg": "transparent",
            "pie_inner": "35%",
            "pie_outer": "70%",
            "pie_gap": 2,
            "gauge_pointer_color": None,
        },
    },
    "minimal": {
        "primary": "#6b7280",
        "secondary": "#9ca3af",
        "gradient": "linear-gradient(135deg, #6b7280, #9ca3af)",
        "colors": ["#6b7280", "#9ca3af", "#d1d5db", "#374151", "#4b5563", "#a3a3a3", "#525252", "#737373"],
        "bg": "#fafafa",
        "card": "#ffffff",
        "text": "#111827",
        "text_secondary": "#9ca3af",
        "border": "#e5e7eb",
        "style": {
            "kpi_mode": "left_stripe",
            "line_width": 1.5,
            "line_glow": False,
            "bar_radius": [2, 2, 0, 0],
            "bar_glass": False,
            "shadow": "0 1px 3px rgba(0, 0, 0, 0.06)",
            "card_border": "1px solid #e5e7eb",
            "meta_bg": "rgba(255,255,255,0.9)",
            "zebra_bg": "rgba(0,0,0,0.015)",
            "hover_bg": "rgba(0,0,0,0.03)",
            "heatmap_colors": ["#fafafa", "#9ca3af", "#374151"],
            "chart_bg": "transparent",
            "pie_inner": "50%",
            "pie_outer": "68%",
            "pie_gap": 1,
            "gauge_pointer_color": None,
        },
    },
    "sgcc": {
        "primary": "#00843D",
        "secondary": "#005a2b",
        "gradient": "linear-gradient(135deg, #00843D, #005a2b)",
        "colors": ["#00843D", "#005a2b", "#2ecc71", "#27ae60", "#1abc9c", "#3498db", "#f39c12", "#e74c3c"],
        "bg": "#f2f7f4",
        "card": "#ffffff",
        "text": "#1a3a2a",
        "text_secondary": "#5a7d6a",
        "border": "#c8e6d0",
        "style": {
            "kpi_mode": "left_stripe",
            "line_width": 2.5,
            "line_glow": False,
            "bar_radius": [4, 4, 0, 0],
            "bar_glass": False,
            "shadow": "0 4px 14px -6px rgba(0, 132, 61, 0.14), 0 6px 20px -12px rgba(0, 132, 61, 0.08)",
            "card_border": "1px solid rgba(0, 132, 61, 0.12)",
            "meta_bg": "rgba(255,255,255,0.85)",
            "zebra_bg": "rgba(0,132,61,0.03)",
            "hover_bg": "rgba(0,132,61,0.06)",
            "heatmap_colors": ["#f2f7f4", "#6ee7a0", "#00843D"],
            "chart_bg": "transparent",
            "pie_inner": "42%",
            "pie_outer": "70%",
            "pie_gap": 2,
            "gauge_pointer_color": "#00843D",
        },
    },
}

SUPPORTED_CHART_TYPES = {
    "kpi", "line", "bar", "pie", "donut", "combo", "scatter",
    "radar", "funnel", "gauge", "heatmap", "rose", "sunburst",
    "treemap", "area", "table", "waterfall",
}

VALID_COL_SPANS = {3, 4, 6, 8, 12}

# DeepSeek 常用主题别名 → 内置主题映射
THEME_ALIASES: Dict[str, str] = {
    "light": "default",
    "professional": "executive",
    "business": "executive",
    "tech": "dark",
    "科技": "dark",
    "nature": "fresh",
    "清新": "fresh",
    "活力": "warm",
    "简约": "minimal",
    "国网": "sgcc",
    "电网": "sgcc",
    "state_grid": "sgcc",
}


def _get_style(theme: Dict[str, Any], key: str, default: Any = None) -> Any:
    """安全获取主题 style 参数，兼容无 style 的旧主题"""
    return theme.get("style", {}).get(key, default)

# P1: 百分比 measure 名称匹配模式
_PERCENT_MEASURE_RE = re.compile(r"率|比|占|percent|ratio|pct", re.IGNORECASE)


def load_theme(config: Dict[str, Any]) -> Dict[str, Any]:
    theme_name = config.get("theme", "default") if isinstance(config, dict) else "default"
    # 别名解析
    resolved = THEME_ALIASES.get(theme_name, theme_name)
    return THEMES.get(resolved, THEMES["default"])


def ensure_columns(df: pd.DataFrame, columns: List[str], chart_type: str) -> None:
    missing = [col for col in columns if col not in df.columns]
    if missing:
        raise ValueError(f"{chart_type} 缺少字段: {', '.join(missing)}")


def resolve_agg(config: Dict[str, Any], measure: str, default: str = "sum") -> str:
    agg_config = config.get("agg", default)
    if isinstance(agg_config, dict):
        return agg_config.get(measure, default)
    return agg_config or default


def aggregate_series(series: pd.Series, agg: str) -> float:
    agg = (agg or "sum").lower()
    if agg == "sum":
        return float(series.sum())
    if agg in {"mean", "avg"}:
        return float(series.mean())
    if agg == "max":
        return float(series.max())
    if agg == "min":
        return float(series.min())
    if agg == "count":
        return float(series.count())
    if agg == "nunique":
        return float(series.nunique())
    raise ValueError(f"不支持的聚合方式: {agg}")


def aggregate_dataframe(df: pd.DataFrame, group_col: str, measures: List[str], config: Dict[str, Any]) -> pd.DataFrame:
    agg_map = {measure: resolve_agg(config, measure, "sum") for measure in measures}
    grouped = df.groupby(group_col, dropna=False)
    rows = []
    for key, group in grouped:
        row = {group_col: key}
        for measure in measures:
            row[measure] = aggregate_series(group[measure], agg_map[measure])
        rows.append(row)

    result = pd.DataFrame(rows)
    if result.empty:
        return pd.DataFrame(columns=[group_col] + measures)

    if is_datetime_like(df[group_col]):
        result["__sort__"] = pd.to_datetime(result[group_col], errors="coerce")
        result = result.sort_values("__sort__", na_position="last").drop(columns=["__sort__"])
    elif _is_numeric_like(result[group_col]):
        # 数值型维度（如 hour_of_day）按自然顺序排列
        result["__sort__"] = pd.to_numeric(result[group_col], errors="coerce")
        result = result.sort_values("__sort__", na_position="last").drop(columns=["__sort__"])
    else:
        sort_by = config.get("sort_by", measures[0])
        sort_order = config.get("sort_order", "desc")
        if sort_by in result.columns:
            result = result.sort_values(sort_by, ascending=(sort_order == "asc"))

    # P0: top_n 尾部聚合方式与 agg_map 对应 measure 一致，不强制 sum
    top_n = config.get("top_n")
    if top_n and isinstance(top_n, int) and top_n > 0 and len(result) > top_n:
        others_label = config.get("others_label", "其他")
        head = result.head(top_n).copy()
        tail = result.iloc[top_n:]
        tail_row = {group_col: others_label}
        for measure in measures:
            tail_row[measure] = aggregate_series(tail[measure], agg_map[measure])
        result = pd.concat([head, pd.DataFrame([tail_row])], ignore_index=True)

    return result


def is_datetime_like(series: pd.Series) -> bool:
    if pd.api.types.is_datetime64_any_dtype(series):
        return True
    if pd.api.types.is_string_dtype(series):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            parsed = pd.to_datetime(series, errors="coerce")
        valid = parsed.notna().sum()
        return len(series) > 0 and valid / max(len(series), 1) >= 0.8
    return False


def _is_numeric_like(series: pd.Series) -> bool:
    """检测字符串列是否全部是数值（如 '0', '1', '2'...）"""
    if pd.api.types.is_numeric_dtype(series):
        return True
    if pd.api.types.is_string_dtype(series):
        converted = pd.to_numeric(series, errors="coerce")
        valid = converted.notna().sum()
        return len(series) > 0 and valid / max(len(series), 1) >= 0.8
    return False


def safe_json_dumps(data: Any) -> str:
    # P0: XSS 防护 — 阻止 </script> 注入
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")


def escape_text(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _is_percent_measure(measure_name: str) -> bool:
    """判断 measure 名称是否暗示百分比语义"""
    return bool(_PERCENT_MEASURE_RE.search(measure_name))


def format_number(value: float, format_str: Optional[str] = None, measure_name: Optional[str] = None) -> str:
    """
    P0 修复：移除 abs(value) < 1 时自动乘 100 加 % 的逻辑。
    只在 format_str 明确包含 % 或 measure 名称包含率/比/占/percent/ratio/pct 时才做百分比格式化。
    """
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "-"
    if format_str:
        if "%" in format_str:
            decimals = 2 if "." in format_str else 0
            return f"{value * 100:.{decimals}f}%"
        if "," in format_str:
            decimals = 0 if "." not in format_str else len(format_str.split(".", 1)[1].rstrip("f"))
            return f"{value:,.{decimals}f}"
        if "." in format_str:
            decimals = len(format_str.split(".", 1)[1].rstrip("f%"))
            return f"{value:.{decimals}f}"
    # 如果 measure 名称暗示百分比，自动格式化
    if measure_name and _is_percent_measure(measure_name):
        return f"{value * 100:.2f}%"
    # 大数缩写
    if abs(value) >= 1_000_000:
        return f"{value / 1_000_000:.2f}M"
    if abs(value) >= 1_000:
        return f"{value / 1_000:.1f}K"
    # 不再对 abs(value) < 1 自动做百分比
    if float(value).is_integer():
        return f"{value:,.0f}"
    return f"{value:,.2f}"


def normalize_label(value: Any) -> str:
    if pd.isna(value):
        return "空值"
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d")
    return str(value)


def normalize_chart_config(chart: Dict[str, Any]) -> List[Dict[str, Any]]:
    """自动修正 DeepSeek 常见的配置错误，返回修正后的图表列表（KPI 拆分可能返回多个）"""
    if not isinstance(chart, dict):
        return [chart]

    # ── 1. 字段别名映射：x_field/y_field/... → dimensions/measures ──
    DIMENSION_ALIASES = {"x_field", "name_field", "indicator_field", "category",
                         "x", "label_field", "group_field", "dimension"}
    MEASURE_ALIASES = {"y_field", "value_field", "y_fields", "y",
                       "metric", "metric_field", "measure"}

    for alias in DIMENSION_ALIASES:
        if alias in chart and "dimensions" not in chart:
            val = chart.pop(alias)
            chart["dimensions"] = val if isinstance(val, list) else [val]

    for alias in MEASURE_ALIASES:
        if alias in chart and "measures" not in chart:
            val = chart.pop(alias)
            chart["measures"] = val if isinstance(val, list) else [val]

    # ── 2. 从 config 内部提升字段映射到顶层 ──
    inner = chart.get("config", {})
    if isinstance(inner, dict):
        for key in ("dimensions", "measures"):
            if key in inner and key not in chart:
                chart[key] = inner.pop(key)
        for alias in DIMENSION_ALIASES:
            if alias in inner and "dimensions" not in chart:
                val = inner.pop(alias)
                chart["dimensions"] = val if isinstance(val, list) else [val]
        for alias in MEASURE_ALIASES:
            if alias in inner and "measures" not in chart:
                val = inner.pop(alias)
                chart["measures"] = val if isinstance(val, list) else [val]

    # ── 3. col_span 别名：size.width / width / position 等 ──
    if "col_span" not in chart:
        col_span = (chart.pop("width", None)
                    or (chart.pop("size", {}) or {}).get("width")
                    or (chart.pop("position", {}) or {}).get("col_span"))
        if col_span is not None:
            chart["col_span"] = col_span
    else:
        # position 残留也清理掉
        chart.pop("position", None)

    # ── 3b. 修正非法 col_span 值（DeepSeek 有时传列索引而非栅格宽度）──
    cs = chart.get("col_span")
    if cs is not None and cs not in VALID_COL_SPANS:
        chart_type = chart.get("type", "")
        # 根据图表类型给合理默认值
        DEFAULT_COL_SPANS = {
            "kpi": 3, "gauge": 3,
            "pie": 4, "donut": 4, "rose": 4, "radar": 4, "funnel": 4,
            "table": 12,
            "line": 6, "area": 6, "bar": 6, "combo": 6, "scatter": 6,
            "heatmap": 6, "sunburst": 6, "treemap": 6, "waterfall": 6,
        }
        chart["col_span"] = DEFAULT_COL_SPANS.get(chart_type, 6)

    # 清理无用字段
    for junk in ("id", "description", "layout", "auto_refresh", "responsive",
                 "grid_columns", "color_scheme", "position"):
        chart.pop(junk, None)

    # ── 3c. gauge → kpi 统一为指标卡 ──
    if chart.get("type") == "gauge":
        chart["type"] = "kpi"
        # 保留 unit 作为 KPI 后缀显示
        gauge_cfg = chart.get("config", {}) or {}
        unit = gauge_cfg.pop("unit", None)
        if unit:
            chart.setdefault("config", {})["suffix"] = unit
        # 去掉 gauge 的 max 配置，kpi 不需要
        gauge_cfg.pop("max", None)

    # ── 4. 拆分合并的 KPI 数组 ──
    if chart.get("type") == "kpi" and isinstance(inner, dict):
        kpis = inner.pop("kpis", None)
        if isinstance(kpis, list) and len(kpis) > 0:
            results = []
            for kpi in kpis:
                new_chart = {
                    "type": "kpi",
                    "col_span": chart.get("col_span", 3),
                }
                # 从每个 kpi 条目提取 title/measures
                new_chart["title"] = kpi.get("title") or kpi.get("label", "KPI")
                measure = (kpi.get("measures") or kpi.get("measure")
                           or kpi.get("value_field") or kpi.get("field"))
                if measure:
                    new_chart["measures"] = measure if isinstance(measure, list) else [measure]
                if "data_file" in chart:
                    new_chart["data_file"] = chart["data_file"]
                if "config" in kpi:
                    new_chart["config"] = kpi["config"]
                results.append(new_chart)
            return results

    # ── 5. dashboard_title → title（顶层已处理，这里兜底单图表的 title） ──
    if "title" not in chart:
        chart["title"] = chart.pop("dashboard_title", None) or chart.pop("chart_title", None) or ""

    return [chart]


def normalize_top_level_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """修正顶层配置的常见错误"""
    if not isinstance(config, dict):
        return config
    # dashboard.title / dashboard_title → title
    if "title" not in config:
        dashboard = config.pop("dashboard", None)
        if isinstance(dashboard, dict):
            config["title"] = dashboard.get("title") or dashboard.get("subtitle", "")
        if not config.get("title"):
            config["title"] = config.pop("dashboard_title", None) or config.pop("dashboard_subtitle", "数据分析仪表盘")

    # 展开 charts 并 normalize 每个图表
    charts = config.get("charts", [])
    if isinstance(charts, list):
        normalized = []
        for chart in charts:
            normalized.extend(normalize_chart_config(chart))
        config["charts"] = normalized

    return config


def validate_chart_config(chart: Dict[str, Any], df: pd.DataFrame, idx: int) -> None:
    if not isinstance(chart, dict):
        raise ValueError(f"第 {idx + 1} 个图表配置不是对象")

    chart_type = chart.get("type")
    if chart_type not in SUPPORTED_CHART_TYPES:
        raise ValueError(f"第 {idx + 1} 个图表 type 不支持: {chart_type}")

    # 空 DataFrame（无列）时给出明确错误
    if len(df.columns) == 0 and chart_type != "kpi":
        raise ValueError(f"第 {idx + 1} 个图表 ({chart_type}) 对应的数据为空（无列），无法校验字段")

    dimensions = chart.get("dimensions", []) or []
    measures = chart.get("measures", []) or []

    if chart_type in {"kpi", "gauge"} and len(measures) < 1:
        raise ValueError(f"第 {idx + 1} 个图表 {chart_type} 需要至少 1 个 measure")
    if chart_type in {"line", "bar", "pie", "donut", "combo", "radar", "funnel", "heatmap", "rose", "sunburst", "treemap", "area", "waterfall"}:
        if chart_type not in {"sunburst", "treemap"} and len(dimensions) < 1:
            raise ValueError(f"第 {idx + 1} 个图表 {chart_type} 需要至少 1 个 dimension")
        if len(measures) < 1:
            raise ValueError(f"第 {idx + 1} 个图表 {chart_type} 需要至少 1 个 measure")
    if chart_type == "heatmap" and len(dimensions) < 2:
        raise ValueError(f"第 {idx + 1} 个图表 heatmap 需要 2 个 dimensions")
    if chart_type in {"sunburst", "treemap"} and len(dimensions) < 1:
        raise ValueError(f"第 {idx + 1} 个图表 {chart_type} 需要至少 1 个 dimension")
    if chart_type == "combo" and len(measures) < 2:
        raise ValueError(f"第 {idx + 1} 个图表 combo 需要 2 个 measures")
    if chart_type == "scatter" and len(measures) + len(dimensions) < 2:
        raise ValueError(f"第 {idx + 1} 个图表 scatter 需要至少 2 个数值字段")
    # table 类型：无严格校验，允许无 measures（纯展示）
    # waterfall: 同 bar

    columns_to_check = list(dimensions) + list(measures)
    if chart_type == "table":
        # table 只检查 config.columns 指定的列（如果有）
        table_cols = (chart.get("config") or {}).get("columns")
        if table_cols:
            columns_to_check = table_cols
        else:
            columns_to_check = list(dimensions) + list(measures)
    ensure_columns(df, columns_to_check, chart_type)

    col_span = chart.get("col_span")
    if col_span is not None and col_span not in VALID_COL_SPANS:
        raise ValueError(f"第 {idx + 1} 个图表 col_span 仅支持 {sorted(VALID_COL_SPANS)}")


def base_widget(widget_type: str, title: str, col_class: str) -> Dict[str, Any]:
    return {
        "type": widget_type,
        "title": title,
        "col_class": col_class,
    }


def _maybe_add_datazoom(option: Dict[str, Any], x_data_len: int) -> None:
    """P1: 当 x 轴数据 > 30 时自动添加 dataZoom"""
    if x_data_len > 30:
        option["dataZoom"] = [
            {"type": "inside"},
            {"type": "slider", "bottom": 0},
        ]
        # 调整 grid bottom 给 slider 留空间
        if "grid" in option and isinstance(option["grid"], dict):
            option["grid"]["bottom"] = "12%"


def _maybe_scroll_legend(option: Dict[str, Any], series_count: int) -> None:
    """P1: 当 series > 5 时使用滚动 legend"""
    if series_count > 5 and "legend" in option and isinstance(option.get("legend"), dict):
        option["legend"]["type"] = "scroll"


def _add_tooltip_thousands_formatter(option: Dict[str, Any]) -> None:
    """P1: 为 axis trigger tooltip 添加千分位格式化"""
    tooltip = option.get("tooltip")
    if tooltip and isinstance(tooltip, dict) and tooltip.get("trigger") == "axis":
        # ECharts 内置 formatter 函数实现千分位
        option["_tooltip_formatter"] = True  # 标记，在 JS 中处理


# ── 统一签名: generate_xxx(df, config, theme) ──


def generate_kpi_card(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    measures = config.get("measures", [])
    chart_options = config.get("config", {}) or {}
    measure = measures[0]
    agg = resolve_agg(chart_options, measure, chart_options.get("agg", "sum"))
    title = config.get("title")
    format_str = chart_options.get("format")
    suffix = chart_options.get("suffix", "")
    value = aggregate_series(df[measure], agg)
    formatted = format_number(value, format_str, measure_name=measure)
    if suffix and suffix not in formatted:
        formatted = f"{formatted}{suffix}"
    widget = base_widget("kpi", title or measure, "col-3")
    kpi_mode = _get_style(theme, "kpi_mode", "gradient")
    widget.update({
        "value": formatted,
        "raw_value": round(value, 4),
        "measure": measure,
        "agg": agg,
        "kpi_mode": kpi_mode,
    })
    return widget


def generate_line_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any], is_area: bool = False) -> dict:
    """P2: line 和 area 合并，通过 is_area 参数控制 areaStyle"""
    chart_options = config.get("config", {}) or {}
    x = config["dimensions"][0]
    y = config["measures"]
    title = config.get("title")
    smooth = chart_options.get("smooth", True)
    stack = chart_options.get("stack", False) if is_area else False

    line_width = _get_style(theme, "line_width", 3)
    line_glow = _get_style(theme, "line_glow", False)

    grouped = aggregate_dataframe(df, x, y, chart_options)
    x_data = [normalize_label(v) for v in grouped[x].tolist()]
    series = []
    for i, measure in enumerate(y):
        chart_idx = config.get("_chart_index", 0)
        color = theme["colors"][(chart_idx + i) % len(theme["colors"])]
        line_style: Dict[str, Any] = {"width": line_width if not is_area else max(line_width - 1, 1.5), "color": color}
        if line_glow:
            line_style["shadowColor"] = color
            line_style["shadowBlur"] = 8
            line_style["shadowOffsetY"] = 2
        item: Dict[str, Any] = {
            "name": measure,
            "type": "line",
            "data": grouped[measure].round(4).tolist(),
            "smooth": smooth,
            "lineStyle": line_style,
            "itemStyle": {"borderWidth": 2, "color": color},
        }
        if is_area:
            # 面积图：渐变填充
            if stack:
                item["areaStyle"] = {"opacity": 0.45}
            else:
                item["areaStyle"] = {
                    "opacity": 0.5,
                    "color": {
                        "type": "linear", "x": 0, "y": 0, "x2": 0, "y2": 1,
                        "colorStops": [
                            {"offset": 0, "color": color},
                            {"offset": 1, "color": "transparent"},
                        ],
                    },
                }
            if stack:
                item["stack"] = "total"
        else:
            item["areaStyle"] = {"opacity": 0.08, "color": {
                "type": "linear", "x": 0, "y": 0, "x2": 0, "y2": 1,
                "colorStops": [{"offset": 0, "color": color}, {"offset": 1, "color": "transparent"}],
            }}
        series.append(item)

    chart_type_label = "area" if is_area else "line"
    default_title = f"{y[0]} 面积图" if is_area else f"{y[0]} 趋势"
    widget = base_widget(chart_type_label, title or default_title, "col-6")
    option = {
        "tooltip": {"trigger": "axis"},
        "legend": {"top": 0} if len(y) > 1 else None,
        "grid": {"left": "3%", "right": "4%", "bottom": "3%", "top": "15%" if len(y) > 1 else "10%", "containLabel": True},
        "xAxis": {"type": "category", "data": x_data, "axisLabel": {"rotate": 30 if len(x_data) > 10 else 0}},
        "yAxis": {"type": "value"},
        "series": series,
    }
    if is_area:
        option["xAxis"]["boundaryGap"] = False

    _maybe_add_datazoom(option, len(x_data))
    _maybe_scroll_legend(option, len(y))
    widget["option"] = {k: v for k, v in option.items() if v is not None}
    return widget


def generate_bar_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    x = config["dimensions"][0]
    y = config["measures"]
    title = config.get("title")
    stack = chart_options.get("stack", False)

    # 自动推断：类别超 10 个且未指定 top_n → 自动截取
    if "top_n" not in chart_options and df[x].nunique() > 10:
        chart_options["top_n"] = 10
    # 自动推断：非时间维度默认降序排列
    if "sort_order" not in chart_options and not is_datetime_like(df[x]):
        chart_options["sort_order"] = "desc"

    bar_radius = _get_style(theme, "bar_radius", [4, 4, 0, 0])
    bar_glass = _get_style(theme, "bar_glass", False)

    grouped = aggregate_dataframe(df, x, y, chart_options)

    # 自动推断：维度标签平均长度 > 4 字符时横向显示
    labels_raw = [normalize_label(v) for v in grouped[x].tolist()]
    if "horizontal" not in chart_options:
        avg_len = sum(len(l) for l in labels_raw) / max(len(labels_raw), 1)
        horizontal = avg_len > 4
    else:
        horizontal = chart_options.get("horizontal", False)
    labels = labels_raw
    series = []
    for i, measure in enumerate(y):
        r = bar_radius
        item_style: Dict[str, Any] = {"borderRadius": r if not horizontal else [0, r[1], r[2], 0] if isinstance(r, list) else r}
        # 用 _chart_index 轮转颜色，避免所有单 series 图表同色
        chart_idx = config.get("_chart_index", 0)
        color_offset = (chart_idx + i) % len(theme["colors"])
        color = theme["colors"][color_offset]
        if len(y) == 1:
            # 用颜色对轮转：每个图表用不同的主色
            next_color = theme["colors"][(color_offset + 1) % len(theme["colors"])]
            item_style["color"] = {
                "type": "linear",
                "x": 0,
                "y": 0,
                "x2": 0 if not horizontal else 1,
                "y2": 1 if not horizontal else 0,
                "colorStops": [
                    {"offset": 0, "color": color},
                    {"offset": 1, "color": next_color},
                ],
            }
        else:
            item_style["color"] = color
        if bar_glass:
            # 玻璃拟态：半透明 + 顶部高光
            item_style["opacity"] = 0.85
            item_style["borderColor"] = "rgba(255,255,255,0.2)"
            item_style["borderWidth"] = 1
        series_item: Dict[str, Any] = {"name": measure, "type": "bar", "data": grouped[measure].round(4).tolist(), "itemStyle": item_style}
        if bar_glass:
            series_item["emphasis"] = {"itemStyle": {"opacity": 1, "shadowBlur": 12, "shadowColor": color}}
        if stack:
            series_item["stack"] = "total"
        series.append(series_item)

    option = {
        "tooltip": {"trigger": "axis"},
        "legend": {"top": 0} if len(y) > 1 else None,
        "grid": {"left": "3%", "right": "4%", "bottom": "3%", "top": "15%" if len(y) > 1 else "10%", "containLabel": True},
        "series": series,
    }
    if horizontal:
        option["xAxis"] = {"type": "value"}
        option["yAxis"] = {"type": "category", "data": labels}
    else:
        option["xAxis"] = {"type": "category", "data": labels, "axisLabel": {"rotate": 30 if len(labels) > 8 else 0}}
        option["yAxis"] = {"type": "value"}

    _maybe_add_datazoom(option, len(labels))
    _maybe_scroll_legend(option, len(y))
    widget = base_widget("bar", title or f"{x} {y[0]} 对比", "col-6")
    widget["option"] = {k: v for k, v in option.items() if v is not None}
    return widget


def generate_pie_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any], donut: bool = True) -> dict:
    chart_options = config.get("config", {}) or {}
    dimension = config["dimensions"][0]
    measure = config["measures"][0]
    title = config.get("title")

    # 自动推断：类别超 10 个且未指定 top_n → 自动截取
    if "top_n" not in chart_options and df[dimension].nunique() > 10:
        chart_options["top_n"] = 10

    pie_inner = _get_style(theme, "pie_inner", "40%")
    pie_outer = _get_style(theme, "pie_outer", "70%")
    pie_gap = _get_style(theme, "pie_gap", 2)
    line_glow = _get_style(theme, "line_glow", False)

    grouped = aggregate_dataframe(df, dimension, [measure], chart_options)
    data = [{"name": normalize_label(row[dimension]), "value": round(float(row[measure]), 4)} for _, row in grouped.iterrows()]
    widget = base_widget("pie", title or f"{dimension} {measure} 占比", "col-4")

    emphasis: Dict[str, Any] = {"itemStyle": {"shadowBlur": 10, "shadowOffsetX": 0, "shadowColor": "rgba(0, 0, 0, 0.5)"}}
    if line_glow:
        emphasis["itemStyle"]["shadowBlur"] = 20
        emphasis["itemStyle"]["shadowColor"] = theme["primary"]
        emphasis["scale"] = True
        emphasis["scaleSize"] = 8

    pie_series: Dict[str, Any] = {
        "type": "pie",
        "radius": [pie_inner, pie_outer] if donut else pie_outer,
        "center": ["50%", "55%"],
        "data": data,
        "emphasis": emphasis,
        "label": {"formatter": "{b}\n{d}%", "color": theme["text"]},
        "itemStyle": {"borderRadius": pie_gap * 2, "borderColor": theme["card"], "borderWidth": pie_gap},
    }
    widget["option"] = {
        "tooltip": {"trigger": "item", "formatter": "{b}: {c} ({d}%)"},
        "series": [pie_series],
    }
    return widget


def generate_combo_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    x = config["dimensions"][0]
    y_bar = config["measures"][0]
    y_line = config["measures"][1]
    title = config.get("title")

    grouped = aggregate_dataframe(df, x, [y_bar, y_line], chart_options)
    x_data = [normalize_label(v) for v in grouped[x].tolist()]
    widget = base_widget("combo", title or f"{y_bar} & {y_line} 趋势", "col-6")
    option = {
        "tooltip": {"trigger": "axis"},
        "legend": {"top": 0},
        "grid": {"left": "3%", "right": "8%", "bottom": "3%", "top": "15%", "containLabel": True},
        "xAxis": {"type": "category", "data": x_data},
        "yAxis": [{"type": "value", "name": y_bar}, {"type": "value", "name": y_line}],
        "series": [
            {"name": y_bar, "type": "bar", "data": grouped[y_bar].round(4).tolist(), "yAxisIndex": 0,
             "itemStyle": {"color": {"type": "linear", "x": 0, "y": 0, "x2": 0, "y2": 1,
                                     "colorStops": [{"offset": 0, "color": theme["primary"]}, {"offset": 1, "color": theme["secondary"]}]},
                           "borderRadius": _get_style(theme, "bar_radius", [4, 4, 0, 0])}},
            {"name": y_line, "type": "line", "data": grouped[y_line].round(4).tolist(), "smooth": True, "yAxisIndex": 1,
             "lineStyle": {"width": _get_style(theme, "line_width", 2.5), "color": theme["colors"][1]},
             "itemStyle": {"color": theme["colors"][1]}},
        ],
    }
    _maybe_add_datazoom(option, len(x_data))
    widget["option"] = option
    return widget


def generate_scatter_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    dimensions = config.get("dimensions", [])
    measures = config.get("measures", [])
    x = dimensions[0] if dimensions else measures[0]
    y = measures[0] if dimensions else measures[1]
    size = chart_options.get("size") or (measures[1] if dimensions and len(measures) > 1 else None)
    title = config.get("title")

    ensure_columns(df, [x, y] + ([size] if size else []), "scatter")
    cols = [x, y] + ([size] if size else [])
    plot_df = df[cols].dropna().copy()

    # P2: iterrows() 改为 .values.tolist() 提升性能
    if size:
        raw = plot_df[[x, y, size]].values.tolist()
        min_size = float(plot_df[size].min())
        max_size = float(plot_df[size].max())
        span = max(max_size - min_size, 1)
        data = []
        for row in raw:
            scaled = 10 + ((row[2] - min_size) / span) * 20
            data.append({"value": [float(row[0]), float(row[1]), float(row[2])], "symbolSize": round(scaled, 2)})
    else:
        data = [[float(r[0]), float(r[1])] for r in plot_df[[x, y]].values.tolist()]

    widget = base_widget("scatter", title or f"{x} vs {y}", "col-6")
    series_item: Dict[str, Any] = {"type": "scatter", "data": data,
                     "itemStyle": {"color": theme["primary"], "opacity": 0.75,
                                   "borderColor": theme["secondary"], "borderWidth": 1}}
    if _get_style(theme, "line_glow", False):
        series_item["itemStyle"]["shadowBlur"] = 6
        series_item["itemStyle"]["shadowColor"] = theme["primary"]
    if not size:
        series_item["symbolSize"] = 10
    widget["option"] = {
        "tooltip": {"trigger": "item", "formatter": f"{escape_text(x)}: {{c[0]}}<br/>{escape_text(y)}: {{c[1]}}"},
        "xAxis": {"type": "value", "name": x},
        "yAxis": {"type": "value", "name": y},
        "series": [series_item],
    }
    return widget


def generate_radar_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    dimension = config["dimensions"][0]
    measures = config["measures"]
    title = config.get("title")

    categories = df[dimension].dropna().unique().tolist()[: chart_options.get("series_limit", 10)]
    indicator = []
    for measure in measures:
        max_val = float(df[measure].max()) if not df[measure].dropna().empty else 0
        indicator.append({"name": measure, "max": max(max_val * 1.2, 1)})
    series_data = []
    for cat in categories:
        cat_df = df[df[dimension] == cat]
        values = [round(aggregate_series(cat_df[m], resolve_agg(chart_options, m, "mean")), 4) for m in measures]
        series_data.append({"name": normalize_label(cat), "value": values})
    widget = base_widget("radar", title or f"{dimension} 综合评估", "col-4")
    option = {
        "tooltip": {"trigger": "item"},
        "legend": {"top": 0, "data": [item["name"] for item in series_data]},
        "radar": {"indicator": indicator, "center": ["50%", "55%"], "radius": "65%",
                  "axisName": {"color": theme["text_secondary"]},
                  "splitArea": {"areaStyle": {"color": ["transparent"]}}},
        "series": [{"type": "radar", "data": series_data, "areaStyle": {"opacity": 0.15 if _get_style(theme, "line_glow", False) else 0.2},
                    "lineStyle": {"width": 2}}],
    }
    _maybe_scroll_legend(option, len(series_data))
    widget["option"] = option
    return widget


def generate_funnel_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    dimension = config["dimensions"][0]
    measure = config["measures"][0]
    title = config.get("title")

    grouped = aggregate_dataframe(df, dimension, [measure], {**chart_options, "sort_order": "desc"})
    data = [{"name": normalize_label(row[dimension]), "value": round(float(row[measure]), 4)} for _, row in grouped.iterrows()]
    max_value = max((item["value"] for item in data), default=100)
    widget = base_widget("funnel", title or f"{dimension} 转化漏斗", "col-4")
    widget["option"] = {
        "tooltip": {"trigger": "item", "formatter": "{b}: {c} ({d}%)"},
        "series": [{
            "type": "funnel",
            "left": "10%",
            "top": "10%",
            "bottom": "10%",
            "width": "80%",
            "min": 0,
            "max": max_value,
            "minSize": "0%",
            "maxSize": "100%",
            "sort": "descending",
            "gap": 2,
            "label": {"show": True, "position": "inside", "formatter": "{b}", "color": "#fff"},
            "labelLine": {"show": False},
            "itemStyle": {"borderColor": theme["card"], "borderWidth": 1},
            "data": data,
        }],
    }
    return widget


def generate_gauge_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    measure = config["measures"][0]
    title = config.get("title")
    max_val = chart_options.get("max", 100)
    unit = chart_options.get("unit", "")

    gauge_pointer_color = _get_style(theme, "gauge_pointer_color", None)
    line_glow = _get_style(theme, "line_glow", False)

    agg = resolve_agg(chart_options, measure, "mean")
    value = aggregate_series(df[measure], agg)
    ratio = (value / max_val) if max_val else 0
    # 使用主题色系判断 gauge 颜色
    if gauge_pointer_color:
        color = gauge_pointer_color
    elif ratio < 0.3:
        color = theme["colors"][7] if len(theme["colors"]) > 7 else "#f5576c"
    elif ratio < 0.7:
        color = theme["colors"][0]
    else:
        color = theme["colors"][2] if len(theme["colors"]) > 2 else "#43e97b"

    pointer_style: Dict[str, Any] = {"show": True, "length": "60%", "width": 6}
    if line_glow and gauge_pointer_color:
        pointer_style["itemStyle"] = {"color": gauge_pointer_color, "shadowColor": gauge_pointer_color, "shadowBlur": 10}

    # 使用主题色做进度条渐变
    axis_line_colors = [[0.3, theme["colors"][7] if len(theme["colors"]) > 7 else "#f5576c"],
                        [0.7, theme["colors"][0]],
                        [1, theme["colors"][2] if len(theme["colors"]) > 2 else "#43e97b"]]

    widget = base_widget("gauge", title or f"{measure} 仪表盘", "col-3")
    widget["option"] = {
        "tooltip": {"formatter": "{b}: {c}" + unit},
        "series": [{
            "type": "gauge",
            "center": ["50%", "60%"],
            "radius": "80%",
            "startAngle": 200,
            "endAngle": -20,
            "min": 0,
            "max": max_val,
            "progress": {"show": True, "width": 18},
            "axisLine": {"lineStyle": {"width": 18, "color": axis_line_colors}},
            "pointer": pointer_style,
            "axisTick": {"show": False},
            "splitLine": {"show": False},
            "axisLabel": {"show": True, "distance": 25, "fontSize": 10, "color": theme["text_secondary"]},
            "detail": {"valueAnimation": True, "formatter": "{value}" + unit, "fontSize": 24, "offsetCenter": [0, "70%"], "color": color},
            "data": [{"value": round(value, 2), "name": title or measure}],
            "title": {"offsetCenter": [0, "90%"], "color": theme["text_secondary"]},
        }],
    }
    return widget


def generate_heatmap_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    x = config["dimensions"][0]
    y = config["dimensions"][1]
    measure = config["measures"][0]
    title = config.get("title")

    agg = resolve_agg(chart_options, measure, "sum")
    pivot = df.pivot_table(values=measure, index=y, columns=x, aggfunc=agg, fill_value=0)
    x_data = [normalize_label(c) for c in pivot.columns.tolist()]
    y_data = [normalize_label(i) for i in pivot.index.tolist()]
    data = []
    for i, row_name in enumerate(pivot.index):
        for j, col_name in enumerate(pivot.columns):
            data.append([j, i, round(float(pivot.loc[row_name, col_name]), 4)])
    values = [d[2] for d in data]
    widget = base_widget("heatmap", title or f"{x} × {y} 热力图", "col-6")
    widget["option"] = {
        "tooltip": {"position": "top"},
        "grid": {"left": "3%", "right": "8%", "bottom": "15%", "top": "10%", "containLabel": True},
        "xAxis": {"type": "category", "data": x_data, "splitArea": {"show": True}, "axisLabel": {"rotate": 30 if len(x_data) > 8 else 0}},
        "yAxis": {"type": "category", "data": y_data, "splitArea": {"show": True}},
        "visualMap": {"min": min(values) if values else 0, "max": max(values) if values else 100, "calculable": True, "orient": "horizontal", "left": "center", "bottom": "0%", "inRange": {"color": _get_style(theme, "heatmap_colors", ["#f8fafc", "#667eea", "#764ba2"])}, "textStyle": {"color": theme["text_secondary"]}},
        "series": [{"type": "heatmap", "data": data, "label": {"show": len(x_data) * len(y_data) <= 50}, "emphasis": {"itemStyle": {"shadowBlur": 10, "shadowColor": "rgba(0, 0, 0, 0.5)"}}}],
    }
    return widget


def generate_rose_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    dimension = config["dimensions"][0]
    measure = config["measures"][0]
    title = config.get("title")

    grouped = aggregate_dataframe(df, dimension, [measure], chart_options)
    data = [{"name": normalize_label(row[dimension]), "value": round(float(row[measure]), 4)} for _, row in grouped.iterrows()]
    widget = base_widget("rose", title or f"{dimension} 玫瑰图", "col-4")
    widget["option"] = {
        "tooltip": {"trigger": "item", "formatter": "{b}: {c} ({d}%)"},
        "series": [{"type": "pie", "radius": ["20%", "70%"], "center": ["50%", "55%"], "roseType": "area", "itemStyle": {"borderRadius": 5}, "data": data, "label": {"formatter": "{b}\n{d}%"}}],
    }
    return widget


def generate_sunburst_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    dimensions = config["dimensions"]
    measure = config["measures"][0]
    title = config.get("title")

    data = build_tree_data(df, dimensions, measure, chart_options)
    widget = base_widget("sunburst", title or "层级占比分析", "col-6")
    widget["option"] = {
        "tooltip": {"trigger": "item"},
        "series": [{"type": "sunburst", "data": data, "radius": ["10%", "90%"], "label": {"rotate": "radial"}, "emphasis": {"focus": "ancestor"}}],
    }
    return widget


def generate_treemap_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    chart_options = config.get("config", {}) or {}
    dimensions = config["dimensions"]
    measure = config["measures"][0]
    title = config.get("title")

    data = build_tree_data(df, dimensions, measure, chart_options)
    widget = base_widget("treemap", title or "矩形树图", "col-6")
    widget["option"] = {
        "tooltip": {"trigger": "item", "formatter": "{b}: {c}"},
        "series": [{"type": "treemap", "data": data, "roam": False, "nodeClick": False, "breadcrumb": {"show": True}, "label": {"show": True, "formatter": "{b}"}, "levels": [{"itemStyle": {"borderColor": "#fff", "borderWidth": 2, "gapWidth": 2}}, {"itemStyle": {"borderColor": "#fff", "borderWidth": 1, "gapWidth": 1}}]}],
    }
    return widget


def generate_table(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    """P1 新增: HTML 数据表格，支持 columns/sort_by/max_rows 参数"""
    chart_options = config.get("config", {}) or {}
    title = config.get("title") or "数据表格"
    dimensions = config.get("dimensions", []) or []
    measures = config.get("measures", []) or []

    # 确定展示列
    columns = chart_options.get("columns") or (dimensions + measures) or list(df.columns)
    sort_by = chart_options.get("sort_by")
    sort_order = chart_options.get("sort_order", "desc")
    max_rows = chart_options.get("max_rows", 100)

    table_df = df[columns].copy()
    if sort_by and sort_by in table_df.columns:
        table_df = table_df.sort_values(sort_by, ascending=(sort_order == "asc"))
    table_df = table_df.head(max_rows)

    # 构建 HTML 表格
    header_cells = "".join(f"<th>{escape_text(col)}</th>" for col in columns)
    rows_html = []
    for i, (_, row) in enumerate(table_df.iterrows()):
        cls = ' class="zebra"' if i % 2 == 1 else ""
        cells = "".join(f"<td>{escape_text(row[col])}</td>" for col in columns)
        rows_html.append(f"<tr{cls}>{cells}</tr>")

    table_html = (
        f'<table class="data-table">'
        f'<thead><tr>{header_cells}</tr></thead>'
        f'<tbody>{"".join(rows_html)}</tbody>'
        f'</table>'
    )

    widget = base_widget("table", title, "col-12")
    widget["table_html"] = table_html
    widget["row_count"] = len(table_df)
    return widget


def generate_waterfall_chart(df: pd.DataFrame, config: Dict[str, Any], theme: Dict[str, Any]) -> dict:
    """P1 新增: 瀑布图，使用 ECharts stacked bar 模式（透明底座 + 正值绿色 + 负值红色）"""
    chart_options = config.get("config", {}) or {}
    x = config["dimensions"][0]
    measure = config["measures"][0]
    title = config.get("title") or f"{measure} 瀑布图"

    grouped = aggregate_dataframe(df, x, [measure], chart_options)
    labels = [normalize_label(v) for v in grouped[x].tolist()]
    values = grouped[measure].round(4).tolist()

    # 计算瀑布图底座和增量
    base_data = []   # 透明底座
    pos_data = []    # 正值（绿色）
    neg_data = []    # 负值（红色）
    cumulative = 0

    for val in values:
        if val >= 0:
            base_data.append(round(cumulative, 4))
            pos_data.append(round(val, 4))
            neg_data.append(0)
        else:
            base_data.append(round(cumulative + val, 4))
            pos_data.append(0)
            neg_data.append(round(abs(val), 4))
        cumulative += val

    widget = base_widget("waterfall", title, "col-6")
    option = {
        "tooltip": {
            "trigger": "axis",
            "axisPointer": {"type": "shadow"},
        },
        "legend": {"data": ["增加", "减少"]},
        "grid": {"left": "3%", "right": "4%", "bottom": "3%", "top": "15%", "containLabel": True},
        "xAxis": {"type": "category", "data": labels, "axisLabel": {"rotate": 30 if len(labels) > 8 else 0}},
        "yAxis": {"type": "value"},
        "series": [
            {
                "name": "底座",
                "type": "bar",
                "stack": "waterfall",
                "itemStyle": {"borderColor": "transparent", "color": "transparent"},
                "emphasis": {"itemStyle": {"borderColor": "transparent", "color": "transparent"}},
                "data": base_data,
            },
            {
                "name": "增加",
                "type": "bar",
                "stack": "waterfall",
                "itemStyle": {"color": "#43e97b", "borderRadius": [4, 4, 0, 0]},
                "data": pos_data,
            },
            {
                "name": "减少",
                "type": "bar",
                "stack": "waterfall",
                "itemStyle": {"color": "#f5576c", "borderRadius": [4, 4, 0, 0]},
                "data": neg_data,
            },
        ],
    }
    _maybe_add_datazoom(option, len(labels))
    widget["option"] = option
    return widget


def build_tree_data(df: pd.DataFrame, dimensions: List[str], measure: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not dimensions:
        return []
    dim = dimensions[0]
    grouped = aggregate_dataframe(df, dim, [measure], {**config, "top_n": config.get("top_n")})
    nodes = []
    for _, row in grouped.iterrows():
        node_name = normalize_label(row[dim])
        child_df = df[df[dim] == row[dim]]
        node: Dict[str, Any] = {"name": node_name}
        if len(dimensions) > 1:
            children = build_tree_data(child_df, dimensions[1:], measure, config)
            if children:
                node["children"] = children
        else:
            node["value"] = round(float(row[measure]), 4)
        nodes.append(node)
    return nodes


# ── P2: 注册表模式替代 if/elif 链 ──

CHART_GENERATORS: Dict[str, Any] = {
    "kpi": generate_kpi_card,
    "line": generate_line_chart,
    "bar": generate_bar_chart,
    "pie": lambda df, config, theme: generate_pie_chart(df, config, theme, donut=(config.get("config") or {}).get("donut", True)),
    "donut": lambda df, config, theme: generate_pie_chart(df, config, theme, donut=True),
    "combo": generate_combo_chart,
    "scatter": generate_scatter_chart,
    "radar": generate_radar_chart,
    "funnel": generate_funnel_chart,
    "gauge": generate_gauge_chart,
    "heatmap": generate_heatmap_chart,
    "rose": generate_rose_chart,
    "sunburst": generate_sunburst_chart,
    "treemap": generate_treemap_chart,
    "area": lambda df, config, theme: generate_line_chart(df, config, theme, is_area=True),
    "table": generate_table,
    "waterfall": generate_waterfall_chart,
}


def _compute_chart_height(chart_type: str, col_class: str) -> int:
    """P2: 动态图表高度"""
    if chart_type in {"kpi", "gauge"}:
        return 200
    if col_class in {"col-3", "col-4"}:
        return 280
    if col_class == "col-6":
        return 350
    if col_class == "col-12":
        if chart_type in {"heatmap", "table"}:
            return 450
        return 400
    return 300


HTML_TEMPLATE = '''<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js" onerror="var s=document.createElement('script');s.src='echarts.min.js';document.head.appendChild(s);"></script>
    <style>
        :root {{
            --primary: {primary};
            --secondary: {secondary};
            --bg: {bg};
            --card: {card};
            --text: {text};
            --text-secondary: {text_secondary};
            --border: {border};
            --shadow: {shadow};
            --card-border: {card_border};
            --meta-bg: {meta_bg};
            --zebra-bg: {zebra_bg};
            --hover-bg: {hover_bg};
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }}
        .navbar {{ background: {gradient}; color: white; padding: 1rem 2rem; position: sticky; top: 0; z-index: 100; box-shadow: var(--shadow); }}
        .navbar h1 {{ font-size: 1.5rem; font-weight: 600; }}
        .navbar .subtitle {{ font-size: 0.875rem; opacity: 0.84; margin-top: 0.25rem; }}
        .dashboard {{ max-width: 1400px; margin: 0 auto; padding: 1.5rem; }}
        .meta {{ display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; color: var(--text-secondary); font-size: 0.875rem; }}
        .meta-item {{ background: var(--meta-bg); border: 1px solid var(--border); border-radius: 999px; padding: 0.4rem 0.75rem; }}
        .grid {{ display: grid; grid-template-columns: repeat(12, 1fr); gap: 1rem; }}
        .widget {{ background: var(--card); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; transition: transform 0.2s, box-shadow 0.2s; border: var(--card-border); }}
        .widget:hover {{ transform: translateY(-2px); }}
        .widget-header {{ padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); }}
        .widget-header h3 {{ font-size: 0.95rem; font-weight: 600; color: var(--text); }}
        .widget-body {{ padding: 1rem; }}
        /* KPI 模式: gradient（默认渐变背景白字） */
        .kpi-card.kpi-gradient {{ background: {gradient}; color: white; padding: 1.5rem; text-align: center; min-height: 100px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; }}
        .kpi-gradient .kpi-title {{ font-size: 0.875rem; opacity: 0.9; margin-bottom: 0.5rem; }}
        .kpi-gradient .kpi-value {{ font-size: 2rem; font-weight: 700; line-height: 1.2; }}
        .kpi-gradient .kpi-subtitle {{ font-size: 0.75rem; opacity: 0.74; margin-top: 0.5rem; }}
        /* KPI 模式: glow_border（暗色发光描边） */
        .kpi-card.kpi-glow_border {{ background: var(--card); color: var(--text); padding: 1.5rem; text-align: center; border: 1px solid var(--primary); box-shadow: 0 0 16px rgba(0,212,255,0.15), inset 0 0 16px rgba(0,212,255,0.03); min-height: 100px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; }}
        .kpi-glow_border .kpi-title {{ font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem; }}
        .kpi-glow_border .kpi-value {{ font-size: 2rem; font-weight: 700; line-height: 1.2; background: linear-gradient(135deg, var(--primary), var(--secondary)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }}
        .kpi-glow_border .kpi-subtitle {{ font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; }}
        /* KPI 模式: accent_bar（白底 + 底部彩色条） */
        .kpi-card.kpi-accent_bar {{ background: var(--card); color: var(--text); padding: 1.5rem; text-align: center; border-bottom: 3px solid var(--primary); min-height: 100px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; }}
        .kpi-accent_bar .kpi-title {{ font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem; }}
        .kpi-accent_bar .kpi-value {{ font-size: 2rem; font-weight: 700; line-height: 1.2; color: var(--primary); }}
        .kpi-accent_bar .kpi-subtitle {{ font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; }}
        /* KPI 模式: left_stripe（白底 + 左侧竖条） */
        .kpi-card.kpi-left_stripe {{ background: var(--card); color: var(--text); padding: 1.5rem 1.5rem 1.5rem 2rem; text-align: left; border-left: 4px solid var(--primary); min-height: 100px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; }}
        .kpi-left_stripe .kpi-title {{ font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }}
        .kpi-left_stripe .kpi-value {{ font-size: 2rem; font-weight: 700; line-height: 1.2; color: var(--text); }}
        .kpi-left_stripe .kpi-subtitle {{ font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; }}
        .col-3 {{ grid-column: span 3; }}
        .col-4 {{ grid-column: span 4; }}
        .col-6 {{ grid-column: span 6; }}
        .col-8 {{ grid-column: span 8; }}
        .col-12 {{ grid-column: span 12; }}
        @media (max-width: 1024px) {{ .col-3, .col-4 {{ grid-column: span 6; }} .col-6, .col-8 {{ grid-column: span 12; }} }}
        @media (max-width: 640px) {{ .col-3, .col-4, .col-6, .col-8 {{ grid-column: span 12; }} .dashboard {{ padding: 1rem; }} .navbar {{ padding: 1rem 1.25rem; }} }}
        .footer {{ text-align: center; padding: 2rem; color: var(--text-secondary); font-size: 0.875rem; }}
        .data-table {{ width: 100%; border-collapse: collapse; font-size: 0.875rem; }}
        .data-table th {{ background: var(--bg); color: var(--text); font-weight: 600; text-align: left; padding: 0.6rem 0.75rem; border-bottom: 2px solid var(--border); position: sticky; top: 0; }}
        .data-table td {{ padding: 0.5rem 0.75rem; border-bottom: 1px solid var(--border); }}
        .data-table tr.zebra {{ background: var(--zebra-bg); }}
        .data-table tr:hover {{ background: var(--hover-bg); }}
        .table-scroll {{ max-height: 400px; overflow-y: auto; }}
    </style>
</head>
<body>
    <nav class="navbar">
        <h1>{title}</h1>
        <div class="subtitle">📊 智能数据分析 · {row_count:,} 条数据 · {chart_count} 个图表</div>
    </nav>
    <main class="dashboard">
        <div class="meta">
            <div class="meta-item">主题：{theme_name}</div>
            <div class="meta-item">生成时间：{date}</div>
            <div class="meta-item">数据量：{row_count:,} 行</div>
        </div>
        <div class="grid">{widgets_html}</div>
    </main>
    <footer class="footer">由 ECharts BI 智能分析工具生成 · 建议与分析口径一并归档</footer>
    <script>
        var defined = typeof echarts !== 'undefined';
        function _fmt(v) {{ if (v == null) return '-'; return typeof v === 'number' ? v.toLocaleString() : v; }}
        const widgets = {widgets_json};
        const charts = [];
        function initCharts() {{
            if (typeof echarts === 'undefined') {{ setTimeout(initCharts, 200); return; }}
            widgets.forEach((widget, index) => {{
                if (!widget.option) return;
                const chartDom = document.getElementById('chart_' + (index + 1));
                if (!chartDom) return;
                const chart = echarts.init(chartDom);
                var opt = widget.option;
                // P1: tooltip 千分位格式化
                if (opt.tooltip && opt.tooltip.trigger === 'axis' && !opt.tooltip.formatter) {{
                    opt.tooltip.formatter = function(params) {{
                        var lines = [params[0].axisValueLabel];
                        params.forEach(function(p) {{
                            var v = Array.isArray(p.value) ? p.value[p.seriesIndex+1] : p.value;
                            lines.push(p.marker + ' ' + p.seriesName + ': ' + _fmt(v));
                        }});
                        return lines.join('<br/>');
                    }};
                }}
                chart.setOption(opt);
                charts.push(chart);
            }});
            window.addEventListener('resize', () => charts.forEach((chart) => chart.resize()));
        }}
        document.addEventListener('DOMContentLoaded', initCharts);
    </script>
</body>
</html>'''


def render_widget_html(widget: dict, index: int) -> str:
    col_class = escape_text(widget.get("col_class", "col-6"))
    title = escape_text(widget.get("title", ""))
    chart_type = widget.get("type", "")
    height = _compute_chart_height(chart_type, col_class)

    if widget["type"] == "kpi":
        value = escape_text(widget.get("value", "-"))
        measure = escape_text(widget.get("measure", ""))
        kpi_mode = escape_text(widget.get("kpi_mode", "gradient"))
        return (
            f'<div class="widget {col_class}">'
            f'<div class="kpi-card kpi-{kpi_mode}"><div class="kpi-title">{title}</div>'
            f'<div class="kpi-value">{value}</div></div></div>'
        )
    if widget["type"] == "table":
        table_html = widget.get("table_html", "")
        return (
            f'<div class="widget {col_class}">'
            f'<div class="widget-header"><h3>{title}</h3></div>'
            f'<div class="widget-body"><div class="table-scroll" style="max-height:{height}px">{table_html}</div></div></div>'
        )
    return (
        f'<div class="widget {col_class}">'
        f'<div class="widget-header"><h3>{title}</h3></div>'
        f'<div class="widget-body"><div id="chart_{index + 1}" class="chart-container" style="height:{height}px"></div></div></div>'
    )


def _col_span_from_class(col_class: str) -> int:
    """从 col_class 提取数值，如 'col-8' → 8"""
    try:
        return int(col_class.split("-")[1])
    except (IndexError, ValueError):
        return 6


# 图表类型 → 理想栅格宽度
AUTO_COL_SPAN: Dict[str, int] = {
    "kpi": 3,
    "line": 8, "area": 8,
    "bar": 6, "pie": 6, "donut": 6, "rose": 6,
    "combo": 8, "scatter": 6, "waterfall": 6,
    "heatmap": 6, "sunburst": 6, "treemap": 6,
    "radar": 4, "funnel": 4,
    "table": 12,
}


def _fill_rows(widgets: List[dict]) -> None:
    """
    智能自动布局引擎（分类打包 + 保持原始顺序）：

    布局规则：
    1. KPI 行：col-3，每行 4 个；不满 4 个时均分 12
    2. 大图 (line/area/combo, ideal=8) 配对：大图占 8，伙伴压缩到 4，组成 8+4=12
    3. 中图 (bar/pie/donut 等, ideal=6) 两两配对：6+6=12
    4. 小图 (radar/funnel, ideal=4)：三个一行 4+4+4，或与其他配对
    5. table：独占 col-12
    6. 落单：拉满 col-12

    算法：双指针扫描，保持图表原始顺序。
    """
    # 步骤 1：按类型分配理想 col_span
    for w in widgets:
        ideal = AUTO_COL_SPAN.get(w.get("type", ""), 6)
        w["col_class"] = f"col-{ideal}"

    # 步骤 2：分离 KPI 和非 KPI，分别处理
    # 收集连续的 KPI 段和非 KPI 段，保持原始顺序
    segments: List[tuple] = []  # ("kpi", [widgets]) or ("chart", [widgets])
    i = 0
    while i < len(widgets):
        w = widgets[i]
        wtype = w.get("type", "")
        if wtype == "kpi":
            # 收集连续 KPI
            kpi_group: List[dict] = []
            while i < len(widgets) and widgets[i].get("type", "") == "kpi":
                kpi_group.append(widgets[i])
                i += 1
            segments.append(("kpi", kpi_group))
        else:
            # 收集连续非 KPI
            chart_group: List[dict] = []
            while i < len(widgets) and widgets[i].get("type", "") != "kpi":
                chart_group.append(widgets[i])
                i += 1
            segments.append(("chart", chart_group))

    # 步骤 3：处理每个段
    for seg_type, seg_widgets in segments:
        if seg_type == "kpi":
            _layout_kpis(seg_widgets)
        else:
            _layout_charts(seg_widgets)


def _layout_kpis(kpis: List[dict]) -> None:
    """KPI 布局：每 4 个一行 col-3，不满 4 个时均分 12"""
    i = 0
    while i < len(kpis):
        row = kpis[i:i + 4]
        if len(row) == 4:
            for w in row:
                w["col_class"] = "col-3"
        else:
            per = 12 // len(row)
            for w in row:
                w["col_class"] = f"col-{per}"
        i += 4


def _ideal_span(w: dict) -> int:
    """获取 widget 的理想 col_span"""
    return AUTO_COL_SPAN.get(w.get("type", ""), 6)


def _size_class(w: dict) -> str:
    """
    将 widget 按理想 span 分类：
    - big: 8 (line, area, combo)
    - table: 12
    - small: 4 (radar, funnel)
    - mid: 6 (bar, pie, donut, etc.)
    """
    ideal = _ideal_span(w)
    if ideal >= 12:
        return "table"
    if ideal >= 8:
        return "big"
    if ideal <= 4:
        return "small"
    return "mid"


def _layout_charts(charts: List[dict]) -> None:
    """
    非 KPI 图表布局：双指针扫描，保持原始顺序。

    扫描规则：
    - table → 独占 col-12
    - big(8) → 向后找一个非 big/table 伙伴，组成 8+4=12
    - mid(6) → 向后看：
        - 下一个是 mid → 6+6=12
        - 下一个是 big → 当前 mid 压缩到 4，big 占 8，组成 4+8=12
        - 下一个是 small → 6+6=12（small 拉伸到 6）
        - 否则独占 12
    - small(4) → 向后看：
        - 连续 3 个 small → 4+4+4=12
        - 2 个 small → 6+6=12（均拉伸）
        - 下一个是 mid → 4+8=12（mid 拉伸到 8）或 6+6
        - 下一个是 big → 4+8=12
        - 否则独占 12
    """
    i = 0
    n = len(charts)
    while i < n:
        w = charts[i]
        sc = _size_class(w)

        if sc == "table":
            w["col_class"] = "col-12"
            i += 1
            continue

        if sc == "big":
            # 大图(8)：向后找一个非 big/table 伙伴
            if i + 1 < n and _size_class(charts[i + 1]) not in ("big", "table"):
                w["col_class"] = "col-8"
                charts[i + 1]["col_class"] = "col-4"
                i += 2
            elif i + 1 < n and _size_class(charts[i + 1]) == "big":
                # 两个大图：各占 6
                w["col_class"] = "col-6"
                charts[i + 1]["col_class"] = "col-6"
                i += 2
            else:
                # 落单或后面是 table
                w["col_class"] = "col-12"
                i += 1
            continue

        if sc == "mid":
            if i + 1 < n:
                next_sc = _size_class(charts[i + 1])
                if next_sc == "mid":
                    # 两个中图：6+6
                    w["col_class"] = "col-6"
                    charts[i + 1]["col_class"] = "col-6"
                    i += 2
                elif next_sc == "big":
                    # 中图 + 大图：4+8
                    w["col_class"] = "col-4"
                    charts[i + 1]["col_class"] = "col-8"
                    i += 2
                elif next_sc == "small":
                    # 中图 + 小图：6+6（小图拉伸）
                    w["col_class"] = "col-6"
                    charts[i + 1]["col_class"] = "col-6"
                    i += 2
                else:
                    # 下一个是 table，mid 独占
                    w["col_class"] = "col-12"
                    i += 1
            else:
                w["col_class"] = "col-12"
                i += 1
            continue

        if sc == "small":
            # 看后面有几个连续 small
            j = i + 1
            while j < n and _size_class(charts[j]) == "small" and j - i < 3:
                j += 1
            small_count = j - i
            if small_count >= 3:
                # 3 个小图：4+4+4
                charts[i]["col_class"] = "col-4"
                charts[i + 1]["col_class"] = "col-4"
                charts[i + 2]["col_class"] = "col-4"
                i += 3
            elif small_count == 2:
                # 2 个小图：6+6
                charts[i]["col_class"] = "col-6"
                charts[i + 1]["col_class"] = "col-6"
                i += 2
            elif i + 1 < n:
                next_sc = _size_class(charts[i + 1])
                if next_sc == "mid":
                    # 小图 + 中图：4+8（中图拉伸到 8）
                    w["col_class"] = "col-4"
                    charts[i + 1]["col_class"] = "col-8"
                    i += 2
                elif next_sc == "big":
                    # 小图 + 大图：4+8
                    w["col_class"] = "col-4"
                    charts[i + 1]["col_class"] = "col-8"
                    i += 2
                else:
                    # 下一个是 table
                    w["col_class"] = "col-12"
                    i += 1
            else:
                w["col_class"] = "col-12"
                i += 1
            continue

        # 兜底：未知类型独占一行
        w["col_class"] = "col-12"
        i += 1


def generate_dashboard(df: pd.DataFrame, chart_configs: List[dict], title: str = "数据分析仪表盘", theme_name: str = "default", base_dir: str = ".") -> tuple[str, List[dict], List[str]]:
    # 对每个图表做 normalize（兜底，防止未走 main 的调用路径）
    normalized = []
    for c in chart_configs:
        normalized.extend(normalize_chart_config(c))
    chart_configs = normalized

    # 主题别名映射
    if theme_name not in THEMES:
        theme_name = THEME_ALIASES.get(theme_name, "default")
    theme = THEMES.get(theme_name, THEMES["default"])
    widgets = []
    warn_list: List[str] = []
    # 缓存已加载的数据文件，避免重复读取
    _data_cache: Dict[str, pd.DataFrame] = {}

    for idx, config in enumerate(chart_configs):
        chart_type = config.get("type")
        try:
            # 支持每个图表指定独立的 data_file
            data_file = config.get("data_file")
            if data_file:
                # 问题 6: strip 掉 "./" 前缀，避免 Path 拼接异常
                if data_file.startswith("./"):
                    data_file = data_file[2:]
                # 优先相对 config 所在目录解析，找不到则回退到 cwd 解析
                if Path(data_file).is_absolute():
                    data_path = data_file
                else:
                    candidate = str(Path(base_dir) / data_file)
                    data_path = candidate if Path(candidate).exists() else data_file
                if data_path not in _data_cache:
                    _data_cache[data_path] = read_data(data_path)
                chart_df = _data_cache[data_path]
            else:
                chart_df = df

            validate_chart_config(config, chart_df, idx)

            # 问题 3: 空数据图表警告（KPI 例外）
            if chart_df.empty and chart_type != "kpi":
                warn_list.append(f"图表 {idx + 1} ({chart_type}) 数据为空，跳过生成")
                continue

            # P2: 注册表模式
            generator = CHART_GENERATORS.get(chart_type)
            if generator is None:
                raise ValueError(f"Unknown chart type: {chart_type}")

            # 注入图表索引，让单 series 图表颜色轮转（避免全部同色）
            config["_chart_index"] = idx
            widget = generator(chart_df, config, theme)
            widgets.append(widget)
        except Exception as exc:
            warn_list.append(f"图表 {idx + 1} ({chart_type or 'unknown'}) 生成失败: {exc}")

    # 行填充：确保每行 col_span 总和 = 12，消除右侧空白
    _fill_rows(widgets)

    widgets_html = "\n".join(render_widget_html(widget, i) for i, widget in enumerate(widgets))
    html_output = HTML_TEMPLATE.format(
        title=escape_text(title),
        primary=theme["primary"],
        secondary=theme["secondary"],
        gradient=theme["gradient"],
        bg=theme["bg"],
        card=theme["card"],
        text=theme["text"],
        text_secondary=theme["text_secondary"],
        border=theme["border"],
        shadow=_get_style(theme, "shadow", "0 6px 18px -10px rgba(15,23,42,0.18)"),
        card_border=_get_style(theme, "card_border", "1px solid rgba(148,163,184,0.12)"),
        meta_bg=_get_style(theme, "meta_bg", "rgba(255,255,255,0.72)"),
        zebra_bg=_get_style(theme, "zebra_bg", "rgba(0,0,0,0.02)"),
        hover_bg=_get_style(theme, "hover_bg", "rgba(102,126,234,0.06)"),
        row_count=len(df),
        chart_count=len(widgets),
        widgets_html=widgets_html,
        widgets_json=safe_json_dumps(widgets),
        date=datetime.now().strftime("%Y-%m-%d %H:%M"),
        theme_name=escape_text(theme_name),
    )
    return html_output, widgets, warn_list


def read_data(file_path: str) -> pd.DataFrame:
    path = Path(file_path)
    suffix = path.suffix.lower()
    if suffix in [".xlsx", ".xls"]:
        return pd.read_excel(file_path)
    if suffix == ".csv":
        for encoding in ["utf-8", "gbk", "gb2312", "utf-8-sig"]:
            try:
                return pd.read_csv(file_path, encoding=encoding)
            except Exception:
                continue
        raise ValueError("Unable to read CSV file")
    if suffix == ".json":
        return pd.read_json(file_path)
    raise ValueError(f"Unsupported format: {suffix}")


def write_manifest(manifest_path: Path, output_html: Path, config: Any, widgets: List[dict], warnings: List[str], theme_name: str, row_count: int) -> None:
    manifest = {
        "main": output_html.name,
        "generatedAt": datetime.now().isoformat(),
        "theme": theme_name,
        "rowCount": row_count,
        "chartCount": len(widgets),
        "artifacts": [output_html.name, manifest_path.name],
        "charts": [{"type": widget["type"], "title": widget.get("title"), "layout": widget.get("col_class")} for widget in widgets],
        "warnings": warnings,
        "config": config,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="ECharts Dashboard Generator")
    parser.add_argument("--data", "-d", required=False, help="Data file path")
    parser.add_argument("--config", "-c", required=False, help="Chart config JSON file")
    parser.add_argument("--output", "-o", default="dashboard.html", help="Output HTML file")
    parser.add_argument("--title", "-t", default="数据分析仪表盘", help="Dashboard title")
    parser.add_argument("--test", action="store_true", help="Run self-test")
    parser.add_argument("--local-echarts", help="Path to local echarts.min.js (for intranet)")
    parser.add_argument("--manifest", help="Output manifest JSON path (default: alongside HTML)")

    args = parser.parse_args()

    if args.test:
        print("[OK] ECharts generator module loaded successfully!")
        print("Supported chart types:", ", ".join(sorted(SUPPORTED_CHART_TYPES)))
        print("Supported themes:", ", ".join(sorted(THEMES.keys())))
        return

    if not args.config:
        print("Error: --config is required")
        parser.print_help()
        sys.exit(1)

    try:
        # --data 可选：当所有图表都指定了 data_file 时可不传
        if args.data:
            df = read_data(args.data)
            print(f"[OK] Loaded data: {len(df)} rows")
        else:
            df = pd.DataFrame()  # 空 DataFrame，各图表从 data_file 加载

        with open(args.config, "r", encoding="utf-8") as file:
            config = json.load(file)

        # 自动修正 DeepSeek 常见配置错误（字段别名、嵌套提升、KPI 拆分等）
        if isinstance(config, dict):
            config = normalize_top_level_config(config)

        chart_configs = config.get("charts", config) if isinstance(config, dict) else config
        title = (config.get("title") or args.title) if isinstance(config, dict) else args.title
        raw_theme = config.get("theme", "default") if isinstance(config, dict) else "default"
        theme_name = THEME_ALIASES.get(raw_theme, raw_theme)

        base_dir = str(Path(args.config).parent) if args.config else "."
        html_output, widgets, warnings = generate_dashboard(df, chart_configs, title, theme_name, base_dir)

        local_echarts_path = args.local_echarts
        if not local_echarts_path:
            auto_detect = Path(__file__).parent / "echarts.min.js"
            if auto_detect.exists():
                local_echarts_path = str(auto_detect)

        if local_echarts_path and Path(local_echarts_path).exists():
            echarts_js = Path(local_echarts_path).read_text(encoding="utf-8")
            html_output = html_output.replace(
                '<script src="https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js" onerror="var s=document.createElement(\'script\');s.src=\'echarts.min.js\';document.head.appendChild(s);"></script>',
                f"<script>{echarts_js}</script>",
            )
            print(f"[OK] Embedded local ECharts JS ({len(echarts_js) // 1024}KB)")

        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(html_output, encoding="utf-8")
        print(f"[OK] Dashboard saved to: {output_path}")

        manifest_path = Path(args.manifest) if args.manifest else output_path.with_suffix(".manifest.json")
        write_manifest(manifest_path, output_path, config, widgets, warnings, theme_name, len(df))
        print(f"[OK] Manifest saved to: {manifest_path}")

        for warning in warnings:
            print(f"[WARN] {warning}")

    except Exception as exc:
        print(f"[ERROR] {exc}")
        sys.exit(1)


if __name__ == "__main__":
    main()
