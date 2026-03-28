#!/bin/bash
#
# Octopus Enterprise 一键初始化脚本
#
# 用法：./setup.sh
#
# clone 项目后运行此脚本，自动安装所有依赖并准备开发环境。
#

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 结果汇总
RESULTS=()
FAILED=0

log_info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
log_ok()    { echo -e "${GREEN}[✓]${NC} $1"; RESULTS+=("${GREEN}[✓]${NC} $1"); }
log_warn()  { echo -e "${YELLOW}[⚠]${NC} $1"; RESULTS+=("${YELLOW}[⚠]${NC} $1"); }
log_fail()  { echo -e "${RED}[✗]${NC} $1"; RESULTS+=("${RED}[✗]${NC} $1"); FAILED=$((FAILED+1)); }
log_step()  { echo -e "\n${CYAN}━━━ 步骤 $1: $2 ━━━${NC}"; }

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════╗"
echo "║   Octopus Enterprise 环境初始化脚本         ║"
echo "╚══════════════════════════════════════════════╝"
echo -e "${NC}"

# ─── 步骤 1: 检查前置条件 ──────────────────────────────────────
log_step 1 "检查前置条件"

check_cmd() {
  local name="$1"
  local cmd="$2"
  local min_version="$3"

  if ! command -v "$cmd" &>/dev/null; then
    log_fail "$name 未安装（需要 $cmd）"
    return 1
  fi

  local version
  case "$cmd" in
    node)    version=$(node -v 2>/dev/null | sed 's/^v//') ;;
    pnpm)    version=$(pnpm -v 2>/dev/null) ;;
    python3) version=$(python3 --version 2>/dev/null | awk '{print $2}') ;;
    docker)  version=$(docker --version 2>/dev/null | grep -oP '\d+\.\d+') ;;
    mysql)   version=$(mysql --version 2>/dev/null | grep -oP '\d+\.\d+') ;;
    redis-cli) version=$(redis-cli --version 2>/dev/null | grep -oP '\d+\.\d+') ;;
  esac

  if [ -n "$min_version" ]; then
    local cur_major cur_minor min_major min_minor
    cur_major=$(echo "$version" | cut -d. -f1)
    min_major=$(echo "$min_version" | cut -d. -f1)
    cur_minor=$(echo "$version" | cut -d. -f2)
    min_minor=$(echo "$min_version" | cut -d. -f2)

    if [ "$cur_major" -lt "$min_major" ] 2>/dev/null || \
       { [ "$cur_major" -eq "$min_major" ] 2>/dev/null && [ "$cur_minor" -lt "$min_minor" ] 2>/dev/null; }; then
      log_fail "$name 版本过低: $version（需要 >= $min_version）"
      return 1
    fi
  fi

  log_ok "$name 已安装 (v$version)"
  return 0
}

check_cmd "Node.js"   node      22.0
check_cmd "pnpm"      pnpm      9.0
check_cmd "Python3"   python3   ""
check_cmd "Docker"    docker    ""
check_cmd "MySQL"     mysql     ""
check_cmd "Redis CLI" redis-cli ""

# ─── 步骤 2: 检查 .env 文件 ──────────────────────────────────────
log_step 2 "检查 .env 文件"

if [ -f "$ROOT_DIR/.env" ]; then
  log_ok ".env 文件已存在"
else
  if [ -f "$ROOT_DIR/.env.example" ]; then
    cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
    log_warn ".env 文件已从 .env.example 复制，请修改其中的配置项（数据库密码、Token 等）"
  else
    log_fail ".env.example 不存在，无法创建 .env 文件"
  fi
fi

# ─── 步骤 2.5: 生成 octopus.json（引擎配置）──────────────────────────
log_step "2.5" "生成 octopus.json"

OCTOPUS_JSON="$ROOT_DIR/.octopus-state/octopus.json"
OCTOPUS_TEMPLATE="$ROOT_DIR/.octopus-state/octopus.json.template"
if [ -f "$OCTOPUS_JSON" ]; then
  log_ok "octopus.json 已存在"
