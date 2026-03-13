#!/usr/bin/env bash
#
# Octopus Enterprise 一键部署脚本
#
# 在目标机器上执行，从迁移包解压并部署全部服务。
# 用法: ./scripts/migrate-deploy.sh [迁移包目录]
#
# 默认迁移包目录: /tmp/octopus-migrate/
#
# 支持两种模式:
#   --fresh     全新部署（忽略 SQL 备份，用 prisma db push 建表）
#   --restore   完整恢复（导入 SQL 备份，默认模式）
#

set -euo pipefail

# ─── 颜色 ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── 参数解析 ────────────────────────────────────────────────
MODE="restore"  # 默认恢复模式
PACK_DIR=""

for arg in "$@"; do
  case "$arg" in
    --fresh)  MODE="fresh" ;;
    --restore) MODE="restore" ;;
    *)
      if [ -z "$PACK_DIR" ]; then
        PACK_DIR="$arg"
      fi
      ;;
  esac
done

PACK_DIR="${PACK_DIR:-/tmp/octopus-migrate}"

# ─── 路径定义 ────────────────────────────────────────────────
PROJECT_DIR="/home/baizh/octopus-enterprise"
OCTOPUS_MAIN="/home/baizh/octopus-main"
STATE_DIR="$PROJECT_DIR/.octopus-state"

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
ask()   {
  echo -en "${YELLOW}[?]${NC}   $* [Y/n] "
  read -r ans
  [[ "$ans" =~ ^[Nn] ]] && return 1
  return 0
}

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Octopus Enterprise 一键部署                    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
info "迁移包目录: $PACK_DIR"
info "部署模式: $MODE"
echo ""

# ─── 预检: 迁移包 ───────────────────────────────────────────

[ -d "$PACK_DIR" ] || fail "迁移包目录不存在: $PACK_DIR"

required_files=("octopus-enterprise-src.tar.gz" "octopus-main.tar.gz")
for f in "${required_files[@]}"; do
  [ -f "$PACK_DIR/$f" ] || fail "缺少必要文件: $PACK_DIR/$f"
done
ok "迁移包文件完整"

# ─── Step 1: 检查系统依赖 ────────────────────────────────────

step=1
total=9
info "[$step/$total] 检查系统依赖..."

check_cmd() {
  local cmd="$1"
  local min_ver="$2"
  local label="$3"
  if command -v "$cmd" &>/dev/null; then
    local ver
    ver=$("$cmd" --version 2>&1 | head -1 || true)
    ok "$label: $ver"
  else
    fail "$label 未安装（需要 $min_ver+）"
  fi
}

check_cmd node "22.x" "Node.js"
check_cmd pnpm "9.x" "pnpm"
check_cmd docker "20.x" "Docker"

# MySQL: 检查客户端工具
if command -v mysql &>/dev/null; then
  ok "MySQL client: $(mysql --version 2>&1 | head -1)"
else
  warn "mysql 命令不存在，需要确保 MySQL 服务器已在别处运行"
fi

# Docker group 检查
if id -Gn | grep -qw docker; then
  ok "当前用户在 docker 组中"
else
  warn "当前用户不在 docker 组，Docker 命令可能需要 sudo"
  warn "修复: sudo usermod -aG docker \$USER && 重新登录"
fi

echo ""

# ─── Step 2: 解压项目源码 ───────────────────────────────────

step=2
info "[$step/$total] 解压项目源码..."

if [ -d "$PROJECT_DIR" ]; then
  if [ -d "$PROJECT_DIR/.git" ]; then
    warn "项目目录已存在: $PROJECT_DIR"
    if ! ask "覆盖现有项目？（.git 目录会保留）"; then
      info "跳过源码解压"
    else
      # 保留 .git，删除其他文件
      find "$PROJECT_DIR" -maxdepth 1 -not -name '.git' -not -name '.' -not -name '..' \
        -exec rm -rf {} + 2>/dev/null || true
      tar -xzf "$PACK_DIR/octopus-enterprise-src.tar.gz" -C "$(dirname "$PROJECT_DIR")/"
      ok "源码已更新（.git 保留）"
    fi
  else
    tar -xzf "$PACK_DIR/octopus-enterprise-src.tar.gz" -C "$(dirname "$PROJECT_DIR")/"
    ok "源码已解压"
  fi
else
  tar -xzf "$PACK_DIR/octopus-enterprise-src.tar.gz" -C "$(dirname "$PROJECT_DIR")/"
  ok "源码已解压"
fi

# ─── Step 3: 解压 octopus 二进制 ────────────────────────────

step=3
info "[$step/$total] 解压 octopus 二进制..."

