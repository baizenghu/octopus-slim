# Octopus Enterprise Skill 开发指南

> 适用于企业管理员和普通用户开发自定义 Skill
> 编写时间：2026-03-04

---

## 一、概述

Skill 是一段可被 AI 助手调用的脚本（Python / Node.js / Bash），运行在 Docker 沙箱中，与宿主机隔离。

| 类型 | 上传者 | 审批 | 可见范围 | 存储位置 |
|------|--------|------|----------|----------|
| 企业级 | 管理员 | 需管理员审批 | 所有用户 | `data/skills/{skillId}/` |
| 个人 | 用户自己 | 扫描通过自动激活 | 仅上传者 | `data/users/{userId}/workspace/skills/{skillId}/` |

---

## 二、Skill 目录结构

### 最简结构

```
my-skill/
├── SKILL.md          # 必须：技能描述 + AI 操作指南
└── main.py           # 必须：入口脚本
```

### Python Skill（带依赖）

```
my-skill/
├── SKILL.md
├── main.py
├── requirements.txt  # 可选：依赖声明（仅供参考）
└── packages/         # 必须：依赖包目录（pip install -t 生成）
    ├── requests/
    ├── pymysql/
    └── ...
```

### Node.js Skill（带依赖）

```
my-skill/
├── SKILL.md
├── package.json
├── main.js
└── node_modules/     # 必须：npm install 生成的依赖
    ├── axios/
    ├── mysql2/
    └── ...
```

---

## 三、SKILL.md 编写规范

SKILL.md 是 Skill 的核心文件，AI 会完整读取它来了解如何使用你的 Skill。

### 格式

```markdown
---
name: 数据库查询助手
description: 连接 MySQL 数据库执行查询并返回结果
version: 1.0.0
script_path: main.py
---

## 使用方法

当用户需要查询数据库时，运行此技能的入口脚本。

### 参数说明

- `--host` : 数据库地址（默认 localhost）
- `--port` : 端口（默认 3306）
- `--db`   : 数据库名
- `--query`: SQL 查询语句

### 示例

查询用户表前 10 条记录：

python3 main.py --host localhost --port 3306 --db mydb --query "SELECT * FROM users LIMIT 10"

### 输出

查询结果以 JSON 格式输出到 stdout。
```

### frontmatter 字段

| 字段 | 必须 | 说明 |
|------|------|------|
| `name` | 是 | 技能名称，用于显示和检索 |
| `description` | 是 | 一句话描述功能 |
| `version` | 否 | 版本号，默认 1.0.0 |
| `script_path` | 否 | 入口脚本相对路径，默认自动检测 |

---

## 四、Python Skill 开发

### 4.1 沙箱预装包

以下包已预装在沙箱中，可直接 `import`，无需打包：

- **数据科学**: pandas, numpy, scipy, matplotlib, seaborn
- **文件处理**: openpyxl (Excel)
- **数据库驱动**: PyMySQL, mysqlclient, psycopg2

### 4.2 使用额外依赖

如果需要沙箱未预装的包，用 `packages/` 目录打包：

```bash
# 在开发机上
cd my-skill/
pip install -r requirements.txt -t ./packages/
```

上传后系统会自动检测 `packages/` 目录，执行时自动设置 `PYTHONPATH`。

### 4.3 开发示例

**main.py**：
```python
#!/usr/bin/env python3
"""数据库查询 Skill"""
import argparse
import json
import pymysql

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='localhost')
    parser.add_argument('--port', type=int, default=3306)
    parser.add_argument('--user', default='root')
    parser.add_argument('--password', default='')
    parser.add_argument('--db', required=True)
    parser.add_argument('--query', required=True)
    args = parser.parse_args()

    conn = pymysql.connect(
        host=args.host,
        port=args.port,
        user=args.user,
        password=args.password,
        database=args.db,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cursor:
            cursor.execute(args.query)
            rows = cursor.fetchall()
            print(json.dumps(rows, ensure_ascii=False, default=str))
    finally:
        conn.close()

if __name__ == '__main__':
    main()
```

### 4.4 环境变量

Skill 运行时可访问以下环境变量：

| 变量 | 值 | 说明 |
|------|---|------|
| `WORKSPACE_PATH` | `/workspace` | 用户工作空间（可读写） |
| `OUTPUTS_PATH` | `/workspace/outputs` | 输出文件目录 |
| `SKILL_DIR` | `/workspace/skills/{id}/` 或 `/opt/skills/{id}/` | Skill 代码目录 |
| `PYTHONPATH` | `{SKILL_DIR}/packages` | 自动设置（仅当存在 packages/ 时） |

---

## 五、Node.js Skill 开发

### 5.1 依赖处理

Node.js 的 `require()` 会自动从脚本同级的 `node_modules/` 查找依赖，不需要额外配置。

