# 生产环境安全配置清单

> 部署到生产环境前，必须逐项检查并完成以下配置。

---

## 1. 必须关闭的开发标志

以下配置项仅用于开发/测试环境，**生产环境必须关闭或移除**：

| 配置项 | 所在文件 | 开发值 | 生产值 | 说明 |
|--------|----------|--------|--------|------|
| `gateway.controlUi.allowInsecureAuth` | `octopus.json` | `true` | `false` 或删除 | 允许不安全的认证方式（跳过设备验证） |
| `gateway.controlUi.dangerouslyDisableDeviceAuth` | `octopus.json` | `true` | `false` 或删除 | 禁用设备认证，任何人可直接访问 native gateway |
| `sandbox.docker.dangerouslyAllowReservedContainerTargets` | `octopus.json` | `true` | `false` | 允许挂载到容器保留路径 |
| `sandbox.docker.dangerouslyAllowExternalBindSources` | `octopus.json` | `true` | `false` | 允许挂载宿主机任意路径到容器 |
| `MOCK_LDAP=true` | `.env` | `true` | `false` 或删除 | 启用 Mock LDAP（内存用户，无需真实 LDAP） |

---

## 2. 必须替换的敏感配置

以下配置包含默认值或示例密钥，**生产环境必须替换为真实值**：

### .env 文件

```bash
# JWT 密钥 — 必须替换为随机强密钥（>= 32 字符）
JWT_SECRET=<生成方式: openssl rand -base64 48>

# 数据库密码 — 必须替换
DATABASE_URL=mysql://<user>:<strong-password>@<host>:3306/octopus_enterprise

# Redis 密码（如启用）
REDIS_PASSWORD=<strong-password>

# Native Gateway Token — 必须替换（Enterprise Gateway 与 Native Gateway 通信凭证）
OCTOPUS_GATEWAY_TOKEN=<生成方式: openssl rand -hex 32>
```

### octopus.json

```jsonc
{
  "gateway": {
    "auth": {
      "mode": "token",
      // 必须与 .env 中 OCTOPUS_GATEWAY_TOKEN 一致
      "token": "<与 .env 中相同的值>"
    }
  },
  "models": {
    "providers": {
      "custom-api-deepseek-com": {
        // 替换为生产环境 API Key
        "apiKey": "<production-api-key>"
      }
    }
  },
  "plugins": {
    "entries": {
      "memory-lancedb-pro": {
        "config": {
          "embedding": {
            // 替换为生产环境 Embedding API Key
            "apiKey": "<production-embedding-api-key>"
          }
        }
      },
      "enterprise-audit": {
        "config": {
          // 替换为生产环境数据库连接
          "databaseUrl": "mysql://<user>:<password>@<host>:3306/octopus_enterprise"
        }
      },
      "enterprise-mcp": {
        "config": {
          "databaseUrl": "mysql://<user>:<password>@<host>:3306/octopus_enterprise"
        }
      }
    }
  }
}
```

---

## 3. octopus.json 生产环境推荐配置

```jsonc
{
  "gateway": {
    "port": 19791,
    "mode": "local",
    "bind": "loopback",  // 仅监听 127.0.0.1，通过 nginx 反向代理暴露
    "controlUi": {
      "allowedOrigins": [
        // 仅允许生产域名
        "https://your-domain.com"
      ]
      // 不设置 allowInsecureAuth 和 dangerouslyDisableDeviceAuth（默认 false）
    },
    "auth": {
      "mode": "token",
      "token": "<strong-random-token>"
    },
    "tailscale": {
      "mode": "off"
    },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": false },
        "responses": { "enabled": false }
      }
    }
  },
  "tools": {
    "exec": {
      "host": "sandbox",     // 强制 Docker sandbox 执行
      "security": "full"
    },
    "fs": {
      "workspaceOnly": true  // 文件操作限制在 workspace 内
    }
  },
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "workspaceAccess": "rw",
        "scope": "agent",    // 每个 agent 独立容器
        "docker": {
          "image": "octopus-sandbox:enterprise"
          // 生产环境不设置 dangerouslyAllow* 选项
        }
      },
      "subagents": {
        "maxConcurrent": 3,
        "maxSpawnDepth": 2,
        "maxChildrenPerAgent": 5,
        "archiveAfterMinutes": 120,
        "runTimeoutSeconds": 600
      }
    }
  },
  "skills": {
    "load": {
      "extraDirs": ["/opt/octopus/data/skills"]
    }
  }
}
```

