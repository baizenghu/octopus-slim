/**
 * 微信扫码登录
 *
 * 移植自 OpenClaw weixin plugin (MIT)。
 * 管理员在终端扫码，token 持久化到 data/weixin/account.json。
 *
 * 参考源码:
 * - /tmp/weixin-plugin/package/src/auth/login-qr.ts
 * - /tmp/weixin-plugin/package/src/channel.ts (auth.login)
 */

import { saveWeixinAccount } from './account';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const BOT_TYPE = '3';
const QR_POLL_TIMEOUT_MS = 35_000;
const LOGIN_TIMEOUT_MS = 5 * 60_000; // 5 minutes

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
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`获取二维码失败: ${res.status} ${res.statusText}`);
  }
  return await res.json() as QRCodeResponse;
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
    if (!res.ok) {
      throw new Error(`轮询状态失败: ${res.status} ${res.statusText}`);
    }
    return await res.json() as StatusResponse;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'wait' }; // long-poll timeout, normal
    }
    throw err;
  }
}

/**
 * 微信扫码登录主流程。
 * 在终端显示 QR 码，等待管理员扫码，成功后保存 token。
 */
export async function weixinLogin(opts?: {
  baseUrl?: string;
  verbose?: boolean;
}): Promise<void> {
  const baseUrl = opts?.baseUrl || DEFAULT_BASE_URL;
  const verbose = opts?.verbose ?? false;

  // Step 1: 获取二维码
  console.log('[微信登录] 正在获取二维码...');
  const qrResponse = await fetchQRCode(baseUrl);

  if (!qrResponse.qrcode_img_content) {
    throw new Error('服务器未返回二维码 URL');
  }

  // Step 2: 终端显示 QR 码
  try {
    const qrt = await import('qrcode-terminal');
    qrt.default.generate(qrResponse.qrcode_img_content, { small: true }, (qr: string) => {
      console.log(qr);
    });
  } catch {
    console.log(`二维码链接: ${qrResponse.qrcode_img_content}`);
  }

  console.log('请使用微信扫描上方二维码...\n');

  // Step 3: 轮询等待扫码结果
  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollQRStatus(baseUrl, qrResponse.qrcode);

    switch (status.status) {
      case 'wait':
        if (verbose) process.stdout.write('.');
        break;

      case 'scaned':
        if (!scannedPrinted) {
          console.log('\n👀 已扫码，请在微信上确认...');
          scannedPrinted = true;
        }
        break;

      case 'expired':
        throw new Error('二维码已过期，请重新执行 ./start.sh weixin-login');

      case 'confirmed': {
        if (!status.bot_token || !status.ilink_bot_id) {
          throw new Error('登录确认但服务器未返回必要信息（bot_token/ilink_bot_id）');
        }

        // Step 4: 保存账号信息
        saveWeixinAccount({
          token: status.bot_token,
          baseUrl: status.baseurl || baseUrl,
          cdnBaseUrl: DEFAULT_CDN_BASE_URL,
          userId: status.ilink_bot_id,
          loginAt: new Date().toISOString(),
        });

        console.log(`\n✅ 微信连接成功！`);
        console.log(`   Bot ID: ${status.ilink_bot_id}`);
        console.log(`   User ID: ${status.ilink_user_id || 'N/A'}`);
        return;
      }
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error('登录超时（5分钟），请重试');
}
