/**
 * 从 agentId 中提取 userId
 *
 * 命名规则: ent_{userId}_{agentName}
 * 例: ent_user-baizh_default → user-baizh
 */
export function extractUserId(agentId?: string): string | null {
  if (!agentId?.startsWith('ent_')) return null;
  const withoutPrefix = agentId.slice(4);
  const lastUnderscore = withoutPrefix.lastIndexOf('_');
  if (lastUnderscore === -1) return null;
  return withoutPrefix.slice(0, lastUnderscore);
}

/**
 * 获取当天日期字符串 YYYY-MM-DD
 */
export function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}
