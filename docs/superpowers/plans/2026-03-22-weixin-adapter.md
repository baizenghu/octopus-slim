# 微信 IM 适配器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenClaw 微信插件移植为 Octopus WeixinAdapter，实现个人微信接入

**Architecture:** WeixinAdapter 实现 IMAdapter 接口，通过 ilink bot API long-poll 收消息、HTTP POST 发消息。完全复用 IMRouter 的绑定/路由/斜杠命令逻辑，与 FeishuAdapter 平级并存。

**Tech Stack:** TypeScript, Node.js fetch API, qrcode-terminal, AES-128-ECB (crypto)

**Spec:** `docs/superpowers/specs/2026-03-22-weixin-adapter-design.md`

**OpenClaw 源码参考:** `/tmp/weixin-plugin/package/src/`（已解压，MIT 协议）

---

## File Map

| 操作 | 文件路径 | 职责 | 行数 |
|------|---------|------|------|
| Create | `apps/server/src/services/im/weixin/account.ts` | 账号 + 游标持久化 | ~80 |
| Create | `apps/server/src/services/im/weixin/api.ts` | ilink bot API 封装 | ~200 |
| Create | `apps/server/src/services/im/weixin/cdn.ts` | CDN 文件上传 | ~150 |
| Create | `apps/server/src/services/im/weixin/login.ts` | QR 码扫码登录 | ~100 |
| Create | `apps/server/src/services/im/WeixinAdapter.ts` | 适配器主文件 | ~300 |
| Create | `scripts/weixin-login.ts` | 管理员扫码入口 | ~40 |
| Modify | `apps/server/src/services/im/IMRouter.ts` | 注释更新（channel 枚举） | ~1 |
| Modify | `apps/server/src/services/im/IMService.ts` | 添加微信启动代码 | ~10 |
| Modify | `start.sh` | 添加 weixin-login 子命令 | ~5 |

## Task 依赖

```
Task 1 (依赖安装) ──────────────────────┐
Task 2 (account.ts) ──┐                 │
Task 3 (api.ts) ──────┤ 可并行          │
Task 4 (cdn.ts) ──────┤                 │
Task 5 (login.ts) ────┘                 │
Task 6 (WeixinAdapter.ts) ── 依赖 2,3,4 │
Task 7 (集成: IMService + start.sh) ── 依赖 5,6
Task 8 (weixin-login.ts) ── 依赖 5
Task 9 (测试) ── 依赖全部
Task 10 (提交) ── 依赖 9
```

---

### Task 1: 安装依赖 + 创建目录

**Files:**
- Modify: `package.json` (pnpm add)
- Create: `apps/server/src/services/im/weixin/` (directory)

- [ ] **Step 1: 安装 qrcode-terminal**

```bash
cd apps/server && pnpm add qrcode-terminal
```

- [ ] **Step 2: 创建目录**

```bash
mkdir -p apps/server/src/services/im/weixin
```

- [ ] **Step 3: 验证**

```bash
ls apps/server/src/services/im/weixin/
node -e "require('qrcode-terminal')"
```

---

### Task 2: 创建 weixin/account.ts

**Files:**
- Create: `apps/server/src/services/im/weixin/account.ts`

账号和游标的持久化读写。参考 spec 4.1 节。

- [ ] **Step 1: 创建文件**

```typescript
/**
 * 微信账号持久化
 *
 * 管理 bot token、API 地址和 long-poll 游标的文件存储。
 * 存储路径: data/weixin/account.json + data/weixin/sync-buf.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface WeixinAccount {
  token: string;
  baseUrl: string;
  cdnBaseUrl: string;
  userId: string;
  loginAt: string;
}

const DATA_ROOT = process.env.DATA_ROOT || path.resolve(process.cwd(), 'data');
const WEIXIN_DIR = path.join(DATA_ROOT, 'weixin');
const ACCOUNT_PATH = path.join(WEIXIN_DIR, 'account.json');
const SYNC_BUF_PATH = path.join(WEIXIN_DIR, 'sync-buf.json');

function ensureDir(): void {
  if (!fs.existsSync(WEIXIN_DIR)) {
    fs.mkdirSync(WEIXIN_DIR, { recursive: true });
  }
}

/** 原子写入（tmp + rename） */
function atomicWrite(filePath: string, data: string): void {
  ensureDir();
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
  // 限制文件权限（仅 owner 可读写）
  try { fs.chmodSync(filePath, 0o600); } catch {}
}

export function loadWeixinAccount(): WeixinAccount | null {
  try {
    const raw = fs.readFileSync(ACCOUNT_PATH, 'utf-8');
    return JSON.parse(raw) as WeixinAccount;
  } catch {
    return null;
  }
}

export function saveWeixinAccount(account: WeixinAccount): void {
  atomicWrite(ACCOUNT_PATH, JSON.stringify(account, null, 2));
}

export function isWeixinConfigured(): boolean {
  return loadWeixinAccount() !== null;
}

/** 读取 long-poll 游标 */
export function loadSyncBuf(): string {
  try {
    const raw = fs.readFileSync(SYNC_BUF_PATH, 'utf-8');
    return JSON.parse(raw).buf || '';
  } catch {
    return '';
  }
}

/** 持久化 long-poll 游标 */
export function saveSyncBuf(buf: string): void {
  atomicWrite(SYNC_BUF_PATH, JSON.stringify({ buf, savedAt: new Date().toISOString() }));
}
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit src/services/im/weixin/account.ts
```

