/**
 * 微信多账号持久化
 *
 * v2: 每个 Octopus 用户独立的微信账号。
 * 存储路径:
 *   data/weixin/accounts/{userId}.json  — 账号信息
 *   data/weixin/sync-buf/{userId}.json  — long-poll 游标
 */

import * as fs from 'fs';
import * as path from 'path';

export interface WeixinAccount {
  token: string;
  baseUrl: string;
  cdnBaseUrl: string;
  weixinUserId: string;  // bot 的微信 ID（如 33f58c3c7112@im.bot）
  loginAt: string;
}

const DATA_ROOT = process.env.DATA_ROOT || path.resolve(process.cwd(), 'data');
const ACCOUNTS_DIR = path.join(DATA_ROOT, 'weixin', 'accounts');
const SYNC_BUF_DIR = path.join(DATA_ROOT, 'weixin', 'sync-buf');

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function atomicWrite(filePath: string, data: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
  try { fs.chmodSync(filePath, 0o600); } catch { /* ignore */ }
}

function accountPath(userId: string): string {
  return path.join(ACCOUNTS_DIR, `${userId}.json`);
}

function syncBufPath(userId: string): string {
  return path.join(SYNC_BUF_DIR, `${userId}.json`);
}

// --- 账号管理 ---

export function loadWeixinAccount(userId: string): WeixinAccount | null {
  try {
    return JSON.parse(fs.readFileSync(accountPath(userId), 'utf-8')) as WeixinAccount;
  } catch {
    return null;
  }
}

export function saveWeixinAccount(userId: string, account: WeixinAccount): void {
  atomicWrite(accountPath(userId), JSON.stringify(account, null, 2));
}

export function deleteWeixinAccount(userId: string): void {
  try { fs.unlinkSync(accountPath(userId)); } catch { /* ignore */ }
  try { fs.unlinkSync(syncBufPath(userId)); } catch { /* ignore */ }
}

/** 列出所有已绑定微信的用户 ID */
export function listAllAccountUserIds(): string[] {
  try {
    ensureDir(ACCOUNTS_DIR);
    return fs.readdirSync(ACCOUNTS_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch {
    return [];
  }
}

// --- 游标持久化 ---

export function loadSyncBuf(userId: string): string {
  try {
    return JSON.parse(fs.readFileSync(syncBufPath(userId), 'utf-8')).buf || '';
  } catch {
    return '';
  }
}

export function saveSyncBuf(userId: string, buf: string): void {
  atomicWrite(syncBufPath(userId), JSON.stringify({ buf, savedAt: new Date().toISOString() }));
}
