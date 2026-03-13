#!/usr/bin/env bash
#
# Octopus Enterprise 开发环境一键启动脚本
#
# 启动：./start.sh
# 停止：./start.sh stop
# 重启：./start.sh restart
# 状态：./start.sh status
# 日志：./start.sh logs [gateway|admin]
#

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$ROOT_DIR/.dev-logs"
PID_DIR="$ROOT_DIR/.dev-pids"

# ─── 确保当前进程有 docker 组权限 ─────────────────────────────
# sandbox 需要访问 docker socket，若当前 shell 没有 docker 组则用 sg 重新执行
if ! id -Gn | grep -qw docker; then
  exec sg docker -c "\"$0\" $*"
fi

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# 从 .env 读取端口
set -a
source "$ROOT_DIR/.env" 2>/dev/null || true
set +a
GATEWAY_PORT="${GATEWAY_PORT:-18790}"
ADMIN_PORT="${ADMIN_CONSOLE_PORT:-3001}"

mkdir -p "$LOG_DIR" "$PID_DIR"

# ─── 杀掉一个服务（按进程组） ─────────────────────────────
#
# PID 文件存储的是 setsid 创建的进程组 leader PID，
# kill -- -$pid 会杀掉整个进程组（包括所有子进程）。

kill_service() {
  local name="$1"
  local pid_file="$PID_DIR/${name}.pid"

  [ -f "$pid_file" ] || return 0

  local pid
  pid=$(cat "$pid_file" 2>/dev/null)
  rm -f "$pid_file"

  [ -z "$pid" ] && return 0

  # 检查进程是否存在
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  # 1) 尝试优雅终止整个进程组 (SIGTERM)
  kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null

  # 等待最多 5 秒
  local waited=0
  while kill -0 "$pid" 2>/dev/null && [ $waited -lt 50 ]; do
    sleep 0.1
    waited=$((waited + 1))
  done

  # 2) 还活着就强杀 (SIGKILL)
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 -- -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null
    sleep 0.3
  fi

  echo -e "   ${RED}■${NC} $name (PGID $pid) 已停止"
}

# ─── 按端口清理残留 ──────────────────────────────────────

kill_port() {
  local port="$1"
  local label="$2"
  local pids

  # 优先用 fuser，其次 lsof
  if command -v fuser &>/dev/null; then
    pids=$(fuser "${port}/tcp" 2>/dev/null | tr -s ' ')
  elif command -v lsof &>/dev/null; then
    pids=$(lsof -t -i:"$port" 2>/dev/null | tr '\n' ' ')
  fi

  if [ -n "$pids" ]; then
    for p in $pids; do
      kill -9 "$p" 2>/dev/null
    done
    echo -e "   ${RED}■${NC} 清理了端口 $port ($label) 上的残留进程: $pids"
  fi
}

# ─── 停止所有服务 ─────────────────────────────────────────

stop_all() {
  echo -e "${YELLOW}⏹  正在停止所有服务...${NC}"

  # 1) 按 PID 文件停止（进程组级别）
  kill_service "gateway"
  kill_service "admin-console"

  # 2) 清理端口残留（防止漏网之鱼）
  kill_port "$GATEWAY_PORT" "Gateway"
  kill_port "$ADMIN_PORT" "Admin Console"

  # 3) 模式匹配清理（最后兜底）
  pkill -f "tsx.*watch.*apps/server" 2>/dev/null || true
  pkill -f "vite.*--port.*${ADMIN_PORT}" 2>/dev/null || true
  # 也杀掉可能被 tsx 拉起的 node 子进程
  pkill -f "node.*apps/server/src/index" 2>/dev/null || true

  echo -e "${GREEN}✓ 全部停止${NC}"
}

# ─── 查看状态 ─────────────────────────────────────────────

show_status() {
  echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   Octopus Enterprise 服务状态            ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
  echo ""

  local has_service=false
  for name in gateway admin-console; do
    local pid_file="$PID_DIR/${name}.pid"
    [ -f "$pid_file" ] || continue
    has_service=true
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "  ${GREEN}●${NC} $name (PGID $pid) — 运行中"
    else
      echo -e "  ${RED}●${NC} $name (PGID $pid) — 已退出"
      rm -f "$pid_file"
    fi
  done

  if ! $has_service; then
    echo -e "  ${YELLOW}没有运行中的服务${NC}"
  fi

  echo ""
  echo -e "  Gateway:        http://localhost:${GATEWAY_PORT}"
  echo -e "  Admin Console:  http://localhost:${ADMIN_PORT}"
  echo -e "  Health Check:   http://localhost:${GATEWAY_PORT}/health"
  echo ""
}

# ─── 启动服务 ─────────────────────────────────────────────