---

### Task 3: 创建 weixin/api.ts

**Files:**
- Create: `apps/server/src/services/im/weixin/api.ts`
- Reference: `/tmp/weixin-plugin/package/src/api/api.ts`, `/tmp/weixin-plugin/package/src/api/types.ts`, `/tmp/weixin-plugin/package/src/messaging/send.ts`, `/tmp/weixin-plugin/package/src/messaging/inbound.ts`

ilink bot API 的 HTTP 封装。这是最核心的移植文件。

**实现要求：**

1. **通用 fetch 封装** `apiFetch()`：移植自 OpenClaw `api.ts:92-125`
   - POST JSON + `Authorization: Bearer {token}` + `X-WECHAT-UIN` header + `base_info`
   - 支持 `AbortSignal`
   - 超时控制

2. **getUpdates()**：移植自 OpenClaw `api.ts:133-163`
   - POST `ilink/bot/getupdates` with `get_updates_buf` 游标
   - Long-poll timeout 35s
   - `AbortError` 返回空结果（正常）
   - 返回 `errcode`（-14 = session 过期）
   - 解析 `msgs` 数组：每个 msg 有 `item_list`，用 `bodyFromItemList()` 提取文本

3. **bodyFromItemList()**：移植自 OpenClaw `inbound.ts:81-106`
   - 遍历 `item_list`，取 `type === 'TEXT'` 的 `text_item.text`
   - V1 忽略 IMAGE/VOICE/FILE/VIDEO

4. **sendTextMessage()**：移植自 OpenClaw `send.ts:39-111`
   - 构造完整的 `SendMessageReq`：`message_type: 'BOT'`, `message_state: 2` (FINISH), `client_id` (随机 hex), `item_list: [{ type: 'TEXT', text_item: { text } }]`
   - POST `ilink/bot/sendmessage`
   - **contextToken 必需**，缺失时抛错

5. **getUploadUrl()**：移植自 OpenClaw `api.ts:166-192`
   - POST `ilink/bot/getuploadurl`

6. **WeixinMessage 接口**：
   ```typescript
   export interface WeixinMessage {
     msgId: string;
     fromUserId: string;
     text: string;
     contextToken: string;
     timestamp: number;
   }
   ```

7. **辅助函数**：
   - `randomWechatUin()`: 随机 X-WECHAT-UIN header（移植自 `api.ts:63-66`）
   - `markdownToPlainText(text)`: 简单 Markdown 转纯文本（剥离 `**`, `#`, `[]()` 等）

- [ ] **Step 1: 创建文件**

根据以上要求实现完整代码。每个函数都标注移植来源。参考 OpenClaw 源码路径获取准确的请求/响应格式。

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit src/services/im/weixin/api.ts
```

---

### Task 4: 创建 weixin/cdn.ts

**Files:**
- Create: `apps/server/src/services/im/weixin/cdn.ts`
- Reference: `/tmp/weixin-plugin/package/src/cdn/cdn-upload.ts`, `/tmp/weixin-plugin/package/src/cdn/aes-ecb.ts`

CDN 文件上传模块，用于 sendFile。

**实现要求：**

1. **aesEcbPaddedSize()**：移植自 `aes-ecb.ts`
   - PKCS7 padding 计算：`Math.ceil((plaintextSize + 1) / 16) * 16`

2. **encryptAesEcb()**：移植自 `aes-ecb.ts`
   - `crypto.createCipheriv('aes-128-ecb', key, null)` + 自动 PKCS7 padding

3. **uploadBufferToCdn()**：移植自 `cdn-upload.ts:30-69`
   - POST 到 CDN URL (content-type: application/octet-stream)
   - 最多 3 次重试，4xx 立即失败，5xx 重试间隔 2s
   - 返回 `x-encrypted-param` 响应头

4. **uploadAndSendFile()**：完整链路
   - 读文件 → 生成随机 AES key → 计算 MD5 + 加密大小 → getUploadUrl → encryptAesEcb → uploadBufferToCdn → sendMessage (IMAGE/FILE type)
   - 根据文件扩展名决定 mediaType：图片(1)/视频(2)/文件(3)

- [ ] **Step 1: 创建文件**

```typescript
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getUploadUrl, type WeixinApiOptions } from './api';
// ... 完整实现
```

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit src/services/im/weixin/cdn.ts
```

