#!/usr/bin/env bash
set -e

NETWORK="octopus-internal"

# 创建 bridge 网络（如不存在）
if ! docker network inspect "$NETWORK" &>/dev/null; then
    docker network create \
        --driver bridge \
        --subnet 172.30.0.0/16 \
        --opt com.docker.network.bridge.name=br-octopus \
        "$NETWORK"
    echo "✓ 创建 Docker 网络: $NETWORK"
else
    echo "✓ Docker 网络已存在: $NETWORK"
fi

# iptables 规则：封锁公网，允许内网
INTRANET_RANGES=("192.168.0.0/16" "10.0.0.0/8" "172.16.0.0/12")

# 先清理旧规则（幂等）
iptables -D FORWARD -i br-octopus -j REJECT 2>/dev/null || true
for range in "${INTRANET_RANGES[@]}"; do
    iptables -D FORWARD -i br-octopus -d "$range" -j ACCEPT 2>/dev/null || true
done

# 添加新规则
for range in "${INTRANET_RANGES[@]}"; do
    iptables -I FORWARD -i br-octopus -d "$range" -j ACCEPT
done
iptables -A FORWARD -i br-octopus -j REJECT

echo "✓ iptables 规则已配置（内网放行，公网封锁）"
echo "内网段: ${INTRANET_RANGES[*]}"

# 阻止 sandbox 容器访问宿主机敏感端口
for PORT in 3306 6379 19791 18790; do
  iptables -C DOCKER-USER -s 172.30.0.0/16 -p tcp --dport $PORT -j REJECT 2>/dev/null || \
    iptables -I DOCKER-USER -s 172.30.0.0/16 -p tcp --dport $PORT -j REJECT
done

echo "✓ DOCKER-USER 链已配置（阻止容器访问 MySQL/Redis/Gateway 端口）"

# 持久化 iptables 规则
if command -v iptables-save &>/dev/null; then
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4
  echo "[sandbox] iptables 规则已持久化到 /etc/iptables/rules.v4"
fi
