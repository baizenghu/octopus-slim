/**
 * 微信 ilink bot API 封装
 *
 * 移植自 OpenClaw weixin plugin (MIT)。
 * 使用 Node.js 内置 fetch，不依赖第三方 HTTP 库。
 *
 * 参考源码:
 * - /tmp/weixin-plugin/package/src/api/api.ts (HTTP 封装)
 * - /tmp/weixin-plugin/package/src/api/types.ts (类型定义)
 * - /tmp/weixin-plugin/package/src/messaging/send.ts (消息构造)
 * - /tmp/weixin-plugin/package/src/messaging/inbound.ts (消息解析)
 */

import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WeixinApiOptions {
  baseUrl: string;
  token: string;
  timeout?: number;
  abortSignal?: AbortSignal;
}

/** 简化的入站消息（从 getUpdates 响应中提取） */
export interface WeixinMessage {
  msgId: string;
  fromUserId: string;
  text: string;
  contextToken: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Internal protocol types (mirrors OpenClaw api/types.ts)
// ---------------------------------------------------------------------------

interface BaseInfo {
  channel_version?: string;
}

interface TextItem {
  text?: string;
}

interface RefMessage {
  message_item?: RawMessageItem;
  title?: string;
}

interface RawMessageItem {
  type?: number;
  text_item?: TextItem;
  voice_item?: { text?: string };
  ref_msg?: RefMessage;
}

/** proto: WeixinMessage (raw from server) */
interface RawWeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: RawMessageItem[];
  context_token?: string;
}

interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: RawWeixinMessage[];
  get_updates_buf?: string;
}

interface SendMessageReq {
  msg?: {
    from_user_id?: string;
    to_user_id?: string;
    client_id?: string;
    message_type?: number;
    message_state?: number;
    item_list?: RawMessageItem[];
    context_token?: string;
  };
  base_info?: BaseInfo;
}

// MessageItemType 枚举（移植自 types.ts）
const MessageItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

// MessageType / MessageState 枚举
const MessageType = { BOT: 2 } as const;
const MessageState = { FINISH: 2 } as const;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LONG_POLL_TIMEOUT_MS = 35_000;
const DEFAULT_API_TIMEOUT_MS = 15_000;
const CHANNEL_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildBaseInfo(): BaseInfo {
  return { channel_version: CHANNEL_VERSION };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * X-WECHAT-UIN header: random uint32 -> decimal string -> base64.
 * 移植自 OpenClaw api.ts:63-66
 */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildHeaders(params: { token?: string; body: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Content-Length': String(Buffer.byteLength(params.body, 'utf-8')),
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (params.token?.trim()) {
    headers['Authorization'] = `Bearer ${params.token.trim()}`;
  }
  return headers;
}

/**
 * 通用 fetch 封装: POST JSON to a Weixin API endpoint.
 * 移植自 OpenClaw api.ts:92-125
 */
async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
  label: string;
  externalSignal?: AbortSignal;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base).toString();
  const hdrs = buildHeaders({ token: params.token, body: params.body });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  // 联合外部 signal 和内部 timeout signal
  const onExternalAbort = () => controller.abort();
  if (params.externalSignal) {
    if (params.externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      params.externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: hdrs,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`${params.label} HTTP ${res.status}: ${rawText}`);
    }
    return rawText;
  } finally {
    clearTimeout(timer);
    if (params.externalSignal) {
      params.externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }
}

// ---------------------------------------------------------------------------
// bodyFromItemList — 从 item_list 提取文本
// 移植自 OpenClaw inbound.ts:81-106
// ---------------------------------------------------------------------------

function isMediaItem(item: RawMessageItem): boolean {
  return (
    item.type === MessageItemType.IMAGE ||
    item.type === MessageItemType.VIDEO ||
    item.type === MessageItemType.FILE ||
    item.type === MessageItemType.VOICE
  );
}

