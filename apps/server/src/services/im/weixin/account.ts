/**
 * 微信账号持久化
 *
 * 管理 bot token、API 地址和 long-poll 游标的文件存储。
 * 存储路径: data/weixin/account.json + data/weixin/sync-buf.json
 */

import * as fs from 'fs';
import * as path from 'path';

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
  try { fs.chmodSync(filePath, 0o600); } catch { /* ignore */ }
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
