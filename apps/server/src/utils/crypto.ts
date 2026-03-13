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
 */
export function decryptPassword(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    // 兼容未加密的旧数据（明文密码）
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
  } catch {
    // 解密失败，可能是未加密的旧数据
    return ciphertext;
  }
}

/**
 * 判断密码是否已加密（格式为 hex:hex:hex）
 */
export function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/.test(value);
}
