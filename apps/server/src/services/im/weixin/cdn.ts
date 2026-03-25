/**
 * 微信 CDN 文件上传
 *
 * 移植自 OpenClaw weixin plugin (MIT)。
 * 完整链路：读文件 → AES-ECB 加密 → getUploadUrl → CDN 上传 → sendMessage(media)
 *
 * 参考源码:
 * - /tmp/weixin-plugin/package/src/cdn/aes-ecb.ts
 * - /tmp/weixin-plugin/package/src/cdn/cdn-upload.ts
 * - /tmp/weixin-plugin/package/src/cdn/cdn-url.ts
 * - /tmp/weixin-plugin/package/src/cdn/upload.ts
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getUploadUrl, type WeixinApiOptions } from './api';

// ---------------------------------------------------------------------------
// AES-128-ECB crypto (from aes-ecb.ts)
// ---------------------------------------------------------------------------

/** Encrypt buffer with AES-128-ECB (PKCS7 padding is default). */
export function encryptAesEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

/** Compute AES-128-ECB ciphertext size (PKCS7 padding to 16-byte boundary). */
export function aesEcbPaddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

// ---------------------------------------------------------------------------
// CDN URL construction (from cdn-url.ts)
// ---------------------------------------------------------------------------

function buildCdnUploadUrl(params: {
  cdnBaseUrl: string;
  uploadParam: string;
  filekey: string;
}): string {
  return `${params.cdnBaseUrl}/upload?encrypted_query_param=${encodeURIComponent(params.uploadParam)}&filekey=${encodeURIComponent(params.filekey)}`;
}

// ---------------------------------------------------------------------------
// CDN upload with retry (from cdn-upload.ts)
// ---------------------------------------------------------------------------

