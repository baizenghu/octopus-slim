# 部署检查清单

## 首次部署

- [ ] 安装 Node.js >= 22、pnpm >= 9、Docker
- [ ] 创建 MySQL 数据库: `CREATE DATABASE octopus_enterprise CHARACTER SET utf8mb4;`
- [ ] 复制 `.env.example` -> `.env`，填入以下必填项：
  - `DATABASE_URL` — MySQL 连接串
  - `JWT_SECRET` — 至少 32 字符随机串 (`openssl rand -base64 48`)
  - `JWT_REFRESH_SECRET` — 同上
  - `INTERNAL_API_TOKEN` — API 内部认证 (`openssl rand -hex 24`)
  - `DB_ENCRYPTION_KEY` — 数据库字段加密 (`openssl rand -hex 32`)
- [ ] 执行 `./setup.sh`
- [ ] 执行 `pnpm db:migrate`（或开发环境 `pnpm db:push`）
- [ ] 执行 `./start.sh` 或 `pm2 start ecosystem.config.js`
- [ ] 验证: `curl http://localhost:18790/health` -> `{"status":"ok"}`
- [ ] 访问管理后台 `http://localhost:3001` 并创建管理员账号

## 升级部署

- [ ] `git pull` 拉取最新代码
- [ ] `pnpm install` 更新依赖
- [ ] `pnpm prisma generate` 重新生成 Prisma Client
- [ ] `pnpm db:migrate` 应用新迁移
- [ ] `pnpm build` 重新构建
- [ ] 重启服务: `pm2 restart octopus` 或 `systemctl restart octopus`
- [ ] 验证健康检查

## 故障排查

| 现象 | 检查 |
|------|------|
| health 返回 degraded | 检查 MySQL 连接和引擎进程 |
| 登录失败 | 检查 LDAP 配置或 `MOCK_LDAP=true` |
| IM 消息不通 | 检查飞书/微信 Token 和网络连通性 |
| MCP 工具不可用 | 检查 `sandbox.tools.allow: ["*"]` 配置 |
| Skill 执行失败 | 检查 Docker sandbox 和 Python 依赖 |
