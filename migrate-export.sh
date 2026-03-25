#!/bin/bash
# Octopus 项目完整导出脚本
# 用法：bash migrate-export.sh /path/to/output
#
# 导出内容：
#   1. 项目目录（含数据、配置、插件、技能、用户文件）
#   2. MySQL 数据库完整 dump
#   3. Docker sandbox 镜像
#
# 目标机器需要：
#   - Node.js 18+, pnpm
#   - MySQL 8.0+
#   - Docker（如需沙箱）
#   - Python 3.10+（如需技能执行）

set -euo pipefail

OUTPUT_DIR="${1:?用法: bash migrate-export.sh /path/to/output}"
PROJECT_DIR="/home/baizh/octopus"

mkdir -p "$OUTPUT_DIR"

echo "=== Octopus 项目导出 ==="
echo "输出目录: $OUTPUT_DIR"
echo ""

# 1. 导出项目目录（排除可重建的 node_modules）
echo "[1/4] 打包项目目录..."
tar czf "$OUTPUT_DIR/octopus-project.tar.gz" \
    -C "$(dirname "$PROJECT_DIR")" \
    --exclude='node_modules' \
    --exclude='.dev-logs' \
    "$(basename "$PROJECT_DIR")"
echo "  完成: octopus-project.tar.gz ($(du -sh "$OUTPUT_DIR/octopus-project.tar.gz" | cut -f1))"

# 2. 导出 MySQL 数据库
echo "[2/4] 导出 MySQL 数据库..."
mysqldump -u octopus -p'YOUR_DB_PASSWORD' \
    --single-transaction \
    --routines --triggers --events \
    octopus_enterprise > "$OUTPUT_DIR/octopus-db.sql" 2>/dev/null
echo "  完成: octopus-db.sql ($(du -sh "$OUTPUT_DIR/octopus-db.sql" | cut -f1))"

# 3. 导出 Docker sandbox 镜像
echo "[3/4] 导出 Docker sandbox 镜像..."
if docker image inspect octopus-sandbox:enterprise >/dev/null 2>&1; then
    docker save octopus-sandbox:enterprise | gzip > "$OUTPUT_DIR/octopus-sandbox.tar.gz"
    echo "  完成: octopus-sandbox.tar.gz ($(du -sh "$OUTPUT_DIR/octopus-sandbox.tar.gz" | cut -f1))"
else
    echo "  跳过: 镜像不存在"
fi

# 4. 导出环境信息
echo "[4/4] 导出环境信息..."
cat > "$OUTPUT_DIR/env-info.txt" << 'ENVEOF'
=== 导入步骤 ===

1. 解压项目：
   tar xzf octopus-project.tar.gz -C /home/<用户>/

2. 安装依赖：
   cd /home/<用户>/octopus
   pnpm install

3. 导入数据库：
   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS octopus_enterprise"
   mysql -u root -p -e "CREATE USER IF NOT EXISTS 'octopus'@'localhost' IDENTIFIED BY 'YOUR_DB_PASSWORD'"
   mysql -u root -p -e "GRANT ALL ON octopus_enterprise.* TO 'octopus'@'localhost'"
   mysql -u octopus -p'YOUR_DB_PASSWORD' octopus_enterprise < octopus-db.sql

4. 导入 Docker 镜像（如需沙箱）：
   docker load < octopus-sandbox.tar.gz

5. 修改配置中的路径：
   - .octopus-state/octopus.json 中的绝对路径
   - .env 中的路径（如有）
   搜索替换: /home/baizh → /home/<新用户>

6. 设置 Docker sandbox 网络：
   bash docker/sandbox/setup-network.sh

7. 启动：
   ./start.sh start
ENVEOF
echo "  完成: env-info.txt"

echo ""
echo "=== 导出完成 ==="
ls -lh "$OUTPUT_DIR"/
echo ""
echo "总大小: $(du -sh "$OUTPUT_DIR" | cut -f1)"
echo "请查看 env-info.txt 了解导入步骤。"