---

### Task 5: 创建 weixin/login.ts

**Files:**
- Create: `apps/server/src/services/im/weixin/login.ts`
- Reference: `/tmp/weixin-plugin/package/src/auth/login-qr.ts`

管理员扫码登录流程。

**实现要求：**

1. **weixinLogin()**：
   - `GET /ilink/bot/get_bot_qrcode?bot_type=3` → 获取 QR URL
   - 用 `qrcode-terminal` 显示 QR 码（动态导入，兼容无 @types）
   - 轮询 `GET /ilink/bot/get_qrcode_status?qrcode=XXX`（long-poll 35s，最长等 5 分钟）
   - 成功：保存 `{ token, baseUrl, cdnBaseUrl, userId, loginAt }` 到 account.json
   - 失败：输出错误信息

2. **默认 baseUrl**: `https://ilinkai.weixin.qq.com`
3. **默认 cdnBaseUrl**: `https://novac2c.cdn.weixin.qq.com/c2c`
4. **bot_type**: `3`（ilink bot）

- [ ] **Step 1: 创建文件**

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit src/services/im/weixin/login.ts
```

---

### Task 6: 创建 WeixinAdapter.ts

**Files:**
- Create: `apps/server/src/services/im/WeixinAdapter.ts`
- Reference: `apps/server/src/services/im/FeishuAdapter.ts`（模式参考）

适配器主文件，实现 IMAdapter 接口。代码结构完全按 spec 4.4 节的伪代码实现。

**实现要求：**

1. **IMAdapter 接口**：`channel='wechat'`, `start()`, `stop()`, `sendText()`, `onMessage()`, `sendFile()`
2. **pollLoop()**：
   - long-poll 循环 + AbortController
   - errcode -14 session 过期 → 暂停 1 小时
   - 消息去重（processedMsgIds Set, max 1000）
   - 游标持久化（saveSyncBuf）
   - contextToken 缓存（Map）
   - 自动重连（3 次指数退避 4s/8s/16s，之后 30s 暂停）
3. **sendText()**：contextToken 缺失 → warn + 静默跳过；Markdown → 纯文本；分片 4000 字
4. **sendFile()**：调用 cdn.ts 的 uploadAndSendFile
5. **deleteMessage**：不实现（微信限制）

- [ ] **Step 1: 创建文件**

按 spec 4.4 节伪代码实现，补充 import 和完整类型。

- [ ] **Step 2: 验证编译**

```bash
cd apps/server && npx tsc --noEmit src/services/im/WeixinAdapter.ts
```

---

### Task 7: 集成到 IMService + start.sh

**Files:**
- Modify: `apps/server/src/services/im/IMRouter.ts:9`（注释更新）
- Modify: `apps/server/src/services/im/IMService.ts`（添加微信启动代码）
- Modify: `start.sh`（添加 weixin-login 子命令）

- [ ] **Step 1: 更新 IMAdapter.ts 注释**

`IMAdapter.ts:9` 的 channel 注释从 `'feishu' | 'wangxuntong'` 改为 `'feishu' | 'wechat'`

- [ ] **Step 2: 修改 IMService.ts**

找到飞书初始化代码块（`FEISHU_APP_ID` 检查），在其后添加：

```typescript
// 微信适配器
if (process.env.WEIXIN_ENABLED === 'true') {
  const { loadWeixinAccount } = await import('./weixin/account');
  const { WeixinAdapter } = await import('./WeixinAdapter');
  const account = loadWeixinAccount();
  if (account) {
    const weixin = new WeixinAdapter(account);
    this.router.attach(weixin);
    await weixin.start();
    console.log('[im] 微信适配器已启动');
  } else {
    console.warn('[im] WEIXIN_ENABLED=true 但未找到微信账号，请先执行 ./start.sh weixin-login');
  }
}
```

- [ ] **Step 3: 修改 start.sh**

在 `case` 语句中 `*)` 之前添加：

```bash
  weixin-login)
    echo "[weixin] 正在启动微信扫码登录..."
    cd "$PROJECT_DIR" && npx tsx scripts/weixin-login.ts
    ;;