if [ -d "$OCTOPUS_MAIN" ]; then
  warn "octopus-main 目录已存在"
  if ask "覆盖？"; then
    rm -rf "$OCTOPUS_MAIN"
    tar -xzf "$PACK_DIR/octopus-main.tar.gz" -C "$(dirname "$OCTOPUS_MAIN")/"
    ok "octopus 二进制已更新"
  else
    info "跳过二进制解压"
  fi
else
  tar -xzf "$PACK_DIR/octopus-main.tar.gz" -C "$(dirname "$OCTOPUS_MAIN")/"
  ok "octopus 二进制已解压"
fi

chmod +x "$OCTOPUS_MAIN/octopus.mjs"
node "$OCTOPUS_MAIN/octopus.mjs" --version 2>/dev/null && ok "octopus 可执行" || warn "octopus 版本检查失败"

# ─── Step 4: 解压 node_modules ───────────────────────────────

step=4
info "[$step/$total] 恢复 node_modules..."

if [ -f "$PACK_DIR/node_modules-all.tar.gz" ]; then
  tar -xzf "$PACK_DIR/node_modules-all.tar.gz" -C "$PROJECT_DIR/"
  ok "node_modules 已恢复"
else
  warn "未找到 node_modules 包"
  if command -v pnpm &>/dev/null; then
    info "尝试 pnpm install..."
    cd "$PROJECT_DIR" && pnpm install
    ok "pnpm install 完成"
  else
    fail "无法恢复依赖：既没有 node_modules 包，pnpm 也不可用"
  fi
fi

# ─── Step 5: 加载 Docker 镜像 ────────────────────────────────

step=5
info "[$step/$total] 加载 Docker 镜像..."

if [ -f "$PACK_DIR/octopus-sandbox.tar.gz" ]; then
  docker load < "$PACK_DIR/octopus-sandbox.tar.gz"
  ok "Sandbox 镜像已加载"
else
  warn "未找到 Sandbox 镜像，尝试本地构建..."
  if [ -f "$PROJECT_DIR/docker/sandbox/build.sh" ]; then
    cd "$PROJECT_DIR/docker/sandbox" && bash build.sh
    ok "Sandbox 镜像已构建"
  else
    warn "无法构建 Sandbox 镜像，sandbox 功能不可用"
  fi
fi

if [ -f "$PACK_DIR/docker-base-images.tar.gz" ]; then
  docker load < "$PACK_DIR/docker-base-images.tar.gz"
  ok "MySQL + Redis 镜像已加载"
else
  info "未找到基础镜像包，跳过（需要手动确保 MySQL/Redis 可用）"
fi

# ─── Step 6: 创建软链接 ─────────────────────────────────────

step=6
info "[$step/$total] 创建兼容性软链接..."

ln -sfn "$STATE_DIR" /home/baizh/.octopus-enterprise
ok "~/.octopus-enterprise -> $STATE_DIR"

# ─── Step 7: Docker 网络 ────────────────────────────────────

step=7
info "[$step/$total] 配置 Docker 网络..."

if docker network inspect octopus-internal &>/dev/null 2>&1; then
  ok "Docker 网络 octopus-internal 已存在"
else
  docker network create \
    --driver bridge \
    --subnet 172.30.0.0/16 \
    --opt com.docker.network.bridge.name=br-octopus \
    octopus-internal
  ok "Docker 网络 octopus-internal 已创建"
fi

# ─── Step 8: 数据库 ─────────────────────────────────────────

step=8
info "[$step/$total] 初始化数据库..."

cd "$PROJECT_DIR"
set -a
source .env 2>/dev/null || true
set +a

DB_USER_VAL="${DB_USER:-octopus}"
DB_PASS_VAL="${DB_PASSWORD:-}"
DB_NAME_VAL="${DB_NAME:-octopus_enterprise}"
DB_HOST_VAL="${DB_HOST:-localhost}"
DB_PORT_VAL="${DB_PORT:-3306}"

# 检查 MySQL 是否可达
mysql_ok=false
if command -v mysqladmin &>/dev/null && \
   mysqladmin ping -h "$DB_HOST_VAL" -P "$DB_PORT_VAL" -u "$DB_USER_VAL" -p"$DB_PASS_VAL" &>/dev/null 2>&1; then
  mysql_ok=true
  ok "MySQL 连接正常"
