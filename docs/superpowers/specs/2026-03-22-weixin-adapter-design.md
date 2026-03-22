# 微信 IM 适配器设计文档

> 日期: 2026-03-22
> 状态: 已确认
> 扩展形式: Octopus IM WeixinAdapter（TypeScript，服务端）

---

## 一、背景与动机

### 问题

Octopus 企业版目前仅支持飞书 IM 渠道。国企用户日常使用微信沟通，无法通过微信与 AI Agent 交互。

### 灵感来源

OpenClaw 开源项目新增了微信插件 `@tencent-weixin/openclaw-weixin`（MIT 协议），通过 ilink bot API 接入个人微信，实现 long-poll 收消息 + HTTP 发消息。核心通信层可移植。

### 方案

将 OpenClaw 微信插件的 API 通信层移植为 Octopus 的 `WeixinAdapter`，实现 `IMAdapter` 接口，与现有 `FeishuAdapter` 平级。完全复用 `IMRouter` 的消息路由逻辑（`/bind`、`/agent`、`/cancel` 等），无需修改核心代码。飞书和微信可同时运行。

---

## 二、整体架构

```
管理员: ./start.sh weixin-login → 终端 QR 码 → 微信扫码 → token 保存到 data/weixin/
                                                              │
                                                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Octopus Enterprise Gateway                                         │
│                                                                      │
│  IMService                                                          │
│  ├── FeishuAdapter (WebSocket)  ← 飞书用户消息                      │
│  └── WeixinAdapter (long-poll)  ← 微信用户消息                      │
│          │                                                           │
│          ▼                                                           │
│  IMRouter (共享，复用)                                               │
│  ├── /bind 用户名 密码  → 认证 + 绑定 IMUserBinding                │
│  ├── /agent [名称]     → 切换 agent                                 │
│  ├── /cancel           → 取消任务                                   │
│  └── 普通消息          → routeToAgent() → callAgent()               │
│                                                                      │
│  数据存储                                                           │
│  ├── DB: IMUserBinding (channel='wechat', imUserId='xxx@im.wechat') │
│  └── File: data/weixin/account.json (bot token + baseUrl)           │
└──────────────────────────────────────────────────────────────────────┘
```

### 多渠道并存

- 飞书和微信同时运行，互不影响
- 同一用户可同时绑定飞书和微信
- `IMUserBinding` 表按 `channel` 字段区分（`feishu` / `wechat`）
- 从哪个渠道发消息就走哪个渠道回复

---

## 三、文件结构

```
apps/server/src/services/im/
├── IMAdapter.ts              # 已有，接口定义（不改）
├── IMRouter.ts               # 已有，消息路由（不改）
├── FeishuAdapter.ts          # 已有，飞书适配器（不改）
├── WeixinAdapter.ts          # 新增：微信适配器主文件（~300行）
└── weixin/
    ├── api.ts                # 新增：ilink bot API 封装（~200行）
    ├── cdn.ts                # 新增：CDN 文件上传（AES 加密 + 预签名上传）（~150行）
    ├── login.ts              # 新增：QR 码扫码登录流程（~100行）
    └── account.ts            # 新增：账号持久化读写（~80行）

scripts/
└── weixin-login.ts           # 新增：管理员扫码登录入口脚本（~40行）
```

### 修改的现有文件

| 文件 | 改动 | 行数 |
|------|------|------|
| `apps/server/src/services/im/IMService.ts` | 检查 `WEIXIN_ENABLED` 环境变量，创建并 attach WeixinAdapter | ~10行 |
| `start.sh` | 新增 `weixin-login` 子命令 | ~5行 |
| `.env.example` | 新增 `WEIXIN_ENABLED` 说明 | ~2行 |

---

## 四、模块详细设计

### 4.1 weixin/account.ts — 账号持久化

```typescript
// 数据结构
interface WeixinAccount {
  token: string;        // ilink bot token
  baseUrl: string;      // API base URL
  cdnBaseUrl: string;   // CDN 上传地址（默认 https://novac2c.cdn.weixin.qq.com/c2c）
  userId: string;       // bot 的微信用户 ID
  loginAt: string;      // 登录时间
}

// 存储路径
const WEIXIN_DIR = path.join(DATA_ROOT, 'weixin');
const ACCOUNT_PATH = path.join(WEIXIN_DIR, 'account.json');
const SYNC_BUF_PATH = path.join(WEIXIN_DIR, 'sync-buf.json');  // long-poll 游标持久化

// 核心函数
export function loadWeixinAccount(): WeixinAccount | null;
export function saveWeixinAccount(account: WeixinAccount): void;
export function isWeixinConfigured(): boolean;

// 游标持久化（防止重启后重放历史消息）
export function loadSyncBuf(): string;           // 读取游标，不存在返回 ''
export function saveSyncBuf(buf: string): void;  // 每次 poll 成功后写入
```

