/**
 * WorkspaceTools — 企业上下文构建器
 *
 * 注意：文件读写/执行工具现在由原生 Octopus Gateway 的 group:fs 工具处理，
 * 企业层只需构建额外的系统提示上下文（用户信息、工作区路径等）。
 */

import type { WorkspaceManager } from '@octopus/workspace';

/**
 * 构建企业级额外上下文（注入到原生 agent 的 extraSystemPrompt）
 * 已迁移到 chat.ts 的 buildEnterpriseSystemPrompt()，此处保留以供其他模块引用。
 */
export async function buildEnterpriseContext(
  workspaceManager: WorkspaceManager,
  userId: string,
  username: string,
  agentConfig?: { name?: string; systemPrompt?: string; identity?: { name?: string; emoji?: string } },
): Promise<string> {
  const workspacePath = workspaceManager.getSubPath(userId, 'WORKSPACE');
  const sections: string[] = [];

  sections.push(`## 用户信息\n当前用户: ${username}`);
  sections.push(
    `## 工作区\n` +
    `用户文件目录: ${workspacePath}\n\n` +
    `**安全约束（必须遵守）：**\n` +
    `- 所有文件读写操作只能在 ${workspacePath} 目录内进行\n` +
    `- 严禁访问、读取或修改该目录之外的任何文件或目录\n` +
    `- 严禁访问其他用户的目录或系统敏感文件（如 /etc/passwd、~/.ssh 等）\n` +
    `- Shell 命令执行已被系统级禁用，请勿尝试`,
  );

  if (agentConfig?.systemPrompt) {
    sections.push(`## Agent 指令\n${agentConfig.systemPrompt}`);
  }

  return sections.join('\n\n');
}