else
  mkdir -p "$ROOT_DIR/.octopus-state"
  if [ -f "$OCTOPUS_TEMPLATE" ]; then
    sed "s|__PROJECT_ROOT__|$ROOT_DIR|g" "$OCTOPUS_TEMPLATE" > "$OCTOPUS_JSON"
    chmod 600 "$OCTOPUS_JSON"
    log_ok "octopus.json 已从模板生成（路径: $ROOT_DIR）"
  else
    log_fail "octopus.json.template 不存在"
  fi
fi

# 更新 .env 中的 DATA_ROOT 为当前项目路径
if [ -f "$ROOT_DIR/.env" ]; then
  if grep -q "DATA_ROOT=./data\|DATA_ROOT=/path/to" "$ROOT_DIR/.env"; then
    sed -i "s|DATA_ROOT=.*|DATA_ROOT=$ROOT_DIR/data|" "$ROOT_DIR/.env"
    log_ok "DATA_ROOT 已更新为 $ROOT_DIR/data"
  fi
fi

# ─── 步骤 3: 安装 Node.js 依赖 ──────────────────────────────────────
log_step 3 "安装 Node.js 依赖"

if [ -d "$ROOT_DIR/node_modules" ]; then
  log_ok "node_modules 已存在，跳过 pnpm install（如需重装请删除 node_modules 后重新运行）"
else
  log_info "正在运行 pnpm install ..."
  if (cd "$ROOT_DIR" && pnpm install); then
    log_ok "Node.js 依赖安装完成"
  else
    log_fail "pnpm install 失败"
  fi
fi

# ─── 步骤 4: 安装 Plugin 依赖 ──────────────────────────────────────
log_step 4 "安装 Plugin 依赖"

for plugin in enterprise-audit enterprise-mcp; do
  plugin_dir="$ROOT_DIR/plugins/$plugin"
  if [ ! -d "$plugin_dir" ]; then
    log_warn "Plugin 目录不存在: plugins/$plugin"
    continue
  fi

  if [ -d "$plugin_dir/node_modules" ]; then
    log_ok "plugins/$plugin/node_modules 已存在，跳过"
  else
    log_info "正在安装 plugins/$plugin 依赖 ..."
    if (cd "$plugin_dir" && pnpm install); then
      log_ok "plugins/$plugin 依赖安装完成"
    else
      log_fail "plugins/$plugin 依赖安装失败"
    fi
  fi
done

# ─── 步骤 5: 生成 Prisma Client ──────────────────────────────────────
log_step 5 "生成 Prisma Client"

for plugin in enterprise-audit enterprise-mcp; do
  plugin_dir="$ROOT_DIR/plugins/$plugin"
  if [ ! -f "$plugin_dir/prisma/schema.prisma" ]; then
    log_warn "plugins/$plugin/prisma/schema.prisma 不存在，跳过"
    continue
  fi

  log_info "生成 plugins/$plugin Prisma Client ..."
  if (cd "$plugin_dir" && npx prisma generate --schema=prisma/schema.prisma); then
    log_ok "plugins/$plugin Prisma Client 生成完成"
  else
    log_fail "plugins/$plugin Prisma Client 生成失败"
  fi
done

log_info "生成主项目 Prisma Client ..."
if (cd "$ROOT_DIR" && pnpm db:generate); then
  log_ok "主项目 Prisma Client 生成完成"
else
  log_fail "主项目 Prisma Client 生成失败"
fi

# ─── 步骤 6: 安装 memory-lancedb-pro 依赖 ──────────────────────────────────────
log_step 6 "安装 memory-lancedb-pro 依赖"

LANCEDB_DIR="$ROOT_DIR/.octopus-state/extensions/memory-lancedb-pro"
if [ ! -d "$LANCEDB_DIR" ]; then
  log_warn "memory-lancedb-pro 目录不存在: .octopus-state/extensions/memory-lancedb-pro"
elif [ -d "$LANCEDB_DIR/node_modules" ]; then
  log_ok "memory-lancedb-pro/node_modules 已存在，跳过"