- 存储在 `data/weixin/` 目录，gitignore
- 原子写入（tmp + rename）
- `sync-buf.json` 存 long-poll 游标 `get_updates_buf`，重启后恢复避免消息重放

### 4.2 weixin/api.ts — ilink bot API 封装

移植自 OpenClaw `src/api/api.ts` + `src/messaging/send.ts` + `src/messaging/inbound.ts`：

```typescript
interface WeixinApiOptions {
  baseUrl: string;
  token: string;
  timeout?: number;
  abortSignal?: AbortSignal;   // 用于 stop() 时立即中断 long-poll
}

// --- 收消息 ---

export async function getUpdates(opts: WeixinApiOptions & {
  cursor: string;       // get_updates_buf，long-poll 游标
}): Promise<{
  msgs: WeixinMessage[];
  cursor: string;       // 更新后的游标
  errcode?: number;     // 业务错误码（-14 = session 过期）
}>;

// --- 发消息 ---

// 内部构造完整的 SendMessageReq（含 message_type, message_state, item_list, client_id 等）
export async function sendTextMessage(opts: WeixinApiOptions & {
  to: string;           // 接收者 ID (xxx@im.wechat)
  text: string;
  contextToken: string; // 上下文 token（从 getUpdates 消息中提取，必需）
}): Promise<{ messageId: string }>;

// --- 文件上传 ---
// 完整链路：读文件 → AES-ECB 加密计算 → getUploadUrl → CDN 上传 → sendMessage(media)
// 实现在 weixin/cdn.ts 中

export async function getUploadUrl(opts: WeixinApiOptions & {
  filekey: string;
  mediaType: number;
  toUserId: string;
  rawsize: number;
  rawfilemd5: string;
  // ... 其他 CDN 参数
}): Promise<{ uploadUrl: string; downloadEncryptedQueryParam: string }>;
```

**消息格式**（从 getUpdates 的 `item_list` 解析）：
```typescript
// 原始 API 返回的是 item_list 数组，包含 TEXT/IMAGE/VOICE/FILE/VIDEO 等类型
// 解析逻辑移植自 OpenClaw inbound.ts 的 bodyFromItemList()

interface WeixinMessage {
  msgId: string;             // 消息 ID（去重）
  fromUserId: string;        // 发送者 (xxx@im.wechat)
  text: string;              // 从 item_list 中提取的文本内容
  contextToken: string;      // 回复所需的上下文 token（必需）
  timestamp: number;
}

// V1 仅处理文本消息（item_list 中的 text_item）
// 图片/文件/语音暂不处理，记录 debug 日志
```

**关键实现细节**（移植自 OpenClaw）：
- 每次请求附带 `base_info: { channel_version }` 和 `X-WECHAT-UIN` header
- Authorization: `Bearer {token}`
- long-poll timeout: 35 秒（服务端 hold），支持 `AbortSignal` 立即中断
- 客户端超时按 `AbortError` 处理，返回空结果让调用方重试
- `sendTextMessage` 内部构造完整的 `SendMessageReq`（`message_type: BOT`, `message_state: FINISH`, 自动生成 `client_id`）

### 4.2b weixin/cdn.ts — CDN 文件上传

移植自 OpenClaw `src/cdn/cdn-upload.ts` + `src/cdn/aes-ecb.ts`：

```typescript
// 完整的文件发送链路：
// 1. 读取文件明文
// 2. 计算 MD5 + AES-128-ECB 加密大小（padding 计算）
// 3. 调用 getUploadUrl 获取 CDN 预签名上传地址
// 4. PUT 文件到 CDN（uploadBufferToCdn）
// 5. 返回 downloadEncryptedQueryParam 供 sendMessage 使用

export async function uploadAndSendFile(opts: {
  filePath: string;
  to: string;
  text?: string;
  apiOpts: WeixinApiOptions;
  cdnBaseUrl: string;
  contextToken: string;
}): Promise<{ messageId: string }>;

// AES-ECB padding 计算（不做实际加密，只计算加密后大小）
export function aesEcbPaddedSize(rawSize: number): number;
```

### 4.3 weixin/login.ts — 扫码登录

移植自 OpenClaw `src/auth/login-qr.ts`：

```typescript
export async function weixinLogin(opts?: {
  baseUrl?: string;     // 默认 ilink 服务地址
  verbose?: boolean;
}): Promise<void>;
```

流程：
1. `POST ilink/bot/startlogin` → 获取 QR URL + sessionKey
2. `qrcode-terminal` 在终端显示 QR 码
3. 轮询 `POST ilink/bot/waitlogin`（最长 480 秒）
4. 成功 → `saveWeixinAccount({ token, baseUrl, userId })`
5. 失败 → 输出错误信息和手动重试命令