const UPLOAD_MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function uploadBufferToCdn(params: {
  buf: Buffer;
  uploadParam: string;
  filekey: string;
  cdnBaseUrl: string;
  aeskey: Buffer;
}): Promise<{ downloadParam: string }> {
  const { buf, uploadParam, filekey, cdnBaseUrl, aeskey } = params;
  const ciphertext = encryptAesEcb(buf, aeskey);
  const cdnUrl = buildCdnUploadUrl({ cdnBaseUrl, uploadParam, filekey });

  let downloadParam: string | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(cdnUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(ciphertext),
      });

      // 4xx client error: abort immediately
      if (res.status >= 400 && res.status < 500) {
        const errMsg = res.headers.get('x-error-message') ?? (await res.text());
        throw new Error(`CDN upload client error ${res.status}: ${errMsg}`);
      }

      if (res.status !== 200) {
        const errMsg = res.headers.get('x-error-message') ?? `status ${res.status}`;
        throw new Error(`CDN upload server error: ${errMsg}`);
      }

      downloadParam = res.headers.get('x-encrypted-param') ?? undefined;
      if (!downloadParam) {
        throw new Error('CDN upload response missing x-encrypted-param header');
      }
      break;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && err.message.includes('client error')) throw err;
      if (attempt < UPLOAD_MAX_RETRIES) {
        console.warn(`[weixin-cdn] upload attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }

  if (!downloadParam) {
    throw lastError instanceof Error
      ? lastError
      : new Error(`CDN upload failed after ${UPLOAD_MAX_RETRIES} attempts`);
  }
  return { downloadParam };
}

// ---------------------------------------------------------------------------
// Media type detection
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.avi', '.mov', '.wmv', '.mkv']);

// ilink UploadMediaType: IMAGE=1, VIDEO=2, FILE=3
function detectMediaType(filePath: string): number {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 1;
  if (VIDEO_EXTS.has(ext)) return 2;
  return 3; // FILE
}

// ---------------------------------------------------------------------------
// High-level: upload + send (from upload.ts + send-media.ts)
// ---------------------------------------------------------------------------

/**
 * 上传文件到微信 CDN 并通过 sendMessage 发送给用户。
 * 完整链路：读文件 → 生成 AES key → 计算 MD5 → getUploadUrl → 加密上传 → sendMessage
 */
export async function uploadAndSendFile(opts: {
  filePath: string;
  to: string;
  text?: string;
  apiOpts: WeixinApiOptions;
  cdnBaseUrl: string;
  contextToken: string;
}): Promise<{ messageId: string }> {
  const { filePath, to, text, apiOpts, cdnBaseUrl, contextToken } = opts;
  const fileName = path.basename(filePath);
  const mediaType = detectMediaType(filePath);

  // 1. Read file
  const plaintext = await fs.readFile(filePath);
  const rawsize = plaintext.length;
  const rawfilemd5 = crypto.createHash('md5').update(plaintext).digest('hex');
  const filesize = aesEcbPaddedSize(rawsize);
  const filekey = crypto.randomBytes(16).toString('hex');
  const aeskey = crypto.randomBytes(16);

  // 2. Get presigned upload URL
  const uploadResp = await getUploadUrl({
    ...apiOpts,
    filekey,
    mediaType,
    toUserId: to,
    rawsize,
    rawfilemd5,
    filesize,
    aeskey: aeskey.toString('hex'),
  });

  if (!uploadResp.uploadParam) {
    throw new Error('getUploadUrl returned no uploadParam');
  }

  // 3. Encrypt and upload to CDN
  const { downloadParam } = await uploadBufferToCdn({
    buf: plaintext,
    uploadParam: uploadResp.uploadParam,
    filekey,
    cdnBaseUrl,
    aeskey,
  });

  // 4. Send media message via ilink API
  // 与 OpenClaw 一致：hex 字符串的 UTF-8 编码再转 base64
  const aeskeyBase64 = Buffer.from(aeskey.toString('hex')).toString('base64');
  const clientId = crypto.randomBytes(16).toString('hex');

  // MessageItemType 枚举（与 api.ts 一致）
  // TEXT=1, IMAGE=2, VOICE=3, FILE=4, VIDEO=5
  let itemList: any[];
  if (mediaType === 1) {
    // IMAGE
    itemList = [{
      type: 2,
      image_item: {
        media: {
          encrypt_query_param: downloadParam,
          aes_key: aeskeyBase64,
          encrypt_type: 1,
        },
        mid_size: filesize,
      },
    }];
  } else if (mediaType === 2) {
    // VIDEO
    itemList = [{
      type: 5,
      video_item: {
        media: {
          encrypt_query_param: downloadParam,
          aes_key: aeskeyBase64,
          encrypt_type: 1,
        },
        play_length: 0,
      },
    }];
  } else {
    // FILE
    itemList = [{
      type: 4,
      file_item: {
        media: {
          encrypt_query_param: downloadParam,
          aes_key: aeskeyBase64,
          encrypt_type: 1,
        },
        file_name: fileName,
        len: String(rawsize),
      },
    }];
  }

  // 如果有附带文本，加一个 TEXT item
  if (text) {
    itemList.unshift({ type: 1, text_item: { text } });
  }

  // 逐个 item 发送（与 OpenClaw 一致，每个 item 单独一次 sendMessage）
  const base = apiOpts.baseUrl.endsWith('/') ? apiOpts.baseUrl : `${apiOpts.baseUrl}/`;
  const sendUrl = new URL('ilink/bot/sendmessage', base).toString();

  for (const item of itemList) {
    const itemClientId = crypto.randomBytes(16).toString('hex');
    const randomUin = crypto.randomBytes(4).readUInt32BE(0);
    const wechatUin = Buffer.from(String(randomUin), 'utf-8').toString('base64');

    const body = JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: to,
        client_id: itemClientId,
        message_type: 2, // BOT
        message_state: 2, // FINISH
        item_list: [item],
        context_token: contextToken,
      },
    });

    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AuthorizationType': 'ilink_bot_token',
        'Authorization': `Bearer ${apiOpts.token}`,
        'X-WECHAT-UIN': wechatUin,
        'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
      },
      body,
    });

    const resBody = await res.text().catch(() => '');
    if (!res.ok) {
      throw new Error(`sendMessage (media) failed: ${res.status} ${resBody}`);
    }
    // 检查业务错误码
    try {
      const resJson = JSON.parse(resBody);
      if (resJson.errcode && resJson.errcode !== 0) {
        throw new Error(`sendMessage (media) biz error: errcode=${resJson.errcode} errmsg=${resJson.errmsg}`);
      }
      if (resJson.ret && resJson.ret !== 0) {
        throw new Error(`sendMessage (media) ret error: ret=${resJson.ret}`);
      }
    } catch (e: any) {
      if (e.message.includes('error')) throw e;
    }
    console.log(`[wechat-cdn] sendMessage item OK: type=${item.type}, response: ${resBody.slice(0, 300)}`);
  }

  return { messageId: clientId };
}
