# Phase 8: 验证和测试

> **状态:** 待执行 | **预估:** 4-6h | **依赖:** 所有 Phase 完成

---

## Task 8.1: 全面编译验证

```bash
cd /home/baizh/octopus
pnpm install
pnpm typecheck    # 所有包 tsc --noEmit
```

**期望结果：** 零编译错误

**常见问题：**
- 包间引用路径不对 → 检查 package.json 中的 workspace 依赖
- 类型缺失 → 检查 @types/* 依赖是否安装
- Prisma 客户端未生成 → 运行 `npx prisma generate`

---

## Task 8.2: 迁移测试用例

从 `openclaw-enterprise/apps/gateway/src/**/*.test.ts` 和 `tests/` 复制测试，替换品牌引用。

```bash
# 复制测试
cp -r /home/baizh/openclaw-enterprise/tests /home/baizh/octopus/tests
cp /home/baizh/openclaw-enterprise/vitest.config.ts /home/baizh/octopus/

# 品牌替换
find tests/ -name "*.ts" -exec sed -i 's/@openclaw-enterprise\//@octopus\//g' {} +
find tests/ -name "*.ts" -exec sed -i 's/OPENCLAW_/OCTOPUS_/g' {} +
find tests/ -name "*.ts" -exec sed -i 's/OpenClaw/Octopus/g' {} +
find tests/ -name "*.ts" -exec sed -i 's/openclaw/octopus/g' {} +

# 运行测试
pnpm test
```

**期望结果：** 所有测试通过（可能需要调整 mock 和 fixture）

---

## Task 8.3: 端到端验证

```bash
./start.sh start

# 验证清单：
# □ 1. 引擎初始化成功（日志无 error）
# □ 2. Plugin 加载成功（audit, mcp, memory-lancedb-pro）
# □ 3. Agent 创建正常（通过 Admin Console 创建）
# □ 4. 对话正常（发送消息，收到 AI 回复）
# □ 5. Admin Console 可访问（http://localhost:3001）
# □ 6. 审计日志正常写入（检查 data/audit-logs/）
# □ 7. Docker sandbox 工作（exec 工具在容器内执行）
# □ 8. Skill 执行正常（run_skill 工具）
# □ 9. 定时任务正常（cron 创建/列表/删除）
# □ 10. 会话管理正常（列表/删除/重置）

./start.sh stop
```

---

## Task 8.4: 搜索残留的 openclaw 引用

```bash
# 搜索所有源码和配置文件
grep -ri "openclaw" \
  --include="*.ts" --include="*.tsx" \
  --include="*.json" --include="*.md" \
  --include="*.sh" --include="*.yaml" --include="*.yml" \
  --include="*.mjs" --include="*.js" \
  --include="*.prisma" --include="*.sql" \
  --include="*.service" --include="*.toml" \
  --exclude-dir=node_modules \
  --exclude-dir=.git \
  --exclude-dir=dist \
  .

# 期望：零结果
# 如果有残留，逐个替换并 commit
```

**Commit（如有修复）：**
```bash
git add -A
git commit -m "fix: 清除残留的 openclaw 引用"
```

---

## 最终确认清单

- [ ] `pnpm typecheck` 零错误
- [ ] `pnpm test` 全部通过
- [ ] `./start.sh start` 正常启动
- [ ] Agent 对话端到端正常
- [ ] `grep -ri openclaw .` 零结果（排除 node_modules/.git）
- [ ] Git 历史干净，所有变更已 commit
- [ ] GitHub 仓库已推送
