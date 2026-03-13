#!/usr/bin/env bash
#
# Octopus Enterprise 迁移打包脚本
#
# 在源机器上执行，将所有必要文件打包到指定输出目录。
# 用法: ./scripts/migrate-pack.sh [输出目录]
#
# 默认输出目录: /tmp/octopus-migrate/
#

set -euo pipefail

# ─── 颜色 ───────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ─── 路径 ───────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OCTOPUS_MAIN="/home/baizh/octopus-main"
OUT_DIR="${1:-/tmp/octopus-migrate}"
MANIFEST="$OUT_DIR/MANIFEST.txt"

# ─── 从 .env 读数据库配置 ────────────────────────────────────
set -a
source "$ROOT_DIR/.env" 2>/dev/null || true
set +a

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }

# ─── 预检 ───────────────────────────────────────────────────

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Octopus Enterprise 迁移打包                    ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

[ -d "$ROOT_DIR/.octopus-state" ] || fail ".octopus-state 目录不存在"
[ -d "$OCTOPUS_MAIN" ]            || fail "octopus-main 目录不存在: $OCTOPUS_MAIN"
[ -f "$ROOT_DIR/.env" ]            || fail ".env 文件不存在"

mkdir -p "$OUT_DIR"
> "$MANIFEST"  # 清空清单

info "源项目目录: $ROOT_DIR"
info "octopus 二进制: $OCTOPUS_MAIN"
info "输出目录: $OUT_DIR"
echo ""

# ─── 1. 项目源码 ────────────────────────────────────────────

step=1
info "[$step/6] 打包项目源码..."
tar -czf "$OUT_DIR/octopus-enterprise-src.tar.gz" \
  -C "$(dirname "$ROOT_DIR")" \
  --exclude='octopus-enterprise/node_modules' \
  --exclude='octopus-enterprise/apps/*/node_modules' \
  --exclude='octopus-enterprise/packages/*/node_modules' \
  --exclude='octopus-enterprise/plugins/*/node_modules' \
  --exclude='octopus-enterprise/.dev-logs' \
  --exclude='octopus-enterprise/.dev-pids' \
  --exclude='octopus-enterprise/.octopus-state/logs' \
  --exclude='octopus-enterprise/.octopus-state/completions' \
  --exclude='octopus-enterprise/.octopus-state/subagents' \
  "$(basename "$ROOT_DIR")/"
ok "octopus-enterprise-src.tar.gz"
echo "octopus-enterprise-src.tar.gz | 项目源码(含 .octopus-state 配置)" >> "$MANIFEST"

# ─── 2. Octopus 二进制 ─────────────────────────────────────

step=2
info "[$step/6] 打包 octopus 二进制（可能需要几分钟）..."
tar -czf "$OUT_DIR/octopus-main.tar.gz" \
  -C "$(dirname "$OCTOPUS_MAIN")" \
  "$(basename "$OCTOPUS_MAIN")/"
ok "octopus-main.tar.gz"
echo "octopus-main.tar.gz | octopus 二进制运行时" >> "$MANIFEST"

# ─── 3. node_modules ────────────────────────────────────────

step=3
info "[$step/6] 打包 node_modules..."
cd "$ROOT_DIR"

