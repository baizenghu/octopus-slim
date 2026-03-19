#!/usr/bin/env bash
#
# 监控 octopus.json 中 openai-codex 相关配置变化
# 用法: ./scripts/watch-models.sh
# 后台: nohup ./scripts/watch-models.sh &
# 停止: Ctrl+C 或 kill
#

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$ROOT_DIR/.octopus-state/octopus.json"
LOG="$ROOT_DIR/.dev-logs/models-watch.log"

if [ ! -f "$CONFIG" ]; then
  echo "配置文件不存在: $CONFIG"
  exit 1
fi

# 提取 openai-codex 相关配置的快照
get_snapshot() {
  python3 -c "
import json
with open('$CONFIG') as f:
    c = json.load(f)

# openai-codex provider
codex = c.get('models', {}).get('providers', {}).get('openai-codex')
print('=== models.providers.openai-codex ===')
if codex:
    print(f'  baseUrl: {codex.get(\"baseUrl\", \"N/A\")}')
    print(f'  api: {codex.get(\"api\", \"N/A\")}')
    print(f'  models: {[m.get(\"id\") if isinstance(m,dict) else m for m in codex.get(\"models\",[])]}')
else:
    print('  NOT FOUND')

# auth.profiles
auth = c.get('auth', {}).get('profiles', {}).get('openai-codex:default')
print('=== auth.profiles.openai-codex:default ===')
if auth:
    print(f'  provider: {auth.get(\"provider\")}')
    print(f'  mode: {auth.get(\"mode\")}')
else:
    print('  NOT FOUND')

# agents 使用 openai-codex 的情况
print('=== agents using openai-codex ===')
for a in c.get('agents', {}).get('list', []):
    m = a.get('model', '')
    if 'codex' in str(m).lower() or 'openai' in str(m).lower():
        print(f'  {a.get(\"id\")}: {m}')
defaults = c.get('agents', {}).get('defaults', {}).get('model', {})
if 'codex' in str(defaults).lower():
    print(f'  defaults: {defaults}')
" 2>/dev/null
}

# 提取 hash（只关注 codex 相关字段）
get_hash() {
  python3 -c "
import json, hashlib
with open('$CONFIG') as f:
    c = json.load(f)
codex_provider = json.dumps(c.get('models',{}).get('providers',{}).get('openai-codex'), sort_keys=True)
codex_auth = json.dumps(c.get('auth',{}).get('profiles',{}).get('openai-codex:default'), sort_keys=True)
codex_agents = json.dumps([a.get('model') for a in c.get('agents',{}).get('list',[]) if 'codex' in str(a.get('model','')).lower()], sort_keys=True)
print(hashlib.sha256((codex_provider + codex_auth + codex_agents).encode()).hexdigest()[:16])
" 2>/dev/null
}

# 推测修改来源
guess_source() {
  local gw_log="$ROOT_DIR/.dev-logs/gateway.log"
  local recent=$(tail -10 "$gw_log" 2>/dev/null | grep -i "config\|reload\|apply\|sync\|model\|codex" | tail -1)
  if [ -n "$recent" ]; then
    echo "$recent"
  else
    echo "来源未知（非 gateway 触发）"
  fi
}

mkdir -p "$(dirname "$LOG")"

PREV_HASH=$(get_hash)
{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始监控 openai-codex 配置"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 基线 hash: $PREV_HASH"
  get_snapshot
  echo "---"
} | tee -a "$LOG"

# 用 inotifywait 或轮询
if command -v inotifywait &>/dev/null; then
  echo "使用 inotifywait 实时监控..."
  while true; do
    inotifywait -q -e modify,move_self "$CONFIG" 2>/dev/null
    sleep 0.5
    NEW_HASH=$(get_hash)
    if [ "$NEW_HASH" != "$PREV_HASH" ]; then
      {
        echo "========================================"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  openai-codex 配置变化!"
        echo "  hash: $PREV_HASH → $NEW_HASH"
        echo "  来源: $(guess_source)"
        get_snapshot
        echo "========================================"
      } | tee -a "$LOG"
      PREV_HASH="$NEW_HASH"
    fi
  done
else
  echo "轮询模式（每 3 秒）..."
  while true; do
    sleep 3
    NEW_HASH=$(get_hash)
    if [ "$NEW_HASH" != "$PREV_HASH" ]; then
      {
        echo "========================================"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] ⚠️  openai-codex 配置变化!"
        echo "  hash: $PREV_HASH → $NEW_HASH"
        echo "  来源: $(guess_source)"
        get_snapshot
        echo "========================================"
      } | tee -a "$LOG"
      PREV_HASH="$NEW_HASH"
    fi
  done
fi