### 4.4 WeixinAdapter.ts — 适配器主文件

```typescript
export class WeixinAdapter implements IMAdapter {
  readonly channel = 'wechat';

  private running = false;
  private abortController: AbortController | null = null;  // 用于 stop() 立即中断 long-poll
  private messageHandler: ((msg: IMIncomingMessage) => void) | null = null;
  private cursor = '';                    // long-poll 游标
  private retryCount = 0;
  private contextTokens = new Map<string, string>();  // imUserId → contextToken
  private processedMsgIds = new Set<string>();         // 消息去重
  private readonly MSG_DEDUP_MAX = 1000;

  constructor(private account: WeixinAccount) {
    // 启动时从文件恢复游标
    this.cursor = loadSyncBuf();
  }

  // --- IMAdapter 接口实现 ---

  async start(): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();
    this.pollLoop();  // 不 await，后台运行
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();  // 立即中断当前 long-poll 请求
  }

  async sendText(imUserId: string, text: string): Promise<void> {
    const contextToken = this.contextTokens.get(imUserId);
    if (!contextToken) {
      log.warn(`微信: 无法回复 ${imUserId}，缺少 contextToken（需等待用户发一条消息）`);
      return;  // 静默跳过，不抛异常
    }
    // Markdown → 纯文本（微信不渲染 Markdown）
    const plainText = markdownToPlainText(text);
    // 微信单条消息限 4000 字，超长自动分片
    const chunks = splitText(plainText, 4000);
    for (const chunk of chunks) {
      await sendTextMessage({
        baseUrl: this.account.baseUrl,
        token: this.account.token,
        to: imUserId,
        text: chunk,
        contextToken,
      });
    }
  }

  onMessage(handler: (msg: IMIncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  // deleteMessage 不实现（微信 bot 无法撤回用户消息）

  async sendFile(imUserId: string, filePath: string, fileName: string): Promise<void> {
    const contextToken = this.contextTokens.get(imUserId);
    if (!contextToken) {
      log.warn(`微信: 无法发送文件给 ${imUserId}，缺少 contextToken`);
      return;
    }
    await uploadAndSendFile({
      filePath,
      to: imUserId,
      apiOpts: { baseUrl: this.account.baseUrl, token: this.account.token },
      cdnBaseUrl: this.account.cdnBaseUrl,
      contextToken,
    });
  }

  // --- 内部方法 ---

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const result = await getUpdates({
          baseUrl: this.account.baseUrl,
          token: this.account.token,
          cursor: this.cursor,
          abortSignal: this.abortController?.signal,
        });

        // 检查 session 过期（errcode -14）
        if (result.errcode === -14) {
          log.error('微信 session 已过期，请执行 ./start.sh weixin-login 重新扫码');
          // 暂停 1 小时后重试
          await sleep(3600000);
          continue;
        }

        // 更新并持久化游标
        if (result.cursor) {
          this.cursor = result.cursor;
          saveSyncBuf(result.cursor);
        }
        this.retryCount = 0;  // 成功后重置

        for (const msg of result.msgs) {
          // 消息去重
          if (this.processedMsgIds.has(msg.msgId)) continue;
          this.processedMsgIds.add(msg.msgId);
          if (this.processedMsgIds.size > this.MSG_DEDUP_MAX) {
            // 清理旧消息 ID（保留最近一半）
            const ids = [...this.processedMsgIds];
            this.processedMsgIds = new Set(ids.slice(ids.length / 2));
          }

          // 缓存 contextToken 用于回复（必需字段）
          this.contextTokens.set(msg.fromUserId, msg.contextToken);

          // 转换为 IMIncomingMessage 交给 IMRouter
          this.messageHandler?.({
            channel: 'wechat',
            imUserId: msg.fromUserId,
            text: msg.text,
            messageId: msg.msgId,
          });
        }
      } catch (err) {
        if (!this.running) break;
        // AbortError 是正常停止，不重试
        if (err instanceof Error && err.name === 'AbortError') break;

        this.retryCount++;
        if (this.retryCount <= 3) {
          const wait = Math.min(2000 * Math.pow(2, this.retryCount), 30000);
          log.warn(`微信连接断开，${wait/1000}s 后重试 (${this.retryCount}/3)`);
          await sleep(wait);
        } else {
          log.error('微信连接失败，已重试3次，通知管理员');
          // TODO: 通过飞书/日志告警通知管理员
          await sleep(30000);  // 30秒后继续（非 session 过期的网络问题通常很快恢复）
          this.retryCount = 0;
        }
      }
    }
  }
}
```