# 收集所有存在的 node_modules 路径
nm_paths=()
[ -d "node_modules" ] && nm_paths+=("node_modules/")
for d in apps/*/node_modules packages/*/node_modules plugins/*/node_modules; do
  [ -d "$d" ] && nm_paths+=("$d/")
done

if [ ${#nm_paths[@]} -eq 0 ]; then
  warn "未找到 node_modules，跳过（目标机需要 pnpm install）"
else
  tar -czf "$OUT_DIR/node_modules-all.tar.gz" "${nm_paths[@]}"
  ok "node_modules-all.tar.gz"
  echo "node_modules-all.tar.gz | 所有 node_modules 依赖" >> "$MANIFEST"
fi

# ─── 4. Docker Sandbox 镜像 ─────────────────────────────────

step=4
info "[$step/6] 导出 Docker Sandbox 镜像..."
if docker image inspect octopus-sandbox:enterprise &>/dev/null 2>&1; then
  docker save octopus-sandbox:enterprise | gzip > "$OUT_DIR/octopus-sandbox.tar.gz"
  ok "octopus-sandbox.tar.gz"
  echo "octopus-sandbox.tar.gz | Docker Sandbox 镜像" >> "$MANIFEST"
else
  warn "Docker 镜像 octopus-sandbox:enterprise 不存在，跳过"
  warn "目标机需要手动构建: cd docker/sandbox && ./build.sh"
fi

# ─── 5. MySQL 数据库 ────────────────────────────────────────

step=5
info "[$step/6] 导出 MySQL 数据库..."
DB_USER_VAL="${DB_USER:-octopus}"
DB_PASS_VAL="${DB_PASSWORD:-}"
DB_NAME_VAL="${DB_NAME:-octopus_enterprise}"
DB_HOST_VAL="${DB_HOST:-localhost}"
DB_PORT_VAL="${DB_PORT:-3306}"

if command -v mysqldump &>/dev/null && \
   mysqladmin ping -h "$DB_HOST_VAL" -P "$DB_PORT_VAL" -u "$DB_USER_VAL" -p"$DB_PASS_VAL" &>/dev/null 2>&1; then
  mysqldump -h "$DB_HOST_VAL" -P "$DB_PORT_VAL" \
    -u "$DB_USER_VAL" -p"$DB_PASS_VAL" \
    --single-transaction --routines --triggers \
    "$DB_NAME_VAL" > "$OUT_DIR/octopus_enterprise.sql"
  ok "octopus_enterprise.sql"
  echo "octopus_enterprise.sql | MySQL 数据库完整备份" >> "$MANIFEST"
else
  warn "MySQL 不可达或 mysqldump 不存在，跳过数据库导出"
  warn "目标机需要手动建库: npx prisma db push"
fi

# ─── 6. Docker 基础镜像（MySQL + Redis） ────────────────────

step=6
info "[$step/6] 导出 Docker 基础镜像（MySQL + Redis）..."
docker_images_to_save=()
docker image inspect mysql:8.0 &>/dev/null 2>&1 && docker_images_to_save+=("mysql:8.0")
docker image inspect redis:7-alpine &>/dev/null 2>&1 && docker_images_to_save+=("redis:7-alpine")

if [ ${#docker_images_to_save[@]} -gt 0 ]; then
  docker save "${docker_images_to_save[@]}" | gzip > "$OUT_DIR/docker-base-images.tar.gz"
  ok "docker-base-images.tar.gz (${docker_images_to_save[*]})"
  echo "docker-base-images.tar.gz | MySQL 8.0 + Redis 7 Docker 镜像" >> "$MANIFEST"
else
  warn "未找到 MySQL/Redis Docker 镜像，跳过"
fi

# ─── 汇总 ───────────────────────────────────────────────────

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  打包完成！${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo "  输出目录: $OUT_DIR"
echo ""

# 列出文件和大小
total_size=0
while IFS= read -r f; do
  size=$(stat --printf="%s" "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)
  total_size=$((total_size + size))
  human_size=$(numfmt --to=iec "$size" 2>/dev/null || echo "${size}B")
  echo -e "  ${CYAN}$(basename "$f")${NC}  $human_size"
done < <(find "$OUT_DIR" -maxdepth 1 -type f -name "*.tar.gz" -o -name "*.sql" | sort)

total_human=$(numfmt --to=iec "$total_size" 2>/dev/null || echo "${total_size}B")
echo ""
echo -e "  总大小: ${YELLOW}$total_human${NC}"
echo ""
echo "  传输到目标机器:"
echo -e "    ${YELLOW}scp -r $OUT_DIR user@目标机:/tmp/octopus-migrate/${NC}"
echo ""
echo "  在目标机器上部署:"
echo -e "    ${YELLOW}./scripts/migrate-deploy.sh /tmp/octopus-migrate/${NC}"
echo ""
