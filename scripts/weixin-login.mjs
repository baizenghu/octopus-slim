#!/usr/bin/env node

/**
 * 微信扫码登录 — 独立脚本
 * 用法: node scripts/weixin-login.mjs
 *       ./start.sh weixin-login
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, '..');

const DATA_ROOT = process.env.DATA_ROOT || path.resolve(PROJECT_DIR, 'data');
const WEIXIN_DIR = path.join(DATA_ROOT, 'weixin');
const ACCOUNTS_DIR = path.join(WEIXIN_DIR, 'accounts');

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';
const DEFAULT_CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
const BOT_TYPE = '3';
const QR_POLL_TIMEOUT_MS = 35000;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

function ensureDir() {
  if (!fs.existsSync(WEIXIN_DIR)) {
    fs.mkdirSync(WEIXIN_DIR, { recursive: true });
  }
}

function saveAccount(userId, account) {
  ensureDir();
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  }
  const accountPath = path.join(ACCOUNTS_DIR, `${userId}.json`);
  const tmp = accountPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(account, null, 2), 'utf-8');
  fs.renameSync(tmp, accountPath);
  try { fs.chmodSync(accountPath, 0o600); } catch {}
}

async function fetchQRCode(baseUrl) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const url = new URL(`ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`, base);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`获取二维码失败: ${res.status}`);
  return await res.json();
}

async function pollStatus(baseUrl, qrcode) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const url = new URL(`ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`轮询失败: ${res.status}`);
    return await res.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') return { status: 'wait' };
    throw err;
  }
}

async function main() {
  // 解析 --user 参数
  const userIdx = process.argv.indexOf('--user');
  const userId = userIdx !== -1 ? process.argv[userIdx + 1] : null;
  if (!userId) {
    console.error('用法: node scripts/weixin-login.mjs --user <octopus-userId>');
    console.error('示例: node scripts/weixin-login.mjs --user user-zhangsan');
    process.exit(1);
  }

  const baseUrl = process.env.WEIXIN_BASE_URL || DEFAULT_BASE_URL;

  console.log(`[微信登录] 正在为用户 ${userId} 启动...`);
  console.log('[微信登录] 正在获取二维码...\n');

  const qr = await fetchQRCode(baseUrl);
  if (!qr.qrcode_img_content) throw new Error('服务器未返回二维码');

  // 显示 QR 码
  console.log(`二维码链接（如终端显示不全，可复制此链接到浏览器打开）:\n${qr.qrcode_img_content}\n`);
  try {
    const require = createRequire(import.meta.url);
    const qrt = require('qrcode-terminal');
    qrt.generate(qr.qrcode_img_content, { small: true }, (text) => console.log(text));
  } catch {}

  console.log('请使用微信扫描上方二维码...\n');

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  let scannedPrinted = false;

  while (Date.now() < deadline) {
    const status = await pollStatus(baseUrl, qr.qrcode);

    if (status.status === 'wait') {
      process.stdout.write('.');
    } else if (status.status === 'scaned' && !scannedPrinted) {
      console.log('\n👀 已扫码，请在微信上确认...');
      scannedPrinted = true;
    } else if (status.status === 'expired') {
      throw new Error('二维码已过期，请重新执行');
    } else if (status.status === 'confirmed') {
      if (!status.bot_token || !status.ilink_bot_id) {
        throw new Error('服务器未返回必要信息');
      }
      saveAccount(userId, {
        token: status.bot_token,
        baseUrl: status.baseurl || baseUrl,
        cdnBaseUrl: DEFAULT_CDN_BASE_URL,
        weixinUserId: status.ilink_bot_id,
        loginAt: new Date().toISOString(),
      });
      console.log(`\n✅ 微信连接成功！`);
      console.log(`   Bot ID: ${status.ilink_bot_id}`);
      console.log(`   绑定用户: ${userId}`);

      // 尝试通知运行中的 gateway 热加载该用户的 adapter
      try {
        const gatewayPort = process.env.GATEWAY_PORT || '18790';
        const internalToken = process.env.INTERNAL_TOKEN || '';
        const notifyRes = await fetch(`http://localhost:${gatewayPort}/api/user/weixin/reload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Token': internalToken,
          },
          body: JSON.stringify({ userId }),
        });
        if (notifyRes.ok) {
          console.log(`   已通知 gateway 热加载，无需重启`);
        } else {
          console.log(`   提示: gateway 未运行或未启用微信，请确保 WEIXIN_ENABLED=true 后重启`);
        }
      } catch {
        console.log(`   提示: 如 gateway 正在运行，请重启以加载新账号: ./start.sh restart`);
      }
      return;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error('登录超时（5分钟）');
}

main().catch(err => {
  console.error(`\n❌ 登录失败: ${err.message}`);
  console.error('可重新执行: ./start.sh weixin-login');
  process.exit(1);
});
