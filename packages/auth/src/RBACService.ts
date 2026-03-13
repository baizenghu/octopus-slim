/**
 * RBAC权限服务
 */

import { User, Role, Permission, ROLE_PERMISSIONS } from './types';

/**
 * RBAC权限服务类
 * 
 * 负责权限检查和资源访问控制
 */
export class RBACService {
  /**
   * 检查用户是否拥有指定权限
   * 
   * @param user 用户
   * @param permission 权限
   * @returns 是否有权限
   */
  hasPermission(user: User, permission: Permission): boolean {
    // 遍历用户的所有角色
    for (const role of user.roles) {
      const rolePermissions = ROLE_PERMISSIONS[role];
      if (rolePermissions && rolePermissions.includes(permission)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查用户是否可以访问指定资源
   * 
   * @param user 当前用户
   * @param resource 资源（带有ownerId属性）
   * @returns 是否可访问
   */
  canAccessResource(user: User, resource: { ownerId: string }): boolean {
    // 管理员可以访问所有资源
    if (user.roles.includes(Role.ADMIN)) {
      return true;
    }
    // 普通用户只能访问自己的资源
    return user.id === resource.ownerId;
  }

  /**
   * 检查用户是否为管理员
   */
  isAdmin(user: User): boolean {
    return user.roles.includes(Role.ADMIN);
  }

  /**
   * 检查用户是否为高级用户或管理员
   */
  isPowerUser(user: User): boolean {
    return user.roles.includes(Role.ADMIN) || user.roles.includes(Role.POWER_USER);
  }

  /**
   * 获取用户的所有权限列表
   */
  getUserPermissions(user: User): Permission[] {
    const permissions = new Set<Permission>();
    for (const role of user.roles) {
      const rolePermissions = ROLE_PERMISSIONS[role];
      if (rolePermissions) {
        rolePermissions.forEach(p => permissions.add(p));
      }
    }
    return Array.from(permissions);
  }

  /**
   * 根据用户角色获取允许使用的工具列表
   */
  getAllowedTools(user: User): string[] {
    const tools: string[] = ['read', 'web_search'];  // 基础工具
    
    if (this.hasPermission(user, Permission.TOOL_FILE_WRITE)) {
      tools.push('write', 'edit');
    }
    
    if (this.hasPermission(user, Permission.TOOL_BASH)) {
      tools.push('bash');
    }
    
    if (this.hasPermission(user, Permission.TOOL_DATABASE)) {
      tools.push('database');
    }
    
    return tools;
  }
}