else
  log_info "正在安装 memory-lancedb-pro 依赖 ..."
  if (cd "$LANCEDB_DIR" && npm install); then
    log_ok "memory-lancedb-pro 依赖安装完成"
  else
    log_fail "memory-lancedb-pro 依赖安装失败"
  fi
fi

# ─── 步骤 7: 创建 Python 虚拟环境 ──────────────────────────────────────
log_step 7 "创建 Python 虚拟环境"

VENV_DIR="$ROOT_DIR/data/skills/.venv"
REQ_FILE="$ROOT_DIR/data/skills/requirements.txt"

if [ -f "$VENV_DIR/bin/python3" ]; then
  log_ok "Python 虚拟环境已存在: data/skills/.venv"
else
  if ! command -v python3 &>/dev/null; then
    log_fail "python3 未安装，无法创建虚拟环境"
  else
    log_info "正在创建 Python 虚拟环境 ..."
    mkdir -p "$ROOT_DIR/data/skills"
    if python3 -m venv "$VENV_DIR"; then
      log_ok "Python 虚拟环境创建完成"
    else
      log_fail "Python 虚拟环境创建失败"
    fi
  fi
fi

if [ -f "$VENV_DIR/bin/pip" ] && [ -f "$REQ_FILE" ]; then
  log_info "正在安装 Python 依赖 ..."
  if "$VENV_DIR/bin/pip" install -r "$REQ_FILE" \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn; then
    log_ok "Python 依赖安装完成"
  else
    log_fail "Python 依赖安装失败"
  fi
elif [ ! -f "$REQ_FILE" ]; then
  log_warn "data/skills/requirements.txt 不存在，跳过 Python 依赖安装"
fi

# ─── 步骤 8: 构建 Docker 沙箱镜像 ──────────────────────────────────────
log_step 8 "构建 Docker 沙箱镜像"

if ! command -v docker &>/dev/null; then
  log_fail "Docker 未安装，无法构建沙箱镜像"
elif docker image inspect octopus-sandbox:enterprise &>/dev/null; then
  log_ok "Docker 镜像 octopus-sandbox:enterprise 已存在，跳过构建"
else
  log_info "正在构建 Docker 沙箱镜像 ..."
  if docker build -f "$ROOT_DIR/docker/sandbox/Dockerfile" -t octopus-sandbox:enterprise "$ROOT_DIR/docker/sandbox/"; then
    log_ok "Docker 沙箱镜像构建完成"
  else
    log_fail "Docker 沙箱镜像构建失败"
  fi
fi

# ─── 步骤 9: 创建 Docker 网络 ──────────────────────────────────────
log_step 9 "创建 Docker 网络"

if ! command -v docker &>/dev/null; then
  log_fail "Docker 未安装，无法创建网络"
elif docker network inspect octopus-internal &>/dev/null; then
  log_ok "Docker 网络 octopus-internal 已存在，跳过"
else
  log_info "正在创建 Docker 网络 octopus-internal ..."
  if docker network create --driver bridge --subnet 172.30.0.0/16 octopus-internal; then
    log_ok "Docker 网络 octopus-internal 创建完成"
  else
    log_fail "Docker 网络创建失败"
  fi
fi

# ─── 步骤 10: 数据库迁移提示 ──────────────────────────────────────
log_step 10 "数据库迁移"

echo -e "${YELLOW}[⚠]${NC} 如果是全新数据库，请手动运行以下命令："
echo -e "    ${CYAN}cd $ROOT_DIR && pnpm db:push${NC}"
echo ""

# ─── 汇总结果 ──────────────────────────────────────────────────
echo -e "\n${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║              初始化结果汇总                  ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}\n"

for r in "${RESULTS[@]}"; do
  echo -e "  $r"
done

echo ""
if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}共 $FAILED 项失败，请检查上方日志修复后重新运行。${NC}"
else
  echo -e "${GREEN}所有步骤执行完成！${NC}"
  echo -e "运行 ${CYAN}./start-dev.sh start${NC} 启动开发环境。"
fi
echo ""