---

## 4. iptables 网络规则检查清单

Docker sandbox 容器需要限制网络访问，防止 agent 通过容器内 bash 访问外部服务。

### 4.1 创建隔离网络

```bash
# 创建 bridge 网络（固定子网）
docker network create \
  --driver bridge \
  --subnet 172.30.0.0/16 \
  octopus-internal
```

### 4.2 封锁容器出站流量

```bash
# 禁止 octopus-internal 网络的容器访问外网
# 获取 bridge 接口名
BRIDGE_IF=$(docker network inspect octopus-internal -f '{{.Id}}' | cut -c1-12)
BRIDGE_IF="br-${BRIDGE_IF}"

# 封锁所有出站（除了与宿主机通信）
iptables -I DOCKER-USER -i ${BRIDGE_IF} -j DROP
iptables -I DOCKER-USER -i ${BRIDGE_IF} -d 172.30.0.0/16 -j ACCEPT
iptables -I DOCKER-USER -i ${BRIDGE_IF} -d 127.0.0.0/8 -j ACCEPT

# 允许容器访问宿主机上的必要服务（如需要）
# iptables -I DOCKER-USER -i ${BRIDGE_IF} -d <host-ip> -p tcp --dport 3306 -j ACCEPT
```

### 4.3 验证检查

```bash
# 确认规则已生效
iptables -L DOCKER-USER -n -v

# 从容器内测试（应超时/拒绝）
docker run --rm --network octopus-internal octopus-sandbox:enterprise \
  curl -s --connect-timeout 3 https://www.baidu.com && echo "FAIL: 外网可达" || echo "OK: 外网不可达"

# 确认容器可以访问宿主机（如果需要数据库连接）
docker run --rm --network octopus-internal octopus-sandbox:enterprise \
  curl -s --connect-timeout 3 http://172.30.0.1:3306 || echo "OK: 端口不通是正常的（MySQL 不接受 HTTP）"
```

### 4.4 持久化规则

```bash
# Debian/Ubuntu
apt install iptables-persistent
netfilter-persistent save

# CentOS/RHEL
service iptables save
```

---

## 5. LDAP 生产配置

将 `.env` 中的 Mock LDAP 替换为真实 LDAP：

```bash
# 关闭 Mock LDAP
MOCK_LDAP=false

# 真实 LDAP 配置
LDAP_URL=ldap://your-ldap-server:389
LDAP_BIND_DN=cn=readonly,dc=company,dc=com
LDAP_BIND_PASSWORD=<ldap-bind-password>
LDAP_SEARCH_BASE=ou=users,dc=company,dc=com
LDAP_SEARCH_FILTER=(uid={{username}})
```

---

## 6. 部署前检查脚本

在部署前执行以下检查：

```bash
#!/bin/bash
# production-check.sh

echo "=== 生产环境安全检查 ==="

# 检查 .env 中是否有默认密钥
grep -q 'change-me\|password123\|dev-secret' .env && echo "[FAIL] .env 中包含默认密钥" || echo "[OK] .env 密钥已替换"

# 检查 octopus.json 中的开发标志
grep -q 'allowInsecureAuth.*true' .octopus-state/octopus.json && echo "[FAIL] allowInsecureAuth 未关闭" || echo "[OK] allowInsecureAuth 已关闭"
grep -q 'dangerouslyDisableDeviceAuth.*true' .octopus-state/octopus.json && echo "[FAIL] dangerouslyDisableDeviceAuth 未关闭" || echo "[OK] dangerouslyDisableDeviceAuth 已关闭"
grep -q 'dangerouslyAllow' .octopus-state/octopus.json && echo "[WARN] octopus.json 中包含 dangerouslyAllow 选项" || echo "[OK] 无 dangerouslyAllow 选项"

# 检查 Mock LDAP
grep -q 'MOCK_LDAP=true' .env && echo "[FAIL] Mock LDAP 仍在启用" || echo "[OK] Mock LDAP 已关闭"

# 检查 iptables 规则
iptables -L DOCKER-USER -n 2>/dev/null | grep -q 'DROP' && echo "[OK] iptables 规则已配置" || echo "[WARN] iptables DOCKER-USER 链无 DROP 规则"

# 检查 sandbox 镜像
docker image inspect octopus-sandbox:enterprise >/dev/null 2>&1 && echo "[OK] sandbox 镜像存在" || echo "[FAIL] sandbox 镜像不存在"

echo "=== 检查完成 ==="
```
