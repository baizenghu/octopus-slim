#!/usr/bin/env bash
#
# Octopus Enterprise 一键部署（无交互）
# 用法: bash scripts/migrate-deploy-auto.sh [迁移包目录]
# 默认迁移包目录: /home/baizh/octopus-migrate
#

set -euo pipefail

PACK_DIR="${1:-/home/baizh/octopus-migrate}"
HOME_DIR="/home/baizh"
PROJECT_DIR="$HOME_DIR/octopus-enterprise"
OCTOPUS_MAIN="$HOME_DIR/octopus-main"
STATE_DIR="$PROJECT_DIR/.octopus-state"
DB_USER="octopus"
DB_PASS="${DB_PASSWORD:?请设置 DB_PASSWORD 环境变量}"
DB_NAME="octopus_enterprise"
DATABASE_URL="mysql://${DB_USER}:${DB_PASS}@localhost:3306/${DB_NAME}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
info() { echo -e "${CYAN}[INFO]${NC}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail() { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Octopus Enterprise 一键部署                    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

[ -d "$PACK_DIR" ] || fail "迁移包目录不存在: $PACK_DIR"

# ─── 1. 解压源码 ────────────────────────────────────────────
info "[1/10] 解压项目源码..."
if [ -f "$PACK_DIR/octopus-enterprise-src.tar.gz" ]; then
  tar -xzf "$PACK_DIR/octopus-enterprise-src.tar.gz" -C "$HOME_DIR/"
  ok "源码已解压"
else
  warn "源码包不存在，跳过（假设已就位）"
fi

# ─── 2. 解压 octopus 二进制 ─────────────────────────────────
info "[2/10] 解压 octopus 二进制..."
if [ -f "$PACK_DIR/octopus-main.tar.gz" ]; then
  tar -xzf "$PACK_DIR/octopus-main.tar.gz" -C "$HOME_DIR/"
  chmod +x "$OCTOPUS_MAIN/octopus.mjs"
  ok "octopus 二进制已解压"
else
  warn "二进制包不存在，跳过"
fi

# ─── 3. 解压 node_modules ───────────────────────────────────
info "[3/10] 解压 node_modules..."
if [ -f "$PACK_DIR/node_modules-all.tar.gz" ]; then
  tar -xzf "$PACK_DIR/node_modules-all.tar.gz" -C "$PROJECT_DIR/"
  ok "node_modules 已恢复"
else
  warn "node_modules 包不存在，尝试 pnpm install..."
  cd "$PROJECT_DIR" && pnpm install
fi

# ─── 4. 加载 Docker 镜像 ────────────────────────────────────
info "[4/10] 加载 Docker Sandbox 镜像..."
if [ -f "$PACK_DIR/octopus-sandbox.tar.gz" ]; then
  docker load < "$PACK_DIR/octopus-sandbox.tar.gz"
  ok "Sandbox 镜像已加载"
else
  warn "Sandbox 镜像不存在，跳过"
fi

if [ -f "$PACK_DIR/docker-base-images.tar.gz" ]; then
  docker load < "$PACK_DIR/docker-base-images.tar.gz"
  ok "MySQL + Redis 镜像已加载"
fi

# ─── 5. 创建软链接 ──────────────────────────────────────────
info "[5/10] 创建兼容性软链接..."
if [ -d "$HOME_DIR/.octopus-enterprise" ] && [ ! -L "$HOME_DIR/.octopus-enterprise" ]; then
  rm -rf "$HOME_DIR/.octopus-enterprise"
fi
ln -sfn "$STATE_DIR" "$HOME_DIR/.octopus-enterprise"
ok "~/.octopus-enterprise -> $STATE_DIR"

# ─── 6. Docker 网络 ─────────────────────────────────────────
info "[6/10] 配置 Docker 网络..."
if docker network inspect octopus-internal &>/dev/null 2>&1; then
  ok "Docker 网络 octopus-internal 已存在"
else
  docker network create --driver bridge --subnet 172.30.0.0/16 \
    --opt com.docker.network.bridge.name=br-octopus octopus-internal
  ok "Docker 网络已创建"
fi

# ─── 7. 数据库 ──────────────────────────────────────────────
info "[7/10] 初始化数据库..."
if mysqladmin ping -h localhost -u "$DB_USER" -p"$DB_PASS" &>/dev/null 2>&1; then
  mysql -u "$DB_USER" -p"$DB_PASS" \
    -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null

  if [ -f "$PACK_DIR/octopus_enterprise.sql" ]; then
    mysql -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" < "$PACK_DIR/octopus_enterprise.sql" 2>/dev/null
    ok "数据库备份已导入"
  else
    cd "$PROJECT_DIR/apps/gateway"
    npx prisma db push --skip-generate 2>/dev/null || npx prisma db push
    ok "数据库表结构已创建（全新）"
  fi
else
  warn "MySQL 不可达，跳过数据库初始化"
  warn "请手动启动 MySQL 后执行: cd apps/gateway && npx prisma db push"
fi

# ─── 8. 构建共享包 ──────────────────────────────────────────
info "[8/10] 构建共享包..."
cd "$PROJECT_DIR"
for pkg in packages/enterprise-*/; do
  [ -f "$pkg/tsconfig.json" ] || continue
  pkg_name=$(basename "$pkg")
  if (cd "$pkg" && npx tsc 2>/dev/null); then
    ok "$pkg_name"
  else
    warn "$pkg_name 构建有警告"
  fi
done

# ─── 9. Plugin Prisma Client ────────────────────────────────
info "[9/10] 生成 Plugin Prisma Client..."
cd "$PROJECT_DIR"
for plugin_dir in plugins/enterprise-*/; do
  [ -f "$plugin_dir/prisma/schema.prisma" ] || continue
  plugin_name=$(basename "$plugin_dir")
  if [ -d "$plugin_dir/node_modules" ]; then
    if (cd "$plugin_dir" && DATABASE_URL="$DATABASE_URL" ../../node_modules/.bin/prisma generate 2>/dev/null); then
      ok "$plugin_name"
    else
      warn "$plugin_name Prisma Client 生成失败"
    fi
  fi
done

# ─── 10. 启动 ───────────────────────────────────────────────
info "[10/10] 启动服务..."
cd "$PROJECT_DIR"
./start-dev.sh start

# ─── 验证 ───────────────────────────────────────────────────
echo ""
sleep 3
GATEWAY_PORT=$(grep -oP 'GATEWAY_PORT=\K[0-9]+' "$PROJECT_DIR/.env" 2>/dev/null || echo "18790")
if curl -sf "http://localhost:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
  ok "Gateway 健康检查通过"
else
  warn "Gateway 尚未就绪，请查看日志: tail -f .dev-logs/*.log"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  部署完成！${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
