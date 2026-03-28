#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECharts Visualization Skill - Database Data Adapter
将 MCP execute_sql 返回的 JSON 数据转换为可分析格式
"""

import os
import sys
import json
import tempfile
import argparse
import warnings
from pathlib import Path
from datetime import datetime

try:
    import pandas as pd
except ImportError:
    print("Error: pandas not installed. Run: pip install pandas")
    sys.exit(1)

# 导入 data_analyzer 的分析功能
SCRIPT_DIR = Path(__file__).parent
sys.path.insert(0, str(SCRIPT_DIR))
try:
    from data_analyzer import (
        detect_field_type,
        suggest_roles,
        recommend_chart_types,
        build_analysis_summary,
    )
except ImportError:
    detect_field_type = None
    suggest_roles = None
    recommend_chart_types = None
    build_analysis_summary = None

# 默认最大行数保护阈值
DEFAULT_MAX_ROWS = 100_000


def _serialize_json_columns(df: pd.DataFrame) -> pd.DataFrame:
    """P0-1: 将 object 列中的 dict/list 值用 json.dumps 序列化"""
    for col in df.columns:
        if df[col].dtype == object:
            def _serialize(val):
                if isinstance(val, (dict, list)):
                    return json.dumps(val, ensure_ascii=False)
                return val
            df[col] = df[col].map(_serialize)
    return df


def _normalize_null_values(df: pd.DataFrame) -> pd.DataFrame:
    """P1-5: 统一 NULL 表示"""
    df = df.replace({"": pd.NA, "NULL": pd.NA, "null": pd.NA})
    return df


def _try_numeric_conversion(df: pd.DataFrame) -> pd.DataFrame:
    """P1-4: 对 object 列尝试转换为数值（处理 Decimal 字符串等）"""
    for col in df.columns:
        if df[col].dtype == object:
            try:
                converted = pd.to_numeric(df[col])
                df[col] = converted
            except (ValueError, TypeError):
                pass
    return df


def json_to_dataframe(json_data, max_rows: int = DEFAULT_MAX_ROWS) -> tuple:
    """
    将 MCP execute_sql 返回的 JSON 数据转换为 DataFrame

    支持格式:
    1. {"success": true, "data": [...], "columns": [...]}  # MCP 标准格式
    2. {"data": [...]}  # 简化格式
    3. [...]  # 纯数组格式

    返回: (df, truncated) 元组
    """
    if isinstance(json_data, str):
        try:
            json_data = json.loads(json_data)
        except json.JSONDecodeError as e:
            # P3-11: json.loads 错误包装，截取前 200 字符
            preview = json_data[:200] if len(json_data) > 200 else json_data
            raise ValueError(
                f"JSON 解析失败: {e}. 输入前 200 字符: {preview}"
            ) from e

    truncated = False

    # 处理 MCP 标准返回格式
    if isinstance(json_data, dict):
        if not json_data.get("success", True):
            raise ValueError(f"Query failed: {json_data.get('message', 'Unknown error')}")

        data = json_data.get("data", json_data.get("rows", []))
        columns = json_data.get("columns", None)

        if columns and isinstance(data, list) and len(data) > 0:
            # 如果 data 是元组/列表的列表，使用 columns 作为列名
            if isinstance(data[0], (list, tuple)):
                if len(data) > max_rows:
                    data = data[:max_rows]
                    truncated = True
                df = pd.DataFrame(data, columns=columns)
            elif isinstance(data[0], dict):
                # P0-2: dict 列表且提供了 columns 时，校验并重命名
                dict_keys = list(data[0].keys())
                if dict_keys != list(columns):
                    if len(dict_keys) == len(columns):
                        warnings.warn(
                            f"columns 与 data keys 不一致，将按位置重命名: "
                            f"{dict_keys} -> {list(columns)}",
                            UserWarning,
                            stacklevel=2,
                        )
                        if len(data) > max_rows:
                            data = data[:max_rows]
                            truncated = True
                        df = pd.DataFrame(data)
                        df.columns = columns
                    else:
                        # 长度不匹配时，以 data 的 keys 为准并 warn
                        warnings.warn(
                            f"columns 长度({len(columns)})与 data keys 长度({len(dict_keys)})不一致，"
                            f"使用 data 自身的 keys",
                            UserWarning,
                            stacklevel=2,
                        )
                        if len(data) > max_rows:
                            data = data[:max_rows]
                            truncated = True
                        df = pd.DataFrame(data)
                else:
                    if len(data) > max_rows:
                        data = data[:max_rows]
                        truncated = True
                    df = pd.DataFrame(data)
            else:
                if len(data) > max_rows:
                    data = data[:max_rows]
                    truncated = True
                df = pd.DataFrame(data, columns=columns)
        else:
            if isinstance(data, list) and len(data) > max_rows:
                data = data[:max_rows]
                truncated = True
            df = pd.DataFrame(data)

    elif isinstance(json_data, list):
        # 纯数组格式
        if len(json_data) > max_rows:
            json_data = json_data[:max_rows]
            truncated = True
        df = pd.DataFrame(json_data)

    else:
        raise ValueError(f"Unsupported data format: {type(json_data)}")

    # P1-5: 统一 NULL 值
    df = _normalize_null_values(df)
    # P1-4: Decimal 字符串转数值
    df = _try_numeric_conversion(df)

    return df, truncated


def analyze_db_data(data_or_df, sample_rows: int = 10) -> dict:
    """
    分析数据库查询结果，返回字段元数据
    复用 data_analyzer 的分析功能

    参数:
        data_or_df: JSON 数据 或 已构建的 pd.DataFrame
        sample_rows: 采样行数
    """
    # P0-3: 支持直接传入 DataFrame，避免重复构建
    if isinstance(data_or_df, pd.DataFrame):
        df = data_or_df
    else:
        df, _ = json_to_dataframe(data_or_df)

    # 分析每个字段
    fields = []
    for col in df.columns:
        if detect_field_type:
            field_info = detect_field_type(df[col])
        else:
            # P2-8: 降级模式补齐完整 field_info 结构
            is_numeric = pd.api.types.is_numeric_dtype(df[col])
            field_info = {
                "name": col,
                "dtype": str(df[col].dtype),
                "null_count": int(df[col].isnull().sum()),
                "unique_count": int(df[col].nunique()),
                "type": "numeric" if is_numeric else "categorical",
                "semantic": None,
                "sample": df[col].dropna().head(5).tolist(),
                "cardinality": "unknown",
                "default_aggregation": "sum" if is_numeric else "count",
            }
        fields.append(field_info)

    # 建议维度和度量
    if suggest_roles:
        roles = suggest_roles(fields)
    else:
        roles = {"dimensions": [], "measures": []}

    # P2-7: 补齐 recommended_charts
    if recommend_chart_types:
        charts = recommend_chart_types(fields, roles, len(df))
    else:
        charts = []

    # P2-7: 补齐 summary
    if build_analysis_summary:
        summary = build_analysis_summary(fields, roles)
    else:
        summary = {
            "time_dimensions": [],
            "category_dimensions": [],
            "measures": [],
            "semantic_groups": {},
        }

    # 获取样本数据
    sample_data = df.head(sample_rows).to_dict(orient='records')

    return {
        "source": "database_query",
        "row_count": len(df),
        "column_count": len(df.columns),
        "fields": fields,
        "suggested_dimensions": roles["dimensions"],
        "suggested_measures": roles["measures"],
        "recommended_charts": charts,
        "summary": summary,
        "sample_data": sample_data,
        "analysis_time": datetime.now().isoformat()
    }


def save_as_csv(df: pd.DataFrame, output_path: str) -> str:
    """保存 DataFrame 为 CSV 文件（原子写入）"""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)

    # P0-1: 序列化 JSON 字段（dict/list → JSON 字符串）
    df = _serialize_json_columns(df.copy())

    # P3-12: 先写临时文件再 os.rename，保证原子性
    fd, tmp_path = tempfile.mkstemp(
        suffix=".csv.tmp", dir=str(path.parent)
    )
    try:
        os.close(fd)
        # P1-6: Linux 环境用 utf-8，无需 BOM
        df.to_csv(tmp_path, index=False, encoding='utf-8')
        os.replace(tmp_path, str(path))
    except BaseException:
        # 清理临时文件
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    return str(path.absolute())


def process_query_result(
    json_data, name: str, output_dir: str = ".", max_rows: int = DEFAULT_MAX_ROWS
) -> dict:
    """
    处理单个查询结果：转换、分析、保存

    返回:
    {
        "name": "query_name",
        "csv_path": "/path/to/output.csv",
        "analysis": {...},
        "empty": bool,
        "truncated": bool,
    }
    """
    # P0-3: 只构建一次 DataFrame
    df, truncated = json_to_dataframe(json_data, max_rows=max_rows)

    # P3-9: 空结果集标记
    empty = len(df) == 0

    # 保存为 CSV（即使空也生成文件，保持接口一致）
    csv_path = Path(output_dir) / f"{name}.csv"
    save_as_csv(df, str(csv_path))

    # P0-3: 直接传 DataFrame 给 analyze_db_data，避免重复构建
    analysis = analyze_db_data(df)
    analysis["name"] = name

    result = {
        "name": name,
        "csv_path": str(csv_path.absolute()),
        "row_count": len(df),
        "columns": list(df.columns),
        "analysis": analysis,
        "empty": empty,
    }
    # P3-10: 截断标记
    if truncated:
        result["truncated"] = True

    return result


def main():
    parser = argparse.ArgumentParser(
        description='ECharts Database Data Adapter - 转换 MCP 查询结果'
    )
    parser.add_argument('--test', action='store_true',
                        help='测试模块是否正常加载')
    parser.add_argument('--demo', action='store_true',
                        help='使用示例数据演示转换功能')
    parser.add_argument('--input', '-i',
                        help='输入 JSON 文件路径')
    parser.add_argument('--output', '-o', default='data',
                        help='输出目录 (默认: data/)')
    parser.add_argument('--name', '-n', default='query_result',
                        help='查询名称 (默认: query_result)')
    parser.add_argument('--json', action='store_true',
                        help='输出 JSON 格式的分析结果')
    # P3-10: max-rows 保护
    parser.add_argument('--max-rows', type=int, default=DEFAULT_MAX_ROWS,
                        help=f'最大行数保护 (默认: {DEFAULT_MAX_ROWS})')

    args = parser.parse_args()

    if args.test:
        print("[OK] db_data_adapter module loaded successfully!")
        print(f"  - data_analyzer integration: {'OK' if detect_field_type else 'Standalone mode'}")
        print("  - Dependencies: pandas")
        return

    if args.demo:
        # 模拟 MCP execute_sql 返回的数据
        demo_data = {
            "success": True,
            "data": [
                {"region": "华东", "product": "产品A", "amount": 15000, "quantity": 120},
                {"region": "华东", "product": "产品B", "amount": 12000, "quantity": 95},
                {"region": "华北", "product": "产品A", "amount": 18000, "quantity": 150},
                {"region": "华北", "product": "产品B", "amount": 9000, "quantity": 70},
                {"region": "华南", "product": "产品A", "amount": 22000, "quantity": 180},
            ],
            "columns": ["region", "product", "amount", "quantity"],
            "row_count": 5
        }

        print("=== Demo: 模拟 MCP execute_sql 返回数据 ===")
        print(f"Input: {json.dumps(demo_data, ensure_ascii=False, indent=2)[:200]}...")
        print()

        result = process_query_result(demo_data, "demo_sales", args.output, max_rows=args.max_rows)

        print(f"[OK] CSV saved to: {result['csv_path']}")
        print(f"[OK] Rows: {result['row_count']}, Columns: {result['columns']}")
        if result.get("truncated"):
            print(f"[WARN] 数据已截断至 {args.max_rows} 行")
        print()
        print("Analysis:")
        print(json.dumps(result['analysis'], ensure_ascii=False, indent=2, default=str))
        return

    if args.input:
        with open(args.input, 'r', encoding='utf-8') as f:
            json_data = json.load(f)

        result = process_query_result(json_data, args.name, args.output, max_rows=args.max_rows)

        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        else:
            print(f"[OK] CSV saved to: {result['csv_path']}")
            print(f"[OK] Rows: {result['row_count']}, Columns: {result['columns']}")
            if result.get("truncated"):
                print(f"[WARN] 数据已截断至 {args.max_rows} 行")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
