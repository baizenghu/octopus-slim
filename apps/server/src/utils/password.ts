/**
 * 密码强度校验
 *
 * 等保 2.0 要求：至少 8 位，包含大小写字母、数字、特殊字符中的至少 3 类
 */

const MIN_LENGTH = 8;

/** 检查密码包含的字符类型数量 */
function countCharTypes(password: string): number {
  let types = 0;
  if (/[a-z]/.test(password)) types++;
  if (/[A-Z]/.test(password)) types++;
  if (/[0-9]/.test(password)) types++;
  if (/[^a-zA-Z0-9]/.test(password)) types++;
  return types;
}

/**
 * 校验密码强度，返回错误信息或 null（通过）
 */
export function validatePassword(password: string): string | null {
  if (!password) {
    return '密码不能为空';
  }
  if (password.length < MIN_LENGTH) {
    return `密码长度至少 ${MIN_LENGTH} 位`;
  }
  if (countCharTypes(password) < 3) {
    return '密码需包含大写字母、小写字母、数字、特殊字符中的至少 3 类';
  }
  return null;
}
