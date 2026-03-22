# 微信 IM 适配器设计文档（v2 多账号模式）

> 日期: 2026-03-22
> 版本: v2（多账号模式，替代 v1 单账号设计）
> 状态: 已确认
> 扩展形式: Octopus IM WeixinAdapter（TypeScript，服务端）

---

## 一、背景与动机

### v1 → v2 的变化

v1 设计假设微信是"一个 bot 对多人"模式（类似飞书），但实际 clawbot 插件的工作方式是**每个微信用户各自安装 clawbot，各自扫码建立独立连接**。因此需要改为多账号模式。

| | v1 单账号 | v2 多账号 |
|---|---|---|
| 绑定方式 | 管理员扫一次码，用户 `/bind` | 每个用户各自扫码 |
| 连接数 | 1 个 long-poll | N 个（每用户一个） |
| 存储 | `data/weixin/account.json` | `data/weixin/accounts/{userId}.json` |
| 用户识别 | 通过 `/bind` + IMUserBinding | 扫码即绑定，直接路由 |
| 扫码入口 | CLI 终端 | Web 前端 + CLI |

### 灵感来源

OpenClaw 微信插件 `@tencent-weixin/openclaw-weixin`（MIT）：
- README 明确支持 "Adding More WeChat Accounts — Each QR code login creates a new account entry"
- `agents.mode: per-channel-per-peer` 实现上下文隔离

---

## 二、整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│  Octopus Enterprise Gateway                                         │
│                                                                      │
│  WeixinManager (管理多用户连接)                                      │
│  ├── WeixinAdapter (用户A) ── long-poll ── 用户A 的微信 clawbot     │
│  ├── WeixinAdapter (用户B) ── long-poll ── 用户B 的微信 clawbot     │
│  └── WeixinAdapter (用户C) ── long-poll ── 用户C 的微信 clawbot     │
│          │                                                           │
│          ▼                                                           │
│  IMRouter (复用，"已预绑定"模式)                                     │
│  ├── 跳过 /bind 检查（扫码用户已知 userId）                         │
│  ├── /agent [名称]     → 切换 agent                                 │
│  ├── /cancel           → 取消任务                                   │
│  └── 普通消息          → routeToAgent()                             │
│                                                                      │
│  API 路由 (/api/user/weixin)                                        │
│  ├── POST   /login        → 发起扫码，返回 QR 码 URL               │
│  ├── GET    /login/status → 轮询扫码结果                            │
│  ├── GET    /status       → 查看当前微信绑定状态                    │
│  └── DELETE /unbind       → 解除微信绑定                            │
│                                                                      │
│  数据存储                                                           │
│  └── File: data/weixin/accounts/{userId}.json                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、文件结构

### 改动的文件（基于 v1 已有代码）

```
apps/server/src/services/im/
├── IMAdapter.ts              # 不改
├── IMRouter.ts               # 改：增加"已预绑定"模式支持
├── IMService.ts              # 改：WeixinManager 替代单个 WeixinAdapter
├── FeishuAdapter.ts          # 不改
├── WeixinAdapter.ts          # 改：构造函数接受 userId，消息携带 userId
└── weixin/
    ├── api.ts                # 不改
    ├── cdn.ts                # 不改
    ├── login.ts              # 改：支持按 userId 保存
    ├── account.ts            # 改：多账号存储
    ├── manager.ts            # 新增：WeixinManager
    └── vendor.d.ts           # 不改

apps/server/src/routes/
└── weixin.ts                 # 新增：扫码 API 路由

scripts/
└── weixin-login.mjs          # 改：支持 --user 参数
```

---

## 四、模块详细设计

### 4.1 account.ts 改造 — 多账号存储

```typescript
// 存储路径变化
// v1: data/weixin/account.json
// v2: data/weixin/accounts/{userId}.json
//     data/weixin/sync-buf/{userId}.json

export function loadWeixinAccount(userId: string): WeixinAccount | null;
export function saveWeixinAccount(userId: string, account: WeixinAccount): void;
export function deleteWeixinAccount(userId: string): void;
export function listAllAccountUserIds(): string[];  // 列出所有已绑定用户

export function loadSyncBuf(userId: string): string;
export function saveSyncBuf(userId: string, buf: string): void;
```

