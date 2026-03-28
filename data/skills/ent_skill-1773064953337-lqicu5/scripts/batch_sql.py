#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Batch SQL Executor — 批量执行 SQL 并保存为 CSV

从 JSON 配置读取多条 SQL，并行执行后直接保存为 CSV 文件。
数据库连接信息从环境变量 DB_{conn}_HOST 等读取（由 run_skill 自动注入）。

用法:
    python3 batch_sql.py --input temp/sql_plan.json [--connection openclaw_enterprise]

输入 JSON 格式:
{
  "connection": "openclaw_enterprise",
  "queries": [
    {"name": "daily_trend", "sql": "SELECT DATE(created_at) as date, COUNT(*) as log_count FROM audit_logs GROUP BY date"},
    {"name": "action_dist", "sql": "SELECT action, COUNT(*) as count FROM audit_logs GROUP BY action"},
    ...
  ]
}
"""

import sys
import os
import json
import argparse
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import pymysql
except ImportError:
    print("[ERROR] pymysql not installed. Run: pip install pymysql")
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    print("[ERROR] pandas not installed. Run: pip install pandas")
    sys.exit(1)


def get_db_config(connection_name: str) -> dict:
    """从环境变量读取数据库连接配置"""
    prefix = f"DB_{connection_name}_"
    config = {
        "type": os.environ.get(f"{prefix}TYPE", "mysql"),
        "host": os.environ.get(f"{prefix}HOST"),
        "port": int(os.environ.get(f"{prefix}PORT", "3306")),
        "user": os.environ.get(f"{prefix}USER"),
        "password": os.environ.get(f"{prefix}PASSWORD"),
        "database": os.environ.get(f"{prefix}DATABASE"),
    }

    if not config["host"]:
        # 列出可用的连接
        available = set()
        for key in os.environ:
            if key.startswith("DB_") and key.endswith("_HOST"):
                name = key[3:-5]  # DB_xxx_HOST → xxx
                available.add(name)

        if available:
            print(f"[ERROR] Connection '{connection_name}' not found. Available: {', '.join(sorted(available))}")
        else:
            print(f"[ERROR] No database connections found in environment. DB_* env vars not injected.")
        return None

    return config


def execute_query(config: dict, name: str, sql: str, output_dir: str) -> dict:
    """执行单条 SQL 并保存为 CSV"""
    start = time.time()
    try:
        conn = pymysql.connect(
            host=config["host"],
            port=config["port"],
            user=config["user"],
            password=config["password"],
            database=config["database"],
            charset="utf8mb4",
            connect_timeout=10,
            read_timeout=60,
        )
        try:
            with conn.cursor(pymysql.cursors.DictCursor) as cursor:
                cursor.execute(sql)
                rows = cursor.fetchall()
        finally:
            conn.close()

        df = pd.DataFrame(rows)
        csv_path = Path(output_dir) / f"{name}.csv"
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(str(csv_path), index=False, encoding="utf-8")

        duration = int((time.time() - start) * 1000)
        return {
            "name": name,
            "success": True,
            "rows": len(df),
            "columns": list(df.columns),
            "csv_path": str(csv_path),
            "duration_ms": duration,
        }
    except Exception as e:
        duration = int((time.time() - start) * 1000)
        return {
            "name": name,
            "success": False,
            "error": str(e),
            "duration_ms": duration,
        }


def main():
    parser = argparse.ArgumentParser(description="Batch SQL Executor — 批量执行 SQL 并保存 CSV")
    parser.add_argument("--input", "-i", required=True, help="SQL plan JSON file")
    parser.add_argument("--output", "-o", default="data", help="Output directory for CSV files (default: data/)")
    parser.add_argument("--connection", "-c", help="Database connection name (overrides JSON)")
    parser.add_argument("--workers", "-w", type=int, default=4, help="Parallel workers (default: 4)")

    args = parser.parse_args()

    # 1. 读取 SQL plan
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"[ERROR] Input file not found: {args.input}")
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        plan = json.load(f)

    conn_name = args.connection or plan.get("connection", "")
    queries = plan.get("queries", [])

    if not conn_name:
        print("[ERROR] No connection name specified. Use --connection or set 'connection' in JSON.")
        sys.exit(1)

    if not queries:
        print("[ERROR] No queries found in plan.")
        sys.exit(1)

    # 2. 获取 DB 配置
    db_config = get_db_config(conn_name)
    if not db_config:
        sys.exit(1)

    print(f"[OK] Database: {db_config['user']}@{db_config['host']}:{db_config['port']}/{db_config['database']}")
    print(f"[OK] Queries: {len(queries)}, Workers: {args.workers}")

    # 3. 并行执行
    results = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {}
        for q in queries:
            name = q.get("name", "unnamed")
            sql = q.get("sql", "")
            if not sql:
                print(f"[WARN] Query '{name}' has no SQL, skipping.")
                continue
            future = pool.submit(execute_query, db_config, name, sql, args.output)
            futures[future] = name

        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            if result["success"]:
                print(f"  [OK] {result['name']}: {result['rows']} rows, {result['duration_ms']}ms → {result['csv_path']}")
            else:
                print(f"  [FAIL] {result['name']}: {result['error']} ({result['duration_ms']}ms)")

    # 4. 汇总
    success = sum(1 for r in results if r["success"])
    failed = sum(1 for r in results if not r["success"])
    total_ms = sum(r["duration_ms"] for r in results)
    print(f"\n[DONE] {success} succeeded, {failed} failed, total query time: {total_ms}ms")

    # 5. 输出结果 JSON（方便大模型解析）
    output_summary = {
        "success": failed == 0,
        "total": len(results),
        "succeeded": success,
        "failed": failed,
        "csv_files": [r["csv_path"] for r in results if r["success"]],
        "results": results,
    }
    print(json.dumps(output_summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
