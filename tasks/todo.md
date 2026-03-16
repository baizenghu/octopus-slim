# 批次 A：审计补全 ✅ 已完成

---

# 批次 B：安全加固

## 影响分析

- **改动文件**：6 个文件（types.ts、AuditMiddleware.ts、admin.ts、IMRouter.ts、IMService.ts、index.ts）
- **现有功能**：纯增量改动，ROUTE_ACTION_MAP 追加规则不影响已有 6 条匹配
- **数据库**：无需迁移，action 字段 VARCHAR(255) 足够
- **IMRouter**：新增第 7 个可选参数 `auditLogger?: AuditLogger`，向后兼容

## 实施步骤

- [ ] **Step 1**: `packages/audit/src/types.ts` — 新增 ~35 个 AuditAction 枚举值（IM/Agent/MCP/Skill/File/Scheduler/Quota/DB 等）
- [ ] **Step 2**: `packages/audit/src/AuditMiddleware.ts` — 扩展 ROUTE_ACTION_MAP，新增 ~35 条路由匹配规则（注意具体 pattern 排前面）
- [ ] **Step 3**: `apps/server/src/routes/admin.ts` — `_auditLogger` → `auditLogger`（去下划线前缀）
- [ ] **Step 4**: `apps/server/src/services/im/IMRouter.ts` — 注入 auditLogger，handleBind/handleUnbind/handleAgentSwitch 手动记录审计
- [ ] **Step 5**: `apps/server/src/services/im/IMService.ts` — 透传 auditLogger 给 IMRouter
- [ ] **Step 6**: `apps/server/src/index.ts` — IMService 构造时传入 auditLogger
- [ ] **Step 7**: TypeScript 编译验证 `cd apps/server && npx tsc --noEmit`

## 规则顺序注意

- `/api/skills/personal/upload` 排在 `/api/skills/upload` 前面
- `/api/admin/users/:id/unlock` 排在 `/api/admin/users`（POST）前面
- 单级路径 pattern 用 `$` 锚定尾部，避免误匹配深层路径

## 不涉及

- GET 读操作不审计（频率高、价值低）
- `/health` 不审计
- AuditLogger.ts 写入逻辑不改
- 数据库 schema 不改