### 4.2 WeixinAdapter.ts 改造

```typescript
export class WeixinAdapter implements IMAdapter {
  readonly channel = 'wechat';
  readonly userId: string;  // 新增：绑定的 Octopus 用户 ID

  constructor(userId: string, account: WeixinAccount) {
    this.userId = userId;
    // cursor 按 userId 加载
    this.cursor = loadSyncBuf(userId);
  }

  // pollLoop 中消息回调携带 userId 信息
  // 通过 imUserName 字段传递 userId（IMRouter 用此识别已预绑定用户）
  this.messageHandler?.({
    channel: 'wechat',
    imUserId: msg.fromUserId,       // 微信 ID
    imUserName: this.userId,        // Octopus userId（预绑定标识）
    text: msg.text,
    messageId: msg.msgId,
  });
}
```

### 4.3 WeixinManager（新增）

```typescript
export class WeixinManager {
  private adapters = new Map<string, WeixinAdapter>();  // userId → adapter
  private router: IMRouter;

  constructor(router: IMRouter) {
    this.router = router;
  }

  /** 启动时加载所有已绑定用户 */
  async startAll(): Promise<void> {
    const userIds = listAllAccountUserIds();
    for (const userId of userIds) {
      await this.startUser(userId);
    }
    if (userIds.length > 0) {
      console.log(`[wechat] Started ${userIds.length} adapter(s)`);
    }
  }

  /** 新用户扫码成功后启动 */
  async startUser(userId: string): Promise<void> {
    // 如果已有连接，先停止
    if (this.adapters.has(userId)) {
      await this.stopUser(userId);
    }
    const account = loadWeixinAccount(userId);
    if (!account) return;

    const adapter = new WeixinAdapter(userId, account);
    this.router.attach(adapter);
    await adapter.start();
    this.adapters.set(userId, adapter);
  }

  /** 用户解绑 */
  async stopUser(userId: string): Promise<void> {
    const adapter = this.adapters.get(userId);
    if (adapter) {
      await adapter.stop();
      this.adapters.delete(userId);
    }
  }

  /** 完全停止 */
  async stopAll(): Promise<void> {
    for (const [userId, adapter] of this.adapters) {
      await adapter.stop().catch(() => {});
    }
    this.adapters.clear();
  }

  isUserConnected(userId: string): boolean {
    return this.adapters.has(userId);
  }
}
```

### 4.4 IMRouter 改造 — "已预绑定"模式

在 `handleMessage` 中，微信消息通过 `imUserName` 携带了 `userId`。
增加一个检查：如果 `msg.imUserName` 非空且是合法的 Octopus userId，则直接使用该 userId，跳过 `/bind` 检查。

```typescript
async handleMessage(adapter: IMAdapter, msg: IMIncomingMessage) {
  // 微信多账号模式：扫码已绑定，imUserName 即 userId
  let userId: string | null = null;
  if (adapter.channel === 'wechat' && msg.imUserName) {
    userId = msg.imUserName;  // 预绑定，直接使用
  } else {
    // 飞书等渠道：查 IMUserBinding 表
    const binding = await this.prisma.iMUserBinding.findFirst({
      where: { channel: adapter.channel, imUserId: msg.imUserId },
    });
    userId = binding?.userId ?? null;
  }

  // 未绑定用户处理（飞书走 /bind，微信不会走到这里）
  if (!userId) {
    // ... 现有的 /bind 逻辑
  }

  // 斜杠命令（/agent, /cancel 等）— 所有渠道通用
  // ... 现有逻辑不变
}
```

### 4.5 API 路由 — weixin.ts（新增）

