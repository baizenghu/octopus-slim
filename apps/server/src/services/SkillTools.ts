/**
 * Skill 执行工具 — 供 AI Function Calling 使用
 *
 * 定义 run_skill 工具，让 AI 能在对话中实际调用已注册的技能脚本。
 *
 * 执行流程:
 * 1. AI 调用 run_skill(skill_name, args)
 * 2. 从数据库查找已启用的技能
 * 3. 解析技能目录路径（企业级 / 个人）
 * 4. 通过 SkillExecutor 执行脚本
 * 5. 返回执行结果（stdout / stderr / 输出文件列表）
 */

import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { SkillExecutor, SkillInfo as SkillTypeInfo } from '@octopus/skills';
import type { AppPrismaClient } from '../types/prisma';

// ========== 工具定义 ==========

export const SKILL_TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_skill',
      description: '执行已注册的技能脚本。根据技能名称自动查找对应脚本并在用户工作空间中隔离执行。执行结果包括标准输出、错误输出和生成的文件列表。',
      parameters: {
        type: 'object',
        properties: {
          skill_name: {
            type: 'string',
            description: '技能名称，与可用技能列表中的名称一致',
          },
          args: {
            type: 'string',
            description: '传递给脚本的命令行参数字符串，例如 "--data sales.xlsx --output outputs/report.html"。如果不需要参数可以留空。',
          },
        },
        required: ['skill_name'],
      },
    },
  },
];

// ========== 工具识别 ==========

/**
 * 检查工具名是否为 Skill 工具
 */
export function isSkillTool(toolName: string): boolean {
  return toolName === 'run_skill';
}

// ========== 工具执行 ==========

/**
 * 执行 Skill 工具调用
 */
export async function executeSkillToolCall(
  toolName: string,
  args: Record<string, any>,
  userId: string,
  prisma: AppPrismaClient,
  skillExecutor: SkillExecutor,
  dataRoot: string,
  userEnv?: Record<string, string>,
): Promise<string> {
  if (toolName !== 'run_skill') {
    return JSON.stringify({ error: `未知的技能工具: ${toolName}` });
  }

  const skillName = args.skill_name;
  if (!skillName) {
    return JSON.stringify({ error: '缺少 skill_name 参数' });
  }

  try {
    // 1. 从数据库查找技能
    const skill = await prisma.skill.findFirst({
      where: {
        name: skillName,
        enabled: true,
        OR: [
          { scope: 'enterprise', status: 'approved' },
          { scope: 'personal', ownerId: userId, status: 'active' },
        ],
      },
    });

    if (!skill) {
      return JSON.stringify({
        error: `未找到可用的技能: "${skillName}"。请确认技能名称正确且已启用。`,
      });
    }

    // 2. 解析技能目录路径
    const skillPath = resolveSkillPath(skill, dataRoot, userId);
    if (!fs.existsSync(skillPath)) {
      return JSON.stringify({
        error: `技能目录不存在: ${skillPath}。技能可能未正确安装。`,
      });
    }

    // 3. 确定要执行的脚本
    const scriptPath = await resolveScriptPath(skill, skillPath);
    if (!scriptPath) {
      return JSON.stringify({
        error: `无法确定技能 "${skillName}" 的入口脚本。请检查技能的 SKILL.md 配置或目录中是否包含可执行脚本。`,
      });
    }

    // 4. 解析用户工作空间路径，确保 workspace 和 outputs 目录存在
    const userWorkspacePath = path.join(dataRoot, 'users', userId, 'workspace');
    const outputsPath = path.join(userWorkspacePath, 'outputs');
    if (!fs.existsSync(outputsPath)) {
      await fsp.mkdir(outputsPath, { recursive: true });
    }

    // 5. 检测 packages/ 目录，自动注入 PYTHONPATH
    const packagesDir = path.join(skillPath, 'packages');
    const hasPackages = fs.existsSync(packagesDir);
    if (hasPackages) {
      const sandboxPackagesPath = skill.scope === 'enterprise'
        ? `/opt/skills/${skill.id}/packages`
        : `/workspace/skills/${skill.id}/packages`;
      userEnv = { ...userEnv, PYTHONPATH: sandboxPackagesPath };
    }

    // 6. 解析参数
    const argsStr = args.args || '';
    const argsArray = argsStr ? parseArgs(argsStr) : [];

    // 7. 构建 SkillInfo 对象（SkillExecutor 需要）
    const skillInfo: SkillTypeInfo = {
      id: skill.id,
      name: skill.name,
      description: skill.description || '',
      scope: skill.scope as 'enterprise' | 'personal',
      ownerId: skill.ownerId,
      version: skill.version || '1.0.0',
      status: skill.status as any,
      skillPath,
      scanReport: null,
      enabled: skill.enabled,
      createdAt: skill.createdAt,
      updatedAt: skill.createdAt,
    };

    // 8. 执行
    console.log(`[skill-tools] Executing skill "${skillName}" (${skill.id}), script: ${scriptPath}, args: [${argsArray.join(', ')}], depsType: ${hasPackages ? 'python-packages' : 'none'}`);

    const result = await skillExecutor.execute(
      skillInfo,
      {
        skillId: skill.id,
        userId,
        scriptPath,
        args: argsArray,
      },
      userWorkspacePath,
      userEnv,
    );

    // 9. 构建返回结果
    const response: Record<string, any> = {
      success: result.success,
      exitCode: result.exitCode,
      duration: `${result.duration}ms`,
    };

    if (result.stdout) {
      // 截断过长的输出
      response.stdout = result.stdout.length > 5000
        ? result.stdout.substring(0, 5000) + '\n... (输出已截断)'
        : result.stdout;
    }

    if (result.stderr) {
      response.stderr = result.stderr.length > 2000
        ? result.stderr.substring(0, 2000) + '\n... (错误输出已截断)'
        : result.stderr;
    }

    if (result.outputFiles && result.outputFiles.length > 0) {
      response.outputFiles = result.outputFiles;
      response.message = `技能执行${result.success ? '成功' : '失败'}，生成了 ${result.outputFiles.length} 个文件到 outputs/ 目录`;
    } else {
      response.message = `技能执行${result.success ? '成功' : '失败'}`;
    }

    return JSON.stringify(response);
  } catch (err: any) {
    console.error(`[skill-tools] Error executing skill "${skillName}":`, err.message);
    return JSON.stringify({
      error: `技能执行出错: ${err.message}`,
    });
  }
}

