import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const key = process.env.DB_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('DB_ENCRYPTION_KEY 环境变量未设置');
  }
  const buf = Buffer.from(key, 'hex');
  if (buf.length !== 32) {
    throw new Error('DB_ENCRYPTION_KEY 必须是 64 位十六进制字符串（32 字节）');
  }
  return buf;
}

/**
 * 加密密码，返回 hex 格式: iv:tag:encrypted
 */
export function encryptPassword(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * 解密密码
 *
 * 如果格式不匹配（非 iv:tag:encrypted），假定为未加密旧数据并返回原文（带告警）。
 * 如果解密失败（密钥错误/数据损坏），记录错误日志并返回原文。
 */
export function decryptPassword(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    // 格式不匹配：可能是未加密的旧数据
    if (ciphertext.length > 0) {
      console.warn('[crypto] decryptPassword: 输入不是加密格式，返回原文（可能是未加密旧数据）');
    }
    return ciphertext;
  }
  const [ivHex, tagHex, encHex] = parts;
  try {
    const key = getKey();
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    // 解密失败：密钥错误或数据损坏
    console.error(`[crypto] decryptPassword: 解密失败（密钥可能已更换或数据损坏）: ${err.message}`);
    return ciphertext;
  }
}