**V1 限制说明**：
- 仅处理文本消息；图片/文件/语音消息记录 debug 日志但不处理
- `deleteMessage` 不实现（微信 bot 无法撤回用户消息），`/bind` 回复中提醒用户手动删除
- typing 状态指示（"对方正在输入"）留到 V2

### 4.5 IMService.ts 修改

```typescript
// 在 start() 方法中，现有飞书初始化代码之后添加：
if (process.env.WEIXIN_ENABLED === 'true') {
  const account = loadWeixinAccount();
  if (account) {
    const weixin = new WeixinAdapter(account);
    this.router.attach(weixin);
    await weixin.start();
    log.info('微信适配器已启动');
  } else {
    log.warn('WEIXIN_ENABLED=true 但未找到微信账号，请先执行 ./start.sh weixin-login');
  }
}
```

### 4.6 start.sh 修改

```bash
case "$1" in
  weixin-login)
    npx tsx scripts/weixin-login.ts
    ;;
  # ... 现有命令
esac
```

### 4.7 scripts/weixin-login.ts

```typescript
import { weixinLogin } from '../apps/server/src/services/im/weixin/login';

console.log('[微信登录] 正在启动...');
weixinLogin({ verbose: true })
  .then(() => console.log('[微信登录] 完成，请重启 gateway'))
  .catch((err) => console.error('[微信登录] 失败:', err.message));
```

---

## 五、安全考虑

| 风险 | 缓解 |
|------|------|
| `/bind` 密码消息留在微信记录 | 回复中提醒用户手动删除密码消息；IMRouter 的 deleteMessage try-catch 静默失败 |
| token 泄露 | `data/weixin/account.json` 加入 `.gitignore`；文件权限 600 |
| 未绑定用户发消息 | IMRouter 已有逻辑：返回"请先 /bind"提示，不处理任何请求 |
| long-poll 被中间人劫持 | ilink API 使用 HTTPS |

---

## 六、错误处理

| 场景 | 处理 |
|------|------|
| account.json 不存在 | 启动时 warn 日志，不注册 WeixinAdapter |
| token 过期（HTTP 401） | 日志告警，提示管理员重新 `./start.sh weixin-login` |
| session 过期（errcode -14） | 暂停 1 小时后重试，日志告警通知管理员 |
| long-poll 网络断开 | 自动重试 3 次（指数退避 4s/8s/16s），仍失败 → 告警 + 30 秒后继续 |
| sendMessage 失败 | 单次重试，仍失败 → 日志记录，用户端无回复 |
| contextToken 缺失 | warn 日志，静默跳过发送（等用户发下一条消息恢复） |
| 消息重复（getUpdates 重放） | 用 msgId 去重（内存 Set，保留最近 1000 条） |
| gateway 重启 | 从 sync-buf.json 恢复游标，避免历史消息重放 |
| stop() 调用 | AbortController 立即中断当前 long-poll，不等 35 秒超时 |

---

## 七、依赖

| 包 | 用途 | 安装方式 |
|---|---|---|
| `qrcode-terminal` | 终端显示 QR 码（登录时） | `pnpm add qrcode-terminal`（已在 OpenClaw 插件依赖中） |

无其他新依赖。API 通信用 Node.js 内置 `fetch`。

---

## 八、配置

```bash
# .env 新增
WEIXIN_ENABLED=true   # 是否启用微信渠道
```

其他配置（token/baseUrl）通过扫码登录自动写入 `data/weixin/account.json`，无需手动配置。

---

## 九、部署步骤

1. `pnpm add qrcode-terminal`
2. 开发完成后，`.env` 设置 `WEIXIN_ENABLED=true`
3. 执行 `./start.sh weixin-login` → 管理员微信扫码
4. 重启 gateway：`./start.sh restart`
5. 用户在微信中添加 bot 为好友，发送 `/bind 用户名 密码`

---

## 十、测试策略

| 测试项 | 方法 |
|---|---|
| account.ts 读写 | 单元测试：写入 → 读取 → 验证内容一致 |
| api.ts 请求格式 | mock HTTP，验证 header/body 格式正确 |
| WeixinAdapter 重连 | 模拟连续失败，验证指数退避和告警触发 |
| 消息去重 | 发送重复 msgId，验证只处理一次 |
| 端到端 | 真实扫码 → 发消息 → 收到 Agent 回复 |

---

## 十一、代码量预估

| 文件 | 行数 |
|------|------|
| WeixinAdapter.ts | ~300 |
| weixin/api.ts | ~200 |
| weixin/cdn.ts | ~150 |
| weixin/login.ts | ~100 |
| weixin/account.ts | ~80 |
| scripts/weixin-login.ts | ~40 |
| IMService.ts 修改 | ~10 |
| start.sh 修改 | ~5 |
| **合计** | **~885** |
