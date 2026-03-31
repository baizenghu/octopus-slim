/**
 * 用户归属校验工具
 * 验证资源（session/agent/task）是否属于当前用户
 *
 * 安全说明：使用 startsWith 而非 includes，防止构造恶意 ID 绕过校验
 */

/**
 * 校验 session key 是否属于指定用户
 * session key 格式: agent:ent_{userId}_{agentName}:session:{uuid}
 */
export function validateSessionOwnership(sessionId: string, userId: string): boolean {
  if (sessionId.startsWith('agent:')) {
    return sessionId.startsWith(`agent:ent_${userId}_`);
  }
  // 短 ID 格式（仅 UUID）— 无法校验归属
  return false;
}
