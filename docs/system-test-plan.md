# Octopus 企业平台系统测试计划

**日期**: 2026-03-13
**目标**: 全面验证系统各模块功能正常

---

## 测试前置条件

- 服务已启动（Enterprise Gateway :18790, Native Gateway :19791, Admin Console :3001）
- 数据库 `octopus_enterprise` 可连接（用户 `octopus`）
- 测试用户: admin / baizh

---

## 测试模块

### Module 1: 基础设施
- [ ] 1.1 MySQL 新库连接验证
- [ ] 1.2 服务端口可达性（18790, 19791, 3001）
- [ ] 1.3 健康检查端点

### Module 2: 认证系统
- [ ] 2.1 登录（正确/错误密码）
- [ ] 2.2 Token 刷新
- [ ] 2.3 获取当前用户信息
- [ ] 2.4 未授权访问拒绝

### Module 3: 用户管理（Admin）
- [ ] 3.1 用户列表
- [ ] 3.2 用户创建
- [ ] 3.3 用户更新
- [ ] 3.4 Dashboard 统计

### Module 4: Agent 管理
- [ ] 4.1 Agent 列表（含自动创建默认 agent）
- [ ] 4.2 Agent 创建/更新/删除
- [ ] 4.3 Agent 配置文件读写

### Module 5: 对话系统
- [ ] 5.1 非流式对话
- [ ] 5.2 流式对话（SSE）
- [ ] 5.3 会话列表
- [ ] 5.4 历史记录
- [ ] 5.5 终止对话

### Module 6: 文件管理
- [ ] 6.1 文件上传
- [ ] 6.2 文件列表
- [ ] 6.3 文件下载（Token 方式）
- [ ] 6.4 路径穿越防护

### Module 7: MCP 管理
- [ ] 7.1 企业 MCP 列表
- [ ] 7.2 MCP 连接测试
- [ ] 7.3 MCP 工具列表

### Module 8: Skill 系统
- [ ] 8.1 Skill 列表
- [ ] 8.2 Skill 执行（bid-document extract）
- [ ] 8.3 Skill 执行（ppt-generator）

### Module 9: 数据库连接
- [ ] 9.1 连接列表
- [ ] 9.2 连接创建/删除

### Module 10: 定时任务
- [ ] 10.1 任务列表
- [ ] 10.2 任务创建/删除

### Module 11: 审计日志
- [ ] 11.1 日志查询
- [ ] 11.2 统计信息

### Module 12: 插件系统
- [ ] 12.1 enterprise-audit 插件加载
- [ ] 12.2 enterprise-mcp 插件加载（MCP 工具注册）
- [ ] 12.3 memory-lancedb-pro 插件加载