else
  # 尝试用 docker-compose 启动
  if [ -f "$PROJECT_DIR/docker/docker-compose.dev.yml" ]; then
    warn "MySQL 不可达，尝试用 Docker Compose 启动..."
    docker compose -f "$PROJECT_DIR/docker/docker-compose.dev.yml" up -d
    info "等待 MySQL 启动（最多 30 秒）..."
    for i in {1..30}; do
      if mysqladmin ping -h "$DB_HOST_VAL" -P "$DB_PORT_VAL" -u "$DB_USER_VAL" -p"$DB_PASS_VAL" &>/dev/null 2>&1; then
        mysql_ok=true
        ok "MySQL 已就绪"
        break
      fi
      sleep 1
    done
    if ! $mysql_ok; then
      warn "MySQL 启动超时，数据库初始化跳过"
      warn "请手动启动 MySQL 后执行: cd apps/gateway && npx prisma db push"
    fi
  else
    warn "MySQL 不可达且无 docker-compose 文件"
    warn "请手动配置数据库后执行: cd apps/gateway && npx prisma db push"
  fi
fi

if $mysql_ok; then
  if [ "$MODE" = "restore" ] && [ -f "$PACK_DIR/octopus_enterprise.sql" ]; then
    # 恢复模式：导入备份
    info "导入数据库备份..."

    # 确保数据库存在
    mysql -h "$DB_HOST_VAL" -P "$DB_PORT_VAL" -u "$DB_USER_VAL" -p"$DB_PASS_VAL" \
      -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME_VAL\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || true

    mysql -h "$DB_HOST_VAL" -P "$DB_PORT_VAL" \
      -u "$DB_USER_VAL" -p"$DB_PASS_VAL" \
      "$DB_NAME_VAL" < "$PACK_DIR/octopus_enterprise.sql"
    ok "数据库备份已导入"
  else
    # 全新模式：用 Prisma 建表
    info "全新建表 (prisma db push)..."

    mysql -h "$DB_HOST_VAL" -P "$DB_PORT_VAL" -u "$DB_USER_VAL" -p"$DB_PASS_VAL" \
      -e "CREATE DATABASE IF NOT EXISTS \`$DB_NAME_VAL\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null || true

    cd "$PROJECT_DIR/apps/gateway"
    npx prisma db push --skip-generate 2>/dev/null || npx prisma db push
    cd "$PROJECT_DIR"
    ok "数据库表结构已创建"
  fi

  # 确保 Prisma Client 已生成
  cd "$PROJECT_DIR/apps/gateway"
  npx prisma generate 2>/dev/null || true
  cd "$PROJECT_DIR"
fi

# ─── Step 9: 构建共享包 + 启动 ──────────────────────────────

step=9
info "[$step/$total] 构建共享包..."

cd "$PROJECT_DIR"
build_ok=true
for pkg in packages/enterprise-*/; do
  [ -f "$pkg/tsconfig.json" ] || continue
  pkg_name=$(basename "$pkg")
  if (cd "$pkg" && npx tsc 2>/dev/null); then
    ok "$pkg_name"
  else
    warn "$pkg_name 构建失败（非致命，可能已有 dist）"
    build_ok=false
  fi
done

# Plugin Prisma Client 生成
for plugin_dir in plugins/enterprise-*/; do
  [ -f "$plugin_dir/prisma/schema.prisma" ] || continue
  plugin_name=$(basename "$plugin_dir")
  if [ -d "$plugin_dir/node_modules" ]; then
    info "生成 $plugin_name Prisma Client..."
    (cd "$plugin_dir" && DATABASE_URL="$DATABASE_URL" ../../node_modules/.bin/prisma generate 2>/dev/null) && \
      ok "$plugin_name Prisma Client" || warn "$plugin_name Prisma Client 生成失败"
  fi
done

# ─── 启动 ───────────────────────────────────────────────────

echo ""
if ask "立即启动服务？"; then
  cd "$PROJECT_DIR"
  ./start-dev.sh start

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  部署完成！${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo ""

  # 等待 Gateway 就绪后验证
  sleep 3
  GATEWAY_PORT="${GATEWAY_PORT:-18790}"
  if curl -sf "http://localhost:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
    ok "Gateway 健康检查通过"
    echo ""
    echo -e "  Admin Console: ${CYAN}http://localhost:${ADMIN_CONSOLE_PORT:-3001}${NC}"
    echo -e "  Gateway:       ${CYAN}http://localhost:${GATEWAY_PORT}${NC}"
    echo -e "  健康检查:      ${CYAN}http://localhost:${GATEWAY_PORT}/health${NC}"
  else
    warn "Gateway 健康检查暂未通过（可能仍在启动中）"
    echo -e "  查看日志: ${YELLOW}tail -f .dev-logs/gateway.log${NC}"
    echo -e "  查看日志: ${YELLOW}tail -f .dev-logs/native-gateway.log${NC}"
  fi
else
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo -e "${GREEN}  部署准备完成，尚未启动服务${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  启动: ${YELLOW}cd $PROJECT_DIR && ./start-dev.sh start${NC}"
fi

echo ""
