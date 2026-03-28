#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Excel Query — 对 Excel/CSV 文件执行类 SQL 聚合查询，输出小 CSV

类似 batch_sql.py 的 Excel 版本。DeepSeek 写查询计划 JSON，脚本批量执行聚合后输出 CSV。

用法:
    python3 excel_query.py --input temp/excel_plan.json

输入 JSON 格式:
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

聚合函数: sum, mean, count, min, max, nunique, median
特殊类型:
  - "agg": "summary" — 自动生成 KPI 汇总（所有数值列的 count/sum/mean）
  - "agg": "raw"     — 不聚合，直接取指定列（可配 sort + limit）
"""

import sys
import json
import argparse
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import pandas as pd
except ImportError:
    print("[ERROR] pandas not installed. Run: pip install pandas")
    sys.exit(1)

try:
    import openpyxl  # noqa: F401
except ImportError:
    pass  # CSV doesn't need openpyxl


def read_source(file_path: str, sheet: str = None) -> pd.DataFrame:
    """读取 Excel 或 CSV 文件"""
    p = Path(file_path)
    if not p.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    suffix = p.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        kwargs = {"sheet_name": sheet} if sheet else {}
        return pd.read_excel(file_path, **kwargs)
    elif suffix == ".csv":
        return pd.read_csv(file_path)
    elif suffix == ".json":
        return pd.read_json(file_path)
    else:
        # Try CSV as fallback
        return pd.read_csv(file_path)


def execute_query(df: pd.DataFrame, query: dict, output_dir: str) -> dict:
    """执行单条聚合查询并保存为 CSV"""
    name = query.get("name", "unnamed")
    try:
        agg_type = query.get("agg", "group")
        group_by = query.get("group_by", [])
        measures = query.get("measures", {})
        sort_col = query.get("sort")
        limit = query.get("limit")
        columns = query.get("columns", [])  # for raw mode

        if agg_type == "summary":
            # KPI 汇总: 所有数值列的统计
            numeric_cols = df.select_dtypes(include="number").columns.tolist()
            if not numeric_cols:
                return {"name": name, "success": False, "error": "No numeric columns found"}

            result_data = {}
            result_data["total_rows"] = len(df)
            for col in numeric_cols:
                result_data[f"{col}_sum"] = df[col].sum()
                result_data[f"{col}_mean"] = round(df[col].mean(), 2)
                result_data[f"{col}_min"] = df[col].min()
                result_data[f"{col}_max"] = df[col].max()

            result = pd.DataFrame([result_data])

        elif agg_type == "raw":
            # 不聚合，直接取列
            if columns:
                result = df[columns].copy()
            else:
                result = df.copy()
            if sort_col and sort_col in result.columns:
                result = result.sort_values(sort_col, ascending=False)
            if limit:
                result = result.head(limit)

        else:
            # GROUP BY 聚合
            if not group_by:
                return {"name": name, "success": False, "error": "group_by is required for aggregation"}

            # Validate columns exist
            missing = [c for c in group_by if c not in df.columns]
            if missing:
                return {"name": name, "success": False, "error": f"Columns not found: {missing}. Available: {list(df.columns)}"}

            if not measures:
                # Default: count
                result = df.groupby(group_by, dropna=False).size().reset_index(name="count")
            else:
                # Validate measure columns
                missing_m = [c for c in measures if c not in df.columns]
                if missing_m:
                    return {"name": name, "success": False, "error": f"Measure columns not found: {missing_m}. Available: {list(df.columns)}"}

                agg_dict = {}
                for col, func in measures.items():
                    if isinstance(func, list):
                        agg_dict[col] = func
                    else:
                        agg_dict[col] = func

                result = df.groupby(group_by, dropna=False).agg(agg_dict).reset_index()

                # Flatten multi-level columns if needed
                if isinstance(result.columns, pd.MultiIndex):
                    result.columns = ["_".join(str(c) for c in col if c) for col in result.columns]

            # Sort
            if sort_col and sort_col in result.columns:
                result = result.sort_values(sort_col, ascending=False)
            elif not sort_col and len(group_by) == 1:
                # Default sort: by first measure desc (for bar/pie charts)
                measure_cols = [c for c in result.columns if c not in group_by]
                if measure_cols:
                    result = result.sort_values(measure_cols[0], ascending=False)

            # Limit
            if limit:
                result = result.head(limit)

        # Round numeric columns
        for col in result.select_dtypes(include="number").columns:
            if result[col].dtype == "float64":
                result[col] = result[col].round(2)

        # Save CSV
        csv_path = Path(output_dir) / f"{name}.csv"
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        result.to_csv(str(csv_path), index=False, encoding="utf-8")

        return {
            "name": name,
            "success": True,
            "rows": len(result),
            "columns": list(result.columns),
            "csv_path": str(csv_path),
        }
    except Exception as e:
        return {"name": name, "success": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Excel Query — 对 Excel/CSV 执行聚合查询并保存 CSV")
    parser.add_argument("--input", "-i", required=True, help="Query plan JSON file")
    parser.add_argument("--output", "-o", default="data", help="Output directory for CSV files (default: data/)")

    args = parser.parse_args()

    # 1. 读取查询计划
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] Input file not found: {args.input}")
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    file_path = plan.get("file", "")
    sheet = plan.get("sheet")
    queries = plan.get("queries", [])

    if not file_path:
        print("[ERROR] No 'file' specified in plan.")
        sys.exit(1)
    if not queries:
        print("[ERROR] No queries found in plan.")
        sys.exit(1)

    # 2. 读取数据源（只读一次）
    print(f"[OK] Reading: {file_path}" + (f" (sheet: {sheet})" if sheet else ""))
    try:
        df = read_source(file_path, sheet)
    except Exception as e:
        print(f"[ERROR] Failed to read file: {e}")
        sys.exit(1)

    print(f"[OK] Data: {len(df)} rows × {len(df.columns)} columns")
    print(f"[OK] Columns: {list(df.columns)}")
    print(f"[OK] Queries: {len(queries)}")

    # 3. 执行所有查询
    results = []
    for q in queries:
        result = execute_query(df, q, args.output)
        results.append(result)
        if result["success"]:
            print(f"  [OK] {result['name']}: {result['rows']} rows → {result['csv_path']}")
        else:
            print(f"  [FAIL] {result['name']}: {result['error']}")

    # 4. 汇总
    success = sum(1 for r in results if r["success"])
    failed = sum(1 for r in results if not r["success"])
    print(f"\n[DONE] {success} succeeded, {failed} failed")

    # 5. 输出结果 JSON
    output_summary = {
        "success": failed == 0,
        "total": len(results),
        "succeeded": success,
        "failed": failed,
        "source": {"file": file_path, "rows": len(df), "columns": len(df.columns)},
        "csv_files": [r["csv_path"] for r in results if r["success"]],
        "results": results,
    }
    print(json.dumps(output_summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