```

- [ ] **Step 4: 验证编译**

```bash
cd apps/server && npx tsc --noEmit
```

---

### Task 8: 创建 scripts/weixin-login.ts

**Files:**
- Create: `scripts/weixin-login.ts`

- [ ] **Step 1: 创建文件**

```typescript
/**
 * 微信扫码登录入口脚本
 *
 * 用法: ./start.sh weixin-login
 *       npx tsx scripts/weixin-login.ts
 */

import { weixinLogin } from '../apps/server/src/services/im/weixin/login';

async function main() {
  console.log('[微信登录] 正在启动...');
  console.log('[微信登录] 请使用微信扫描下方二维码\n');

  try {
    await weixinLogin({ verbose: true });
    console.log('\n[微信登录] ✅ 连接成功！');
    console.log('[微信登录] 请在 .env 中设置 WEIXIN_ENABLED=true');
    console.log('[微信登录] 然后重启 gateway: ./start.sh restart');
  } catch (err: any) {
    console.error(`\n[微信登录] ❌ 登录失败: ${err.message}`);
    console.error('[微信登录] 可重新执行: ./start.sh weixin-login');
    process.exit(1);
  }
}

main();
```

---

### Task 9: 手动测试

- [ ] **Step 1: 编译验证**

```bash
cd apps/server && npx tsc --noEmit
```

Expected: 无错误

- [ ] **Step 2: 扫码登录测试**

```bash
./start.sh weixin-login
```

Expected: 终端显示 QR 码，微信扫码后显示 "✅ 连接成功"

- [ ] **Step 3: 检查 account.json**

```bash
cat data/weixin/account.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'token: {d[\"token\"][:10]}...'); print(f'baseUrl: {d[\"baseUrl\"]}'); print(f'userId: {d[\"userId\"]}')"
```

- [ ] **Step 4: 启动 gateway 测试**

在 `.env` 中设置 `WEIXIN_ENABLED=true`，然后：

```bash
./start.sh restart
```

Expected: 日志中出现 `[im] 微信适配器已启动`

- [ ] **Step 5: 端到端消息测试**

1. 在微信中给 bot 发 `/bind 用户名 密码`
2. 收到绑定成功回复
3. 发一条普通消息（如 "你好"）
4. 收到 Agent 回复

---

### Task 10: 提交代码

- [ ] **Step 1: 添加 data/weixin/ 到 .gitignore**

```bash
echo "data/weixin/" >> .gitignore
```

- [ ] **Step 2: 检查文件完整性**

```bash
find apps/server/src/services/im/weixin -type f | sort
ls scripts/weixin-login.ts
```

Expected: account.ts, api.ts, cdn.ts, login.ts + WeixinAdapter.ts + weixin-login.ts

- [ ] **Step 3: 提交**

```bash
git add apps/server/src/services/im/weixin/ \
        apps/server/src/services/im/WeixinAdapter.ts \
        apps/server/src/services/im/IMAdapter.ts \
        apps/server/src/services/im/IMService.ts \
        scripts/weixin-login.ts \
        start.sh \
        .gitignore \
        apps/server/package.json \
        pnpm-lock.yaml \
        docs/superpowers/specs/2026-03-22-weixin-adapter-design.md \
        docs/superpowers/plans/2026-03-22-weixin-adapter.md

git commit -m "feat: add WeChat IM adapter (WeixinAdapter)

Port ilink bot API from OpenClaw weixin plugin (MIT).
- Long-poll getUpdates + HTTP sendMessage
- QR code terminal login (./start.sh weixin-login)
- CDN file upload (AES-ECB encrypt + presigned URL)
- Auto-reconnect with exponential backoff (3 retries + alert)
- Session expiry detection (errcode -14)
- Message dedup + sync-buf cursor persistence
- Markdown to plaintext conversion for WeChat
- Coexists with FeishuAdapter (multi-channel)"
```

---

## 执行检查清单

- [ ] `qrcode-terminal` 已安装
- [ ] `npx tsc --noEmit` 编译无错误
- [ ] `data/weixin/` 已加入 `.gitignore`
- [ ] `./start.sh weixin-login` 显示 QR 码并能扫码
- [ ] `data/weixin/account.json` 生成且权限 600
- [ ] `.env` 设置 `WEIXIN_ENABLED=true` 后 gateway 启动正常
- [ ] 微信发消息能收到 Agent 回复
- [ ] 飞书功能不受影响（同时运行）
- [ ] 代码已提交
