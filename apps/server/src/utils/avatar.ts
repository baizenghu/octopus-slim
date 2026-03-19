/**
 * 头像上传公共模块
 *
 * 提供 multer 配置、MIME 白名单、扩展名映射等，
 * 供 auth.ts 和 agents.ts 共用。
 */

import multer from 'multer';
import { getRuntimeConfig } from '../config';

export const AVATAR_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

/** 动态获取头像大小限制（支持运行时配置变更） */
export function getAvatarMaxSize(): number {
  return getRuntimeConfig().upload.maxAvatarSizeBytes;
}

/** 创建头像上传 multer 实例（在路由初始化时调用，而非模块加载时） */
export function createAvatarUpload() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: getRuntimeConfig().upload.maxAvatarSizeBytes },
    fileFilter: (_req, file, cb) => {
      if (AVATAR_ALLOWED_MIME.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('仅支持 PNG/JPG/JPEG/WebP 格式'));
      }
    },
  });
}

export function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
  };
  return map[mime] || 'png';
}
