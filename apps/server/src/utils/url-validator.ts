import { URL } from 'url';

const BLOCKED_HOSTS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
  /^host\.docker\.internal$/i,
  /^\[::1\]$/,
  /^\[fe80:/i,
];

export function validateMcpUrl(rawUrl: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: 'URL 格式不合法' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: `不支持的协议: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname;
  for (const pattern of BLOCKED_HOSTS) {
    if (pattern.test(hostname)) {
      return { valid: false, error: `不允许访问内网地址: ${hostname}` };
    }
  }

  return { valid: true };
}
