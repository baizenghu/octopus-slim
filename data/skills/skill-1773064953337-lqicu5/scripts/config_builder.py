#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ECharts Config Builder - 逐步构建 chart_config.json
避免 LLM 一次生成大 JSON 时丢失图表。
"""

import sys
import json
import argparse
from pathlib import Path


def cmd_init(args):
    """初始化空配置文件"""
    config = {
        "title": args.title or "数据分析仪表盘",
        "theme": args.theme or "default",
        "charts": [],
    }
    _write_config(args.config, config)
    print(f"[OK] 初始化配置: {args.config} (title={config['title']}, theme={config['theme']})")


def cmd_add(args):
    """添加一个图表到配置"""
    config = _read_config(args.config)

    chart = {"type": args.type, "title": args.chart_title or ""}

    if args.dimensions:
        chart["dimensions"] = [d.strip() for d in args.dimensions.split(",")]
    if args.measures:
        chart["measures"] = [m.strip() for m in args.measures.split(",")]
    if args.data_file:
        chart["data_file"] = args.data_file
    if args.col_span:
        chart["col_span"] = args.col_span

    # config 参数（可选）
    chart_config = {}
    if args.agg:
        chart_config["agg"] = args.agg
    if args.top_n:
        chart_config["top_n"] = args.top_n
    if args.sort_order:
        chart_config["sort_order"] = args.sort_order
    if args.smooth:
        chart_config["smooth"] = True
    if args.stack:
        chart_config["stack"] = True
    if args.horizontal:
        chart_config["horizontal"] = True
    if args.max_val is not None:
        chart_config["max"] = args.max_val
    if args.unit:
        chart_config["unit"] = args.unit
    if chart_config:
        chart["config"] = chart_config

    config["charts"].append(chart)
    _write_config(args.config, config)

    idx = len(config["charts"])
    print(f"[OK] 添加图表 #{idx}: {args.type} \"{chart.get('title', '')}\" → 当前共 {idx} 个图表")


def cmd_list(args):
    """列出当前配置中的所有图表"""
    config = _read_config(args.config)
    charts = config.get("charts", [])
    print(f"配置: {config.get('title', '?')} | 主题: {config.get('theme', '?')} | 图表数: {len(charts)}")
    print("-" * 60)
    for i, c in enumerate(charts, 1):
        dims = c.get("dimensions", [])
        meas = c.get("measures", [])
        cs = c.get("col_span", "?")
        df = c.get("data_file", "-")
        print(f"  #{i:2d}  {c.get('type', '?'):10s}  col={cs}  {c.get('title', '')}")
        if dims or meas:
            print(f"       dims={dims}  measures={meas}  data={df}")
    print("-" * 60)
    print(f"总计 {len(charts)} 个图表")


def cmd_remove(args):
    """按序号删除图表"""
    config = _read_config(args.config)
    idx = args.index - 1
    charts = config.get("charts", [])
    if 0 <= idx < len(charts):
        removed = charts.pop(idx)
        _write_config(args.config, config)
        print(f"[OK] 删除图表 #{args.index}: {removed.get('type', '?')} \"{removed.get('title', '')}\" → 剩余 {len(charts)} 个")
    else:
        print(f"[ERROR] 序号 {args.index} 无效，当前共 {len(charts)} 个图表")
        sys.exit(1)


def _read_config(path: str) -> dict:
    p = Path(path)
    if not p.exists():
        print(f"[ERROR] 配置文件不存在: {path}")
        sys.exit(1)
    with open(p, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_config(path: str, config: dict):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description="ECharts 配置构建器")
    sub = parser.add_subparsers(dest="command")

    # init
    p_init = sub.add_parser("init", help="初始化配置文件")
    p_init.add_argument("--config", default="chart_config.json", help="配置文件路径")
    p_init.add_argument("--title", help="仪表盘标题")
    p_init.add_argument("--theme", help="主题名")

    # add
    p_add = sub.add_parser("add", help="添加图表")
    p_add.add_argument("--config", default="chart_config.json", help="配置文件路径")
    p_add.add_argument("--type", required=True, help="图表类型")
    p_add.add_argument("--chart-title", help="图表标题")
    p_add.add_argument("--dimensions", help="维度字段，逗号分隔")
    p_add.add_argument("--measures", help="度量字段，逗号分隔")
    p_add.add_argument("--data-file", help="数据文件路径")
    p_add.add_argument("--col-span", type=int, help="列宽 (3/4/6/8/12)")
    p_add.add_argument("--agg", help="聚合方式")
    p_add.add_argument("--top-n", type=int, help="Top N")
    p_add.add_argument("--sort-order", help="排序 asc/desc")
    p_add.add_argument("--smooth", action="store_true", help="平滑曲线")
    p_add.add_argument("--stack", action="store_true", help="堆叠")
    p_add.add_argument("--horizontal", action="store_true", help="水平条形图")
    p_add.add_argument("--max-val", type=float, help="gauge 最大值")
    p_add.add_argument("--unit", help="gauge 单位")

    # list
    p_list = sub.add_parser("list", help="列出所有图表")
    p_list.add_argument("--config", default="chart_config.json", help="配置文件路径")

    # remove
    p_rm = sub.add_parser("remove", help="删除图表")
    p_rm.add_argument("--config", default="chart_config.json", help="配置文件路径")
    p_rm.add_argument("--index", type=int, required=True, help="图表序号 (从1开始)")

    args = parser.parse_args()

    if args.command == "init":
        cmd_init(args)
    elif args.command == "add":
        cmd_add(args)
    elif args.command == "list":
        cmd_list(args)
    elif args.command == "remove":
        cmd_remove(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
