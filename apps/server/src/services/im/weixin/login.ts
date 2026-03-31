/**
 * 微信扫码登录
 *
 * v2: 支持 API 调用（start + check 拆分）和 CLI 调用。
 * 移植自 OpenClaw weixin plugin (MIT)。
 */

import { saveWeixinAccount, type WeixinAccount } from './account';
import { createLogger } from '../../../utils/logger';

const logger = createLogger('login');

export const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
export const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const BOT_TYPE = '3';
const QR_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

interface StatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

async function fetchQRCode(baseUrl: string): Promise<QRCodeResponse> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, base);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`获取二维码失败: ${res.status} ${res.statusText}`);
    }
    return await res.json() as QRCodeResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function pollQRStatus(baseUrl: string, qrcode: string): Promise<StatusResponse> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`轮询状态失败: ${res.status}`);
    return await res.json() as StatusResponse;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') return { status: 'wait' };
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 活跃登录会话（内存管理，支持多用户同时扫码）
// ---------------------------------------------------------------------------

interface ActiveLogin {
  qrcode: string;
  qrcodeUrl: string;
  baseUrl: string;
  startedAt: number;
}

const activeLogins = new Map<string, ActiveLogin>();  // sessionKey → login

/** 发起扫码登录（供 API 路由调用） */
export async function startWeixinLogin(sessionKey: string, baseUrl?: string): Promise<{
  qrcodeUrl: string;
  sessionKey: string;
}> {
  const apiBase = baseUrl || DEFAULT_BASE_URL;
  const qr = await fetchQRCode(apiBase);
  if (!qr.qrcode_img_content) throw new Error('服务器未返回二维码');

  activeLogins.set(sessionKey, {
    qrcode: qr.qrcode,
    qrcodeUrl: qr.qrcode_img_content,
    baseUrl: apiBase,
    startedAt: Date.now(),
  });

  // 5 分钟后自动清理
  setTimeout(() => activeLogins.delete(sessionKey), LOGIN_TIMEOUT_MS);

  return { qrcodeUrl: qr.qrcode_img_content, sessionKey };
}

/** 检查扫码状态（供 API 路由轮询） */
export async function checkWeixinLoginStatus(sessionKey: string): Promise<{
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'not_found';
  account?: WeixinAccount;
}> {
  const login = activeLogins.get(sessionKey);
  if (!login) return { status: 'not_found' };

  // 超时检查
  if (Date.now() - login.startedAt > LOGIN_TIMEOUT_MS) {
    activeLogins.delete(sessionKey);
    return { status: 'expired' };
  }

  const result = await pollQRStatus(login.baseUrl, login.qrcode);

  if (result.status === 'confirmed') {
    activeLogins.delete(sessionKey);
    if (!result.bot_token || !result.ilink_bot_id) {
      throw new Error('登录确认但服务器未返回必要信息');
    }
    return {
      status: 'confirmed',
      account: {
        token: result.bot_token,
        baseUrl: result.baseurl || login.baseUrl,
        cdnBaseUrl: DEFAULT_CDN_BASE_URL,
        weixinUserId: result.ilink_bot_id,
        loginAt: new Date().toISOString(),
      },
    };
  }

  if (result.status === 'expired') {
    activeLogins.delete(sessionKey);
  }

  return { status: result.status };
}

// ---------------------------------------------------------------------------
// CLI 扫码（保留，供 ./start.sh weixin-login 使用）
// ---------------------------------------------------------------------------

export async function weixinLoginCLI(opts: {
  userId: string;
  baseUrl?: string;
  verbose?: boolean;
}): Promise<void> {
  const baseUrl = opts.baseUrl || DEFAULT_BASE_URL;

  logger.info('[微信登录] 正在获取二维码...');
  const qr = await fetchQRCode(baseUrl);
  if (!qr.qrcode_img_content) throw new Error('服务器未返回二维码 URL');

  logger.info(`二维码链接: ${qr.qrcode_img_content}`);
  try {
    const qrt = await import('qrcode-terminal');
    qrt.default.generate(qr.qrcode_img_content, { small: true }, (text: string) => {
      logger.info(text);
    });
  } catch { /* qrcode-terminal not available */ }

  logger.info('请使用微信扫描上方二维码...');

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(baseUrl, qr.qrcode);

    switch (status.status) {
      case 'wait':
        if (opts.verbose) process.stdout.write('.');
        break;
      case 'scaned':
        if (!scannedPrinted) {
          logger.info('已扫码，请在微信上确认...');
          scannedPrinted = true;
        }
        break;
      case 'expired':
        throw new Error('二维码已过期');
      case 'confirmed': {
        if (!status.bot_token || !status.ilink_bot_id) {
          throw new Error('服务器未返回必要信息');
        }
        saveWeixinAccount(opts.userId, {
          token: status.bot_token,
          baseUrl: status.baseurl || baseUrl,
          cdnBaseUrl: DEFAULT_CDN_BASE_URL,
          weixinUserId: status.ilink_bot_id,
          loginAt: new Date().toISOString(),
        });
        logger.info('微信连接成功', { botId: status.ilink_bot_id, userId: opts.userId });
        return;
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('登录超时（5分钟）');
}
