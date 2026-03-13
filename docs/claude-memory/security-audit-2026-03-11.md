# 安全整改 + 系统测试记录（2026-03-11）

## 一、安全整改提交（20+ commits）

### P0 — 认证与授权
- JWT refreshSecret 独立密钥 + kid 版本标识
- 登录失败锁定（Redis + 内存 fallback）
- 安全事件实时监控（SecurityMonitor）

### P1 — 错误处理与默认值
- 全路由统一错误处理（chat/skills/mcp/agents/scheduler/audit/quotas 共 48 个 catch → next(err)）
- ecosystem.config.js 移除弱 token fallback，未设置时 process.exit(1)
- admin.ts 创建用户必须提供密码（不再默认 password123）

### P2 — XSS 与文件安全
- SVG 强制 attachment 下载防 XSS
- HTML/HTM 强制 attachment 下载防 XSS（03-11 补充）
- Gateway Token 轮换（openssl rand -hex 32）

### P3 — CI/运维
- GitHub Actions security-audit.yml（Node/Python/Docker/Secrets 四项扫描）
- Prisma fail-fast + graceful shutdown
- MockLDAP passwordHash 为空时使用默认密码

### 杂项修复（03-11）
- 流式断连后 streamDone = true 防止 res.write 异常
- 删除 chat.ts 硬编码 baizh 用户名替换（调试残留）

## 二、系统测试发现（验证后）

### 已确认的真实问题（已修复或评估为不需修复）

| 问题 | 严重度 | 状态 |
|------|--------|------|
| 流式断连后 res.write 异常 | High | ✅ 已修复 |
| 硬编码 baizh 替换 | Medium | ✅ 已修复 |
| HTML preview XSS | Medium | ✅ 已修复 |
| syncAllowAgents 重试无上限 | High | 不修（触发条件苛刻） |
| callAgent 监听器泄漏 | High | 不修（边缘场景，重连后无害） |
| sessionPrefs 跨用户共享 tmp key | Medium | 不修（影响微乎其微） |
| 心跳频率无最小间隔 | Medium | 不修（管理手段可控） |
| admin 删除 ID 校验顺序 | Low | 不修（findUnique 已兜底） |
| Skill process 模式无 uid 隔离 | P1 安全 | 不修（生产用 Docker sandbox） |

### 已确认的误报

| 原始发现 | 误报原因 |
|---------|---------|
| ownership startsWith 前缀碰撞 | userId 不含下划线，下划线分隔符防护 |
| deepMerge null 崩溃 | && 短路求值已规避 typeof null === 'object' |
| 下载 token 过期绕过 | 过期 token 是随机 hex 非 JWT，验证会拒绝 |
| configApplyFull 静默返回 | 第 5 次失败正确 throw |
| 跨用户记忆泄漏 | agent ID 含用户前缀，scopes 天然隔离 |
| 文件操作未 realpath | WorkspaceManager.validatePath 已做 fsp.realpath |

## 三、测试覆盖差距

### 现有测试（9 文件，70+ 用例）
- enterprise-auth: AuthService.test.ts, TokenManager.test.ts
- enterprise-audit: AuditLogger.test.ts
- enterprise-workspace: WorkspaceManager.test.ts
- gateway: OpenClawBridge.test.ts, OpenClawBridge.integration.test.ts, HeartbeatForwarder.test.ts, scheduler-heartbeat.test.ts
- smoke.test.ts

### P0 需补充（安全关键，零测试）
- middleware/auth.ts, utils/ownership.ts, utils/crypto.ts, utils/url-validator.ts, utils/deep-merge.ts
- AuthService 登录锁定机制

### P1 需补充（核心业务，零测试）
- chat 斜杠命令, QuotaManager, SkillExecutor, SkillManager
- 路由集成测试（agents/admin/scheduler/chat）