start_all() {
  # 先确保旧进程全部停止
  stop_all
  sleep 1

  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   🐾 Octopus Enterprise 开发环境        ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
  echo ""

  # 1. 检查依赖
  echo -e "${YELLOW}[1/4]${NC} 检查环境..."
  if ! command -v pnpm &>/dev/null; then
    echo -e "  ${RED}✗ pnpm 未安装${NC}"
    exit 1
  fi
  echo -e "  ${GREEN}✓ 环境检查通过${NC}"

  # 确保 Docker sandbox 网络存在
  if docker network inspect octopus-internal &>/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Docker 网络 octopus-internal 已就绪"
  else
    echo -e "  ${YELLOW}⚠${NC} Docker 网络不存在，正在创建..."
    docker network create \
      --driver bridge \
      --subnet 172.30.0.0/16 \
      --opt com.docker.network.bridge.name=br-octopus \
      octopus-internal 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Docker 网络已创建"
  fi

  # 2. 构建 packages
  echo -e "${YELLOW}[2/4]${NC} 构建共享包..."
  cd "$ROOT_DIR"
  for pkg in packages/enterprise-*/; do
    [ -f "$pkg/tsconfig.json" ] || continue
    local pkg_name
    pkg_name=$(basename "$pkg")
    if (cd "$pkg" && npx tsc --noEmit 2>/dev/null); then
      echo -e "  ${GREEN}✓${NC} $pkg_name"
    else
      echo -e "  ${YELLOW}⚠${NC} $pkg_name (有编译警告，继续)"
    fi
  done

  # 2.5 Docker sandbox 网络检查（仅警告，不阻塞启动）
  if command -v docker &>/dev/null; then
    if ! docker network inspect octopus-internal &>/dev/null 2>&1; then
      echo -e "  ${YELLOW}⚠ Docker 网络 'octopus-internal' 不存在，sandbox 隔离不可用${NC}"
      echo -e "  ${YELLOW}  运行 sudo docker/sandbox/setup-network.sh 以启用${NC}"
    else
      echo -e "  ${GREEN}✓${NC} Docker sandbox 网络已就绪"
    fi
  fi

  # 3. 启动 Gateway（setsid 创建独立进程组，引擎由 EngineAdapter 内部启动）
  echo -e "${YELLOW}[3/4]${NC} 启动 Gateway (端口 ${GATEWAY_PORT})..."
  cd "$ROOT_DIR/apps/server"
  setsid npx tsx src/index.ts > "$LOG_DIR/gateway.log" 2>&1 &
  local gw_pid=$!
  echo "$gw_pid" > "$PID_DIR/gateway.pid"
  echo -e "  ${GREEN}✓${NC} Gateway PGID $gw_pid"

  # 等待 Gateway 就绪
  echo -n "  等待 Gateway 启动"
  local ready=false
  for i in {1..20}; do
    if curl -sf "http://localhost:${GATEWAY_PORT}/health" >/dev/null 2>&1; then
      echo -e " ${GREEN}✓${NC}"
      ready=true
      break
    fi
    echo -n "."
    sleep 1
  done
  if ! $ready; then
    echo -e " ${YELLOW}超时（可能仍在启动中，请查看日志）${NC}"
  fi

  # 4. 启动 Admin Console（setsid 创建独立进程组）
  echo -e "${YELLOW}[4/4]${NC} 启动 Admin Console (端口 ${ADMIN_PORT})..."
  cd "$ROOT_DIR/apps/console"
  setsid npx vite --port "$ADMIN_PORT" > "$LOG_DIR/admin-console.log" 2>&1 &
  local admin_pid=$!
  echo "$admin_pid" > "$PID_DIR/admin-console.pid"
  echo -e "  ${GREEN}✓${NC} Admin Console PGID $admin_pid"

  sleep 2

  # 完成
  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  🚀 启动完成！${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Gateway:        ${CYAN}http://localhost:${GATEWAY_PORT}${NC}"
  echo -e "  Admin Console:  ${CYAN}http://localhost:${ADMIN_PORT}${NC}"
  echo -e "  Health:         ${CYAN}http://localhost:${GATEWAY_PORT}/health${NC}"
  echo ""
  echo -e "  日志目录：$LOG_DIR/"
  echo -e "  查看日志：${YELLOW}tail -f $LOG_DIR/gateway.log${NC}"
  echo -e "           ${YELLOW}tail -f $LOG_DIR/admin-console.log${NC}"
  echo -e "  停止服务：${YELLOW}./start.sh stop${NC}"
  echo ""
}

# ─── 入口 ─────────────────────────────────────────────────

case "${1:-start}" in
  stop)
    stop_all
    ;;
  status)
    show_status
    ;;
  restart)
    stop_all
    sleep 1
    start_all
    ;;
  start|"")
    start_all
    ;;
  logs)
    case "${2:-all}" in
      gateway)  tail -f "$LOG_DIR/gateway.log" ;;
      admin)    tail -f "$LOG_DIR/admin-console.log" ;;
      *)        tail -f "$LOG_DIR"/*.log ;;
    esac
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs [gateway|admin]}"
    exit 1
    ;;
esac