function bodyFromItemList(itemList?: RawMessageItem[]): string {
  if (!itemList?.length) return '';
  for (const item of itemList) {
    if (item.type === MessageItemType.TEXT && item.text_item?.text != null) {
      const text = String(item.text_item.text);
      const ref = item.ref_msg;
      if (!ref) return text;
      // 引用的是媒体消息，只返回当前文本
      if (ref.message_item && isMediaItem(ref.message_item)) return text;
      // 构建引用上下文
      const parts: string[] = [];
      if (ref.title) parts.push(ref.title);
      if (ref.message_item) {
        const refBody = bodyFromItemList([ref.message_item]);
        if (refBody) parts.push(refBody);
      }
      if (!parts.length) return text;
      return `[引用: ${parts.join(' | ')}]\n${text}`;
    }
    // 语音转文字
    if (item.type === MessageItemType.VOICE && item.voice_item?.text) {
      return item.voice_item.text;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Long-poll 收消息。
 * 移植自 OpenClaw api.ts:133-163
 *
 * AbortError（正常的 long-poll 超时或外部取消）返回空结果。
 */
export async function getUpdates(opts: WeixinApiOptions & { cursor: string }): Promise<{
  msgs: WeixinMessage[];
  cursor: string;
  errcode?: number;
}> {
  const timeout = opts.timeout ?? DEFAULT_LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiFetch({
      baseUrl: opts.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: JSON.stringify({
        get_updates_buf: opts.cursor || '',
        base_info: buildBaseInfo(),
      }),
      token: opts.token,
      timeoutMs: timeout,
      label: 'getUpdates',
      externalSignal: opts.abortSignal,
    });

    const resp: GetUpdatesResp = JSON.parse(rawText);

    // 提取并简化消息
    const msgs: WeixinMessage[] = [];
    if (resp.msgs) {
      for (const raw of resp.msgs) {
        // 跳过 BOT 类型消息（自己发的）
        if (raw.message_type === MessageType.BOT) continue;

        const text = bodyFromItemList(raw.item_list);
        // 跳过空消息（纯媒体消息 V1 不处理）
        if (!text) continue;

        msgs.push({
          msgId: raw.client_id || String(raw.message_id ?? raw.seq ?? Date.now()),
          fromUserId: raw.from_user_id || '',
          text,
          contextToken: raw.context_token || '',
          timestamp: raw.create_time_ms || Date.now(),
        });
      }
    }

    return {
      msgs,
      cursor: resp.get_updates_buf || opts.cursor,
      errcode: resp.errcode,
    };
  } catch (err) {
    // Long-poll 超时或外部取消是正常的
    if (err instanceof Error && err.name === 'AbortError') {
      return { msgs: [], cursor: opts.cursor };
    }
    throw err;
  }
}

/**
 * 发文本消息。
 * 移植自 OpenClaw send.ts:39-111
 *
 * 构造完整的 SendMessageReq body，包含 message_type=BOT, message_state=FINISH。
 * contextToken 必需，缺失时抛错。
 */
export async function sendTextMessage(opts: WeixinApiOptions & {
  to: string;
  text: string;
  contextToken: string;
}): Promise<{ messageId: string }> {
  if (!opts.contextToken) {
    throw new Error('sendTextMessage: contextToken is required');
  }

  const clientId = crypto.randomBytes(16).toString('hex');

  const itemList: RawMessageItem[] = opts.text
    ? [{ type: MessageItemType.TEXT, text_item: { text: opts.text } }]
    : [];

  const body: SendMessageReq = {
    msg: {
      from_user_id: '',
      to_user_id: opts.to,
      client_id: clientId,
      message_type: MessageType.BOT,
      message_state: MessageState.FINISH,
      item_list: itemList.length ? itemList : undefined,
      context_token: opts.contextToken,
    },
    base_info: buildBaseInfo(),
  };

  await apiFetch({
    baseUrl: opts.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body: JSON.stringify(body),
    token: opts.token,
    timeoutMs: opts.timeout ?? DEFAULT_API_TIMEOUT_MS,
    label: 'sendMessage',
    externalSignal: opts.abortSignal,
  });

  return { messageId: clientId };
}

/**
 * CDN 预签名上传地址。
 * 移植自 OpenClaw api.ts:166-192
 */
export async function getUploadUrl(opts: WeixinApiOptions & {
  filekey: string;
  mediaType: number;
  toUserId: string;
  rawsize: number;
  rawfilemd5: string;
  filesize: number;
  aeskey: string;
  thumbRawsize?: number;
  thumbRawfilemd5?: string;
  thumbFilesize?: number;
}): Promise<{ uploadParam: string; thumbUploadParam: string; filekey: string }> {
  const rawText = await apiFetch({
    baseUrl: opts.baseUrl,
    endpoint: 'ilink/bot/getuploadurl',
    body: JSON.stringify({
      filekey: opts.filekey,
      media_type: opts.mediaType,
      to_user_id: opts.toUserId,
      rawsize: opts.rawsize,
      rawfilemd5: opts.rawfilemd5,
      filesize: opts.filesize,
      thumb_rawsize: opts.thumbRawsize,
      thumb_rawfilemd5: opts.thumbRawfilemd5,
      thumb_filesize: opts.thumbFilesize,
      no_need_thumb: !opts.thumbRawsize,
      aeskey: opts.aeskey,
      base_info: buildBaseInfo(),
    }),
    token: opts.token,
    timeoutMs: opts.timeout ?? DEFAULT_API_TIMEOUT_MS,
    label: 'getUploadUrl',
    externalSignal: opts.abortSignal,
  });

  const resp = JSON.parse(rawText) as {
    upload_param?: string;
    thumb_upload_param?: string;
  };

  return {
    uploadParam: resp.upload_param || '',
    thumbUploadParam: resp.thumb_upload_param || '',
    filekey: opts.filekey,
  };
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

/**
 * Markdown 转纯文本。
 * 移植自 OpenClaw send.ts:20-35
 *
 * 简单正则剥离常见 Markdown 语法：
 * - 代码块 ```...``` → 保留内容
 * - 图片 ![alt](url) → 移除
 * - 链接 [text](url) → text
 * - 表格分隔行 |---|---| → 移除
 * - 表格行 |a|b| → a  b
 * - 粗体/斜体 **text**, *text*, __text__, _text_ → text
 * - 标题 # heading → heading
 * - 行内代码 `code` → code
 * - 删除线 ~~text~~ → text
 * - 水平线 --- → 移除
 */
export function markdownToPlainText(text: string): string {
  let result = text;
  // Code blocks: strip fences, keep code content
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_: string, code: string) => code.trim());
  // Images: remove entirely
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  // Links: keep display text only
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Tables: remove separator rows
  result = result.replace(/^\|[\s:|-]+\|$/gm, '');
  // Tables: strip leading/trailing pipes, convert inner pipes to spaces
  result = result.replace(/^\|(.+)\|$/gm, (_: string, inner: string) =>
    inner.split('|').map((cell) => cell.trim()).join('  '),
  );
  // Bold/italic: **text** / __text__ → text, *text* / _text_ → text
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');
  // Strikethrough: ~~text~~ → text
  result = result.replace(/~~(.+?)~~/g, '$1');
  // Headings: # heading → heading
  result = result.replace(/^#{1,6}\s+/gm, '');
  // Inline code: `code` → code
  result = result.replace(/`([^`]+)`/g, '$1');
  // Horizontal rules: --- or *** or ___ on their own line → remove
  result = result.replace(/^[\s]*([-*_]){3,}[\s]*$/gm, '');
  // Blockquotes: > text → text
  result = result.replace(/^>\s?/gm, '');
  // Unordered list markers: - item or * item → item
  result = result.replace(/^[\s]*[-*+]\s+/gm, '');
  // Ordered list markers: 1. item → item
  result = result.replace(/^[\s]*\d+\.\s+/gm, '');
  // Collapse multiple blank lines into one
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

/**
 * 文本分片。
 * 按 maxLen 切割文本，优先在换行符处断开。
 */
export function splitText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // 在 maxLen 范围内寻找最后一个换行符作为断点
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0 || splitIdx < maxLen * 0.3) {
      // 如果没有合适的换行位置，找最后一个空格
      splitIdx = remaining.lastIndexOf(' ', maxLen);
    }
    if (splitIdx <= 0 || splitIdx < maxLen * 0.3) {
      // 仍然没有合适位置，强制在 maxLen 处断开
      splitIdx = maxLen;
    }

    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, '');
  }

  return chunks;
}