```typescript
// POST /api/user/weixin/login
// 发起扫码，返回 QR 码 URL
// 需要 JWT 认证（知道是哪个用户）
router.post('/login', auth, async (req, res) => {
  const userId = req.userId;
  const { qrcodeUrl, sessionKey } = await startWeixinLogin(userId);
  res.json({ qrcodeUrl, sessionKey });
});

// GET /api/user/weixin/login/status?sessionKey=xxx
// 轮询扫码结果
router.get('/login/status', auth, async (req, res) => {
  const { sessionKey } = req.query;
  const result = await checkWeixinLoginStatus(sessionKey);
  if (result.connected) {
    // 扫码成功 → 保存 account + 启动 adapter
    saveWeixinAccount(req.userId, result.account);
    await weixinManager.startUser(req.userId);
    res.json({ status: 'connected' });
  } else {
    res.json({ status: result.status }); // 'wait' | 'scaned' | 'expired'
  }
});

// GET /api/user/weixin/status
// 查看微信绑定状态
router.get('/status', auth, async (req, res) => {
  const account = loadWeixinAccount(req.userId);
  res.json({
    bound: !!account,
    connected: weixinManager.isUserConnected(req.userId),
    userId: account?.userId,
  });
});

// DELETE /api/user/weixin/unbind
// 解除微信绑定
router.delete('/unbind', auth, async (req, res) => {
  await weixinManager.stopUser(req.userId);
  deleteWeixinAccount(req.userId);
  res.json({ success: true });
});
```

### 4.6 IMService.ts 改造

```typescript
// 删除 v1 的单 WeixinAdapter 启动代码
// 改为 WeixinManager

if (process.env.WEIXIN_ENABLED === 'true') {
  this.weixinManager = new WeixinManager(this.router);
  await this.weixinManager.startAll();
}
```

### 4.7 login.ts 改造

`weixinLogin()` 增加 `userId` 参数：

```typescript
export async function weixinLogin(opts: {
  userId?: string;   // 通过 API 调用时传入
  baseUrl?: string;
  verbose?: boolean;
}): Promise<void> {
  // ... 流程不变
  // 保存时按 userId
  saveWeixinAccount(opts.userId!, { token, baseUrl, cdnBaseUrl, userId: botId, loginAt });
}
```

同时拆出 `startWeixinLogin()` 和 `checkWeixinLoginStatus()` 供 API 路由使用。

---

## 五、用户流程

### Web 前端扫码

```
用户点击"绑定微信"
  → POST /api/user/weixin/login
  → 返回 { qrcodeUrl, sessionKey }
  → 前端显示 QR 码（<img> 或 qrcode.js 渲染）
  → 用户打开微信扫码
  → 前端轮询 GET /api/user/weixin/login/status?sessionKey=xxx
  → 返回 { status: 'connected' }
  → 前端显示"绑定成功"
  → 用户在微信中直接发消息即可
```

### CLI 扫码（管理员/调试）

```bash
./start.sh weixin-login --user user-zhangsan
```

### 微信中使用

```
用户直接发消息 → Agent 回复（不需要 /bind）
/agent list    → 查看可用 agent
/agent 数据分析 → 切换 agent
/cancel        → 取消任务
```

---

## 六、错误处理

| 场景 | 处理 |
|------|------|
| 用户重复扫码 | 停止旧 adapter，启动新的 |
| 某用户 session 过期 | 该用户 adapter 暂停，不影响其他用户 |
| 某用户网络断开 | 该用户 adapter 独立重连（3 次退避 + 30s） |
| gateway 重启 | 自动加载所有 accounts/ 下的用户，恢复连接 |
| 用户解绑 | 停止 adapter + 删除 account 文件 |

---

## 七、数据迁移（v1 → v2）

如果已有 v1 的 `data/weixin/account.json`，启动时自动迁移：
- 读取 `account.json` → 移动到 `accounts/admin.json`（假设为管理员）
- 或直接忽略（让用户重新扫码）

---

## 八、改动量预估

| 文件 | 改动类型 | 行数 |
|------|---------|------|
| weixin/account.ts | 重写（多账号） | ~100 |
| weixin/manager.ts | 新增 | ~80 |
| weixin/login.ts | 改造（拆分 start/check） | ~160 |
| WeixinAdapter.ts | 小改（加 userId） | +20 |
| IMRouter.ts | 小改（预绑定检查） | +15 |
| IMService.ts | 小改（用 WeixinManager） | +10 |
| routes/weixin.ts | 新增 | ~80 |
| scripts/weixin-login.mjs | 改（--user 参数） | +10 |
| **合计新增/改动** | | **~475** |
