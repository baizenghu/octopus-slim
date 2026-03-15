# 飞书文件消息发送设计

> 日期: 2026-03-15
> 状态: Draft

## 1. 背景与问题

当前飞书 IM 集成（`FeishuAdapter`）仅支持发送纯文本消息（`msg_type: 'text'`）。当 Agent 生成文件（如 HTML 演示文稿、Excel 报表等）后，无法通过飞书直接发送给用户，只能提示用户去 Web 端下载。

## 2. 设计目标

Agent 生成文件后，自动通过飞书文件消息发送给用户。超过 10MB 的文件提示用户到 Web 端下载。

## 3. 改动范围

### 3.1 `IMAdapter.ts` — 接口新增可选方法

新增 `sendFile` 可选方法：

```typescript
sendFile?(imUserId: string, filePath: string, fileName: string): Promise<void>;
```

### 3.2 `FeishuAdapter.ts` — 实现文件发送

新增 `sendFile` 方法，两步操作：

1. **上传文件到飞书**：调用飞书 `im/v1/files` API，`file_type` 为 `stream`，获取 `file_key`
2. **发送文件消息**：调用 `im/v1/messages`，`msg_type` 为 `file`，`content` 包含 `file_key`

```typescript
async sendFile(imUserId: string, filePath: string, fileName: string): Promise<void> {
  // 1. 上传文件到飞书
  const fileStream = fs.createReadStream(filePath);
  const uploadRes = await this.client.im.v1.file.create({
    data: {
      file_type: 'stream',
      file_name: fileName,
      file: fileStream,
    },
  });
  const fileKey = uploadRes.data?.file_key;
  if (!fileKey) throw new Error('飞书文件上传失败');

  // 2. 发送文件消息
  await this.client.im.v1.message.create({
    params: { receive_id_type: 'open_id' },
    data: {
      receive_id: imUserId,
      msg_type: 'file',
      content: JSON.stringify({ file_key: fileKey }),
    },
  });
}
```

### 3.3 `IMRouter.ts` — Agent 回复时自动发文件

在 Agent 回复处理逻辑中，检测 `outputFiles`，自动发送文件：

```
Agent callAgent() 回调
  → 收到 text_delta → 累积文本
  → 收到 done → 发送文本回复
  → 检查 outputFiles 列表（从 agent 回复中提取）
    → 遍历每个文件：
      → 文件 ≤ 10MB → adapter.sendFile(imUserId, filePath, fileName)
      → 文件 > 10MB → adapter.sendText(imUserId, "文件 {fileName} 过大({size}MB)，请到 Web 端下载")
```

### 3.4 outputFiles 的来源

Agent 回复中文件信息的获取方式：
- Agent 使用 `write_file` 工具写入 `outputs/` 目录后，回复文本中通常会提到文件路径
- IMRouter 在 agent 回复完成后，扫描该 agent workspace 的 `outputs/` 目录，对比会话开始前的文件列表，找出**新增文件**
- 或者从 DB 的 `GeneratedFile` 表查询该 session 产生的文件

## 4. 文件大小限制

| 条件 | 行为 |
|------|------|
| 文件 ≤ 10MB | 飞书文件消息直接发送 |
| 文件 > 10MB | 发文本提示"文件过大，请到 Web 端下载" |
| 飞书上传失败 | 发文本提示"文件发送失败"，不阻塞文本回复 |

## 5. 不改的地方

| 模块 | 原因 |
|------|------|
| `files.ts` 路由 | 不需要下载链接 |
| Web 前端 | 不涉及 |
| Agent 工具系统 | Agent 生成文件的方式不变 |
| 数据库 schema | 不需要新增表 |

## 6. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 飞书 `im/v1/files` API 需要应用权限 | 确认自建应用已有 `im:resource` 权限 |
| 文件上传超时 | 设置合理的超时时间（30s），失败发文本提示 |
| 并发文件发送 | 串行发送，避免飞书 API 限流 |