```bash
# 在开发机上
cd my-skill/
npm install
```

打包时直接把 `node_modules/` 包含进 zip 即可。

### 5.2 开发示例

**main.js**：
```javascript
const mysql = require('mysql2/promise');

async function main() {
    const args = process.argv.slice(2);
    // 简单的参数解析
    const host = getArg(args, '--host') || 'localhost';
    const db = getArg(args, '--db');
    const query = getArg(args, '--query');

    const conn = await mysql.createConnection({ host, database: db });
    const [rows] = await conn.execute(query);
    console.log(JSON.stringify(rows, null, 2));
    await conn.end();
}

function getArg(args, name) {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : null;
}

main().catch(err => {
    console.error(err.message);
    process.exit(1);
});
```

---

## 六、打包与上传

### 6.1 打包为 zip

```bash
cd my-skill/
zip -r ../my-skill.zip .
```

**注意**：
- zip 内应直接包含 `SKILL.md`，不要多套一层目录（系统会自动处理单层包装）
- `packages/` 或 `node_modules/` 必须在 zip 根目录下

### 6.2 上传

**个人 Skill**（普通用户）：
- 打开 Admin Console → 技能管理 → 上传个人技能
- 或调用 API：`POST /api/skills/personal/upload`（multipart/form-data，字段名 `file`）

**企业级 Skill**（管理员）：
- 打开 Admin Console → 技能管理 → 上传企业技能
- 或调用 API：`POST /api/skills/upload`

### 6.3 上传响应

系统会自动检测依赖结构并在响应中提示：

| 检测到 | 提示 |
|--------|------|
| `packages/` 目录 | 已检测到依赖，执行时自动设置 PYTHONPATH |
| `node_modules/` 目录 | 已检测到依赖，Node.js 依赖就绪 |
| 仅 `requirements.txt` | ⚠️ 缺少 packages/ 目录，建议 `pip install -t ./packages/` |
| 仅 `package.json` | ⚠️ 缺少 node_modules/，建议 `npm install` |

---

## 七、沙箱执行环境

### 运行环境

| 项目 | 版本 |
|------|------|
| OS | Ubuntu 22.04 |
| Python | 3.11 |
| Node.js | 20 LTS |
| 用户 | sandbox (uid=2000) |

### 限制

| 限制 | 说明 |
|------|------|
| 网络 | 仅内网（`octopus-internal`），无法访问公网 |
| 文件系统 | 只能读写 `/workspace`，Skill 代码目录只读 |
| 执行时间 | 默认超时 60 秒 |
| 输出大小 | stdout/stderr 各 1MB，总截断 100KB |

### 网络访问

沙箱容器处于 `octopus-internal` Docker 网络中，可以访问同网络的服务：

- MySQL: `172.30.0.x:3306`（具体 IP 取决于 docker-compose 配置）
- Redis: `172.30.0.x:6379`

如需访问宿主机服务，使用 Docker 网关地址 `172.30.0.1`。

---

## 八、调试技巧

### 本地测试

在上传前先在本地测试脚本：

```bash
# Python
cd my-skill/
PYTHONPATH=./packages python3 main.py --db mydb --query "SELECT 1"

# Node.js
cd my-skill/
node main.js --db mydb --query "SELECT 1"
```

### 沙箱内测试

管理员可以直接在沙箱容器中测试：

```bash
# 进入沙箱容器
docker run -it --rm \
  -v /path/to/workspace:/workspace \
  --network octopus-internal \
  octopus-sandbox:enterprise bash

# 在容器内
PYTHONPATH=/workspace/skills/my-skill/packages \
  python3 /workspace/skills/my-skill/main.py --help
```

---

## 九、常见问题

### Q: ModuleNotFoundError: No module named 'xxx'

**A**: 依赖包未打包。运行 `pip install -r requirements.txt -t ./packages/` 后重新打包上传。

### Q: 上传后提示"安全扫描未通过"

**A**: 检查代码中是否有危险操作（如 `os.system`、`subprocess.Popen`），安全扫描器会标记这些。如确实需要，联系管理员手动审批。

### Q: 执行超时

**A**: 默认超时 60 秒。优化脚本性能，或在 SKILL.md 中注明预期执行时间，让管理员调整超时配置。

### Q: 如何访问用户上传的文件？

**A**: 用户上传的文件保存在 `/workspace/files/` 目录下，脚本中用 `os.environ['WORKSPACE_PATH']` 获取工作空间路径。

### Q: packages/ 目录很大怎么办？

**A**: zip 上传限制 50MB。如果依赖过大，可以：
1. 只打包真正需要的包（去掉 `*.dist-info`、`__pycache__` 等）
2. 联系管理员将常用大包（如 torch）预装到沙箱镜像中
