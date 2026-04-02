/**
 * 文件系统危险路径保护
 * 借鉴 Claude Code src/utils/permissions/filesystem.ts
 * 防止 Agent 误访问 .octopus-state、.env、octopus.json 等敏感文件
 *
 * 集成点建议：
 * - apps/server/src/routes/files.ts — download/*、info/*、delete/* 路由在
 *   path.join(agentWorkspace, rest) 后调用 isPathSafe(fullPath, agentWorkspace)
 * - apps/server/src/routes/chat.ts  — 附件处理中，若涉及文件读写同理集成
 */

import * as nodePath from 'node:path';

/** 禁止访问的危险文件名（精确匹配，不含路径） */
export const DANGEROUS_FILENAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.gitconfig',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  '.ssh',
  '.claude.json',
  '.mcp.json',
  'octopus.json',
  'enterprise.json',
  'credentials.json',
  'service-account.json',
]);

/** 禁止进入的目录名（精确匹配单层目录名） */
export const DANGEROUS_DIRS = new Set([
  '.git',
  '.ssh',
  '.octopus-state',
  '.vscode',
  '.idea',
  '.github',
  'node_modules',
  '.pnpm',
]);

/**
 * 检查绝对路径是否在允许的 workspace 范围内，且不命中危险名单。
 *
 * @param absolutePath 目标绝对路径（传入前请先 path.resolve 处理）
 * @param workspaceRoot agent 的 workspace 根目录（传入前请先 path.resolve 处理）
 * @returns true = 允许访问，false = 拒绝
 */
export function isPathSafe(absolutePath: string, workspaceRoot: string): boolean {
  // 路径规范化，防止残余 .. 或重复 /
  const resolved = nodePath.resolve(absolutePath);
  const wsRoot = nodePath.resolve(workspaceRoot);
  const wsRootSlash = wsRoot.endsWith('/') ? wsRoot : wsRoot + '/';

  // 1. 必须在 workspace 内部（防路径穿越）
  if (resolved !== wsRoot && !resolved.startsWith(wsRootSlash)) {
    return false;
  }

  // 2. 提取相对路径后检查每个路径段
  const relative = resolved.slice(wsRoot.length);
  const segments = relative.split('/').filter(Boolean);

  for (const seg of segments) {
    // 小写化防大小写绕过（参考 CC 设计）
    const lower = seg.toLowerCase();
    if (DANGEROUS_FILENAMES.has(seg) || DANGEROUS_FILENAMES.has(lower)) return false;
    if (DANGEROUS_DIRS.has(seg) || DANGEROUS_DIRS.has(lower)) return false;
  }

  return true;
}

/**
 * 快速检查路径字符串是否含有路径穿越特征。
 * 注意：此函数为早期过滤，不能替代 isPathSafe 的完整校验。
 *
 * @param rawPath 原始路径字符串（未 resolve）
 * @returns true = 发现穿越特征，应拒绝
 */
export function hasPathTraversal(rawPath: string): boolean {
  return (
    rawPath.includes('..') ||
    rawPath.includes('%2e%2e') ||
    rawPath.includes('%2E%2E') ||
    rawPath.includes('%2F')
  );
}
