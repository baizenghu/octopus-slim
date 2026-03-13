#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Auto Dashboard — 简化仪表盘生成入口

接收简单的 JSON 配置（标题 + 图表数组），自动推断每个 CSV 的 dimensions/measures，
生成完整配置后调用 echarts_generator.py 生成 HTML 仪表盘。

用法:
    python3 auto_dashboard.py --input plan.json --output outputs/dashboard.html
"""

import sys
import json
import argparse
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import pandas as pd
except ImportError:
    print("Error: pandas not installed. Run: pip install pandas")
    sys.exit(1)

# Import generate_dashboard from the sibling module
_SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(_SCRIPT_DIR))

from echarts_generator import generate_dashboard, read_data  # noqa: E402


# ── Column role inference ──

_TIME_KEYWORDS = {"date", "time", "day", "week", "month", "quarter", "year",
                  "日期", "时间", "月份", "年度", "年份", "期间",
                  "created_at", "updated_at", "创建时间", "更新时间"}


def _is_time_like(col_name: str) -> bool:
    """Check if column name looks like a time/date field."""
    lower = col_name.lower().replace("-", "_").replace(" ", "_")
    return any(kw in lower for kw in _TIME_KEYWORDS)


def _classify_columns(df: pd.DataFrame) -> tuple[List[str], List[str]]:
    """Classify columns into dimensions and measures.

    Returns:
        (dimensions, measures) — lists of column names.
    """
    dims: List[str] = []
    measures: List[str] = []

    for col in df.columns:
        series = df[col]

        # Time-like column name takes priority as dimension
        if _is_time_like(col):
            dims.append(col)
            continue

        # Datetime dtype → dimension
        if pd.api.types.is_datetime64_any_dtype(series):
            dims.append(col)
            continue

        # Numeric → measure
        if pd.api.types.is_numeric_dtype(series):
            measures.append(col)
            continue

        # Object column: try to detect dates by sampling
        if series.dtype == "object":
            non_null = series.dropna()
            if len(non_null) > 0:
                try:
                    parsed = pd.to_datetime(non_null.head(20), errors="coerce")
                    if parsed.notna().sum() / len(parsed) > 0.8:
                        dims.append(col)
                        continue
                except Exception:
                    pass

        # Default: string/categorical → dimension
        dims.append(col)

    return dims, measures


def _infer_chart_config(
    title: str,
    chart_type: str,
    csv_path: str,
) -> Optional[List[Dict[str, Any]]]:
    """Read a CSV and build chart config dict(s).

    For KPI type, returns one config per numeric column.
    For other types, returns a single-element list.
    Returns None if the file cannot be read.
    """
    path = Path(csv_path)
    if not path.exists():
        print(f"[WARN] CSV file not found, skipping: {csv_path}")
        return None

    try:
        df = read_data(str(path))
    except Exception as exc:
        print(f"[WARN] Failed to read {csv_path}: {exc}")
        return None

    if df.empty:
        print(f"[WARN] CSV file is empty: {csv_path}")
        return None

    dims, measures = _classify_columns(df)

    # ── KPI: each numeric column becomes an independent KPI card ──
    if chart_type == "kpi":
        configs = []
        for m in measures:
            configs.append({
                "type": "kpi",
                "title": m,
                "data_file": csv_path,
                "dimensions": [],
                "measures": [m],
            })
        # If no numeric columns found, treat all columns as measures
        if not configs:
            for col in df.columns:
                configs.append({
                    "type": "kpi",
                    "title": col,
                    "data_file": csv_path,
                    "dimensions": [],
                    "measures": [col],
                })
        return configs if configs else None

    # ── Heatmap: needs 2 dimensions ──
    if chart_type == "heatmap":
        if len(dims) < 2:
            print(f"[WARN] Heatmap '{title}' requires at least 2 dimension columns, "
                  f"found {len(dims)} in {csv_path}")
            # Fallback: use first 2 columns as dims if possible
            if len(df.columns) >= 3:
                dims = [df.columns[0], df.columns[1]]
                measures = [c for c in df.columns[2:] if pd.api.types.is_numeric_dtype(df[c])]
                if not measures:
                    measures = [df.columns[2]]
            else:
                return None

        return [{
            "type": "heatmap",
            "title": title,
            "data_file": csv_path,
            "dimensions": dims[:2],
            "measures": measures[:1] if measures else [df.columns[-1]],
        }]

    # ── Sunburst / Treemap: multi-level dimensions ──
    if chart_type in ("sunburst", "treemap"):
        return [{
            "type": chart_type,
            "title": title,
            "data_file": csv_path,
            "dimensions": dims,
            "measures": measures[:1] if measures else [df.columns[-1]],
        }]

    # ── General charts (line, bar, pie, donut, area, scatter, etc.) ──
    # Use first dimension only for simple chart types
    selected_dims = dims[:1] if dims else []
    selected_measures = measures if measures else []

    # If no dimension found, use first column
    if not selected_dims and len(df.columns) > 1:
        selected_dims = [df.columns[0]]
        selected_measures = [c for c in df.columns[1:] if pd.api.types.is_numeric_dtype(df[c])]

    # If still no measures, use last column
    if not selected_measures:
        selected_measures = [df.columns[-1]]

    return [{
        "type": chart_type,
        "title": title,
        "data_file": csv_path,
        "dimensions": selected_dims,
        "measures": selected_measures,
    }]


def build_full_config(input_spec: Dict[str, Any]) -> Dict[str, Any]:
    """Transform simplified input spec into full echarts_generator config.

    Input format:
    {
        "title": "Dashboard Title",
        "theme": "executive",
        "charts": [
            ["Chart Title", "chart_type", "path/to/data.csv"],
            ...
        ]
    }

    Returns a config dict compatible with echarts_generator.
    """
    dashboard_title = input_spec.get("title", "数据分析仪表盘")
    theme = input_spec.get("theme", "default")
    charts_input = input_spec.get("charts", [])

    all_chart_configs: List[Dict[str, Any]] = []

    for entry in charts_input:
        if not isinstance(entry, (list, tuple)) or len(entry) < 3:
            print(f"[WARN] Invalid chart entry (expected [title, type, path]): {entry}")
            continue

        title, chart_type, csv_path = entry[0], entry[1], entry[2]

        configs = _infer_chart_config(title, chart_type, csv_path)
        if configs:
            all_chart_configs.extend(configs)

    return {
        "title": dashboard_title,
        "theme": theme,
        "charts": all_chart_configs,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Auto Dashboard — 从简单 JSON 配置自动生成 ECharts 仪表盘"
    )
    parser.add_argument(
        "--input", "-i", required=True,
        help="Input JSON file (simplified dashboard plan)"
    )
    parser.add_argument(
        "--output", "-o", default="outputs/dashboard.html",
        help="Output HTML file path (default: outputs/dashboard.html)"
    )
    parser.add_argument(
        "--save-config", "-s",
        help="Save generated full config to this path (optional, for debugging)"
    )

    args = parser.parse_args()

    # 1. Read input spec
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] Input file not found: {args.input}")
        sys.exit(1)

    try:
        with open(input_path, "r", encoding="utf-8") as f:
            input_spec = json.load(f)
    except json.JSONDecodeError as exc:
        print(f"[ERROR] Invalid JSON in {args.input}: {exc}")
        sys.exit(1)

    # 2. Build full config with auto-inferred dimensions/measures
    full_config = build_full_config(input_spec)
    chart_configs = full_config.get("charts", [])

    if not chart_configs:
        print("[ERROR] No valid charts generated. Check input file and CSV paths.")
        sys.exit(1)

    print(f"[OK] Generated {len(chart_configs)} chart configs from {len(input_spec.get('charts', []))} entries")

    # 3. Optionally save the generated config for debugging
    config_save_path = args.save_config or "temp/_auto_config.json"
    Path(config_save_path).parent.mkdir(parents=True, exist_ok=True)
    with open(config_save_path, "w", encoding="utf-8") as f:
        json.dump(full_config, f, ensure_ascii=False, indent=2)
    print(f"[OK] Full config saved to: {config_save_path}")

    # 4. Call generate_dashboard
    dashboard_title = full_config.get("title", "数据分析仪表盘")
    theme_name = full_config.get("theme", "default")

    # generate_dashboard expects a DataFrame (can be empty when all charts use data_file)
    df = pd.DataFrame()

    html_output, widgets, warnings = generate_dashboard(
        df, chart_configs, dashboard_title, theme_name, base_dir="."
    )

    # 5. Write output HTML
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_output, encoding="utf-8")
    print(f"[OK] Dashboard saved to: {output_path}")
    print(f"[OK] Total widgets rendered: {len(widgets)}")

    # 6. Print warnings if any
    for w in warnings:
        print(f"[WARN] {w}")


if __name__ == "__main__":
    main()
