# 部署踩坑细节

## 已记录的坑

### 2026-02-24: 升级 openclaw 后 gateway 启动 500
- 现象: 登录提示 Internal Server Error
- 根因: `npm update -g openclaw` 触发 `node_modules` 重装，`packages/enterprise-*/dist/` 被清理
- 解决: 重新构建所有共享包 `for pkg in packages/enterprise-*/; do (cd "$pkg" && npx tsc); done`
- enterprise-auth 有 TS 编译错误（LDAP callback 参数缺 `any` 类型），需手动修复
- 已更新到避坑指南

## 待观察的潜在坑
- Prisma engine 二进制在内网可能无法下载
- openclaw 大版本升级可能破坏 WebSocket RPC 协议
- `openclaw.json` 被 openclaw 自动重写（`meta.lastTouchedVersion` 等字段会被覆盖）
