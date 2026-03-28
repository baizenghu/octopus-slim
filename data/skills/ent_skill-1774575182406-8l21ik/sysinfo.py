#!/usr/bin/env python3
"""企业技能：采集系统信息生成 HTML 报告"""
import os
import sys
import platform
import datetime
import shutil

now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
disk = shutil.disk_usage("/")
disk_total = f"{disk.total // (1024**3)} GB"
disk_used = f"{disk.used // (1024**3)} GB"
disk_free = f"{disk.free // (1024**3)} GB"
disk_pct = f"{disk.used * 100 / disk.total:.1f}%"

html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>System Info</title>
<style>
  body {{ font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 20px; }}
  .card {{ background: #f0fdf4; border: 1px solid #22c55e; border-radius: 12px; padding: 24px; }}
  h1 {{ color: #15803d; }}
  table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
  td {{ padding: 8px 12px; border-bottom: 1px solid #e5e7eb; }}
  td:first-child {{ font-weight: bold; color: #374151; width: 40%; }}
  .footer {{ color: #64748b; font-size: 13px; margin-top: 16px; text-align: center; }}
</style></head>
<body>
<div class="card">
  <h1>服务器系统信息</h1>
  <table>
    <tr><td>主机名</td><td>{platform.node()}</td></tr>
    <tr><td>操作系统</td><td>{platform.system()} {platform.release()}</td></tr>
    <tr><td>架构</td><td>{platform.machine()}</td></tr>
    <tr><td>Python 版本</td><td>{platform.python_version()}</td></tr>
    <tr><td>CPU 核心数</td><td>{os.cpu_count()}</td></tr>
    <tr><td>磁盘总量</td><td>{disk_total}</td></tr>
    <tr><td>磁盘已用</td><td>{disk_used} ({disk_pct})</td></tr>
    <tr><td>磁盘可用</td><td>{disk_free}</td></tr>
  </table>
  <p class="footer">采集时间：{now} | 由 system-info 企业技能生成</p>
</div>
</body></html>"""

workspace = os.environ.get("WORKSPACE_PATH", os.getcwd())
outputs = os.path.join(workspace, "outputs")
os.makedirs(outputs, exist_ok=True)
out_path = os.path.join(outputs, "system-info.html")
with open(out_path, "w", encoding="utf-8") as f:
    f.write(html)

print(f"系统信息报告已生成: {out_path}")
