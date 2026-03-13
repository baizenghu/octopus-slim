#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE="octopus-sandbox:enterprise"

echo "构建 $IMAGE ..."
docker build -t "$IMAGE" "$SCRIPT_DIR"
echo "✓ 构建完成: $IMAGE"

# 基础验证
echo "验证镜像..."
docker run --rm "$IMAGE" python3 -c "import pandas, numpy, matplotlib; print('Python OK')"
docker run --rm "$IMAGE" node -e "console.log('Node OK')"
echo "✓ 镜像验证通过"
