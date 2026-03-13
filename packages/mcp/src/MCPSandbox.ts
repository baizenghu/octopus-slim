/**
 * MCPSandbox — MCP Server 安全策略
 *
 * 安全策略：
 * - 限制可执行命令白名单
 * - 校验脚本路径必须在允许的目录内（防止路径穿越）
 * - 环境变量过滤（禁止泄露系统密钥）
 * - 资源限制（超时）
 */

import * as path from 'path';
import * as fs from 'fs';
import type { MCPServerConfig } from './types';

/** 安全策略 */
export interface SandboxPolicy {
  /** 允许执行的命令白名单（正则） */
  allowedCommands: RegExp[];
  /** 禁止传递的环境变量前缀 */
  blockedEnvPrefixes: string[];
  /** 最大执行时间(ms) */
  maxExecutionTime: number;
}

/** 默认安全策略 */
const DEFAULT_POLICY: SandboxPolicy = {
  allowedCommands: [
    /^(node|python3?|npx|tsx|ts-node)$/,
    /^\/usr\/(local\/)?bin\/(node|python3?|npx)$/,
  ],
  blockedEnvPrefixes: [
    'JWT_', 'LDAP_', 'DATABASE_', 'REDIS_',
    'AWS_', 'AZURE_', 'GCP_',
    'ADMIN_', 'SUPER_', 'ROOT_',
  ],
  maxExecutionTime: 60_000,
};

export class MCPSandbox {
  private policy: SandboxPolicy;

  constructor(policy?: Partial<SandboxPolicy>) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  /**
   * 验证 MCP Server 配置是否符合安全策略（命令白名单 + transport 限制）
   *
   * @returns 通过返回 null，不通过返回拒绝原因
   */
  validate(config: MCPServerConfig): string | null {
    // HTTP 模式跳过命令白名单和路径校验
    if (config.transport === 'http') return null;

    // 个人 MCP 额外检查命令白名单
    if (config.scope !== 'personal') return null;

    // 检查命令白名单
    if (config.command) {
      const cmdBase = config.command.split('/').pop() || config.command;
      const allowed = this.policy.allowedCommands.some(re => re.test(cmdBase) || re.test(config.command!));
      if (!allowed) {
        return `命令 "${config.command}" 不在白名单中，允许: node, python3, npx, tsx, ts-node`;
      }
    }

    return null;
  }

  /**
   * 校验 MCP Server 脚本路径是否在允许的基目录内
   *
   * 检查 args 中所有看起来像文件路径的参数（以 / 或 ./ 开头），
   * 确保它们解析后在 allowedBase 目录内，防止路径穿越攻击。
   *
   * @param config MCP Server 配置
   * @param allowedBase 允许的基目录绝对路径
   * @returns 通过返回 null，不通过返回拒绝原因
   */
  validatePaths(config: MCPServerConfig, allowedBase: string): string | null {
    if (config.transport !== 'stdio') return null;
    if (!config.args || config.args.length === 0) return null;

    const resolvedBase = path.resolve(allowedBase);

    for (const arg of config.args) {
      // 安全检查 1：检测所有字符串中嵌入的路径穿越模式（不限于"看起来像路径"的参数）
      if (this.containsTraversalPattern(arg)) {
        return `参数 "${arg}" 包含路径穿越模式（../ 或 %2e%2e）`;
      }

      // 安全检查 2：识别路径参数并校验是否在允许目录内
      if (arg.startsWith('/') || arg.startsWith('./') || arg.startsWith('../') || /\.\w+$/.test(arg)) {
        const resolvedArg = path.resolve(resolvedBase, arg);

        // 检查路径穿越
        if (!resolvedArg.startsWith(resolvedBase + path.sep) && resolvedArg !== resolvedBase) {
          return `路径 "${arg}" 不在允许的目录 "${allowedBase}" 内`;
        }

        // 检查符号链接
        try {
          if (fs.existsSync(resolvedArg)) {
            const realPath = fs.realpathSync(resolvedArg);
            if (!realPath.startsWith(resolvedBase + path.sep) && realPath !== resolvedBase) {
              return `路径 "${arg}" 指向的实际位置不在允许的目录内（符号链接检测）`;
            }
          }
        } catch {
          // 文件不存在时跳过符号链接检查（用户可能稍后上传）
        }
      }
    }

    return null;
  }

  /**
   * 检测字符串中是否包含路径穿越模式
   * 包括：../ 序列、URL 编码的 ..（%2e%2e）、null 字节
   */
  private containsTraversalPattern(value: string): boolean {
    // 直接的 ../ 或 ..\
    if (/\.\.[\\/]/.test(value)) return true;
    // URL 编码的 .. (%2e = '.')
    if (/%2e%2e/i.test(value)) return true;
    // null 字节注入（可绕过路径校验）
    if (value.includes('\0')) return true;
    return false;
  }

  /**
   * 清理环境变量，移除敏感信息
   */
  sanitizeEnv(env?: Record<string, string>): Record<string, string> {
    if (!env) return {};

    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      const blocked = this.policy.blockedEnvPrefixes.some(prefix =>
        key.toUpperCase().startsWith(prefix),
      );
      if (!blocked) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  /**
   * 获取超时时间
   */
  getMaxExecutionTime(): number {
    return this.policy.maxExecutionTime;
  }
}