// ========== 辅助函数 ==========

/**
 * 根据技能的 scope 解析代码目录绝对路径
 */
function resolveSkillPath(skill: any, dataRoot: string, userId: string): string {
  if (skill.scope === 'enterprise') {
    return path.join(dataRoot, 'skills', skill.id);
  } else {
    return path.join(dataRoot, 'users', skill.ownerId || userId, 'workspace', 'skills', skill.id);
  }
}

/**
 * 确定技能的入口脚本路径（相对于 skill 目录）
 *
 * 优先级:
 * 1. 数据库中的 command 字段
 * 2. 数据库中的 scriptPath 字段
 * 3. 自动检测常见入口文件
 */
async function resolveScriptPath(skill: any, skillPath: string): Promise<string | null> {
  // 1. 使用 command 字段（如果是脚本路径）
  if (skill.command) {
    const cmdPath = skill.command.split(' ')[0]; // 取命令第一部分
    if (fs.existsSync(path.join(skillPath, cmdPath))) {
      return cmdPath;
    }
  }

  // 2. 使用 scriptPath 字段
  if (skill.scriptPath) {
    if (fs.existsSync(path.join(skillPath, skill.scriptPath))) {
      return skill.scriptPath;
    }
  }

  // 3. 自动检测常见入口文件
  const candidates = [
    'main.py', 'index.py', 'run.py', 'app.py',
    'main.js', 'index.js', 'run.js',
    'main.sh', 'run.sh', 'start.sh',
    'main.ts', 'index.ts',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(skillPath, candidate))) {
      return candidate;
    }
  }

  // 4. 搜索 scripts/ 子目录
  const scriptsDir = path.join(skillPath, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    try {
      const entries = await fsp.readdir(scriptsDir);
      const scriptFile = entries.find(f =>
        /\.(py|js|sh|ts)$/.test(f)
      );
      if (scriptFile) {
        return path.join('scripts', scriptFile);
      }
    } catch { /* ignore */ }
  }

  return null;
}

/**
 * 解析参数字符串为数组
 * 支持简单引号分隔: --data "my file.xlsx" --output report.html
 */
function parseArgs(argsStr: string): string[] {
  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];

    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}
