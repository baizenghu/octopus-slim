/**
 * Skills 信息服务 — 将已注册的技能信息注入 AI 系统提示
 *
 * 查询数据库中用户可用的技能（企业级已启用 + 个人已激活），
 * 读取每个技能的 SKILL.md 操作指南，
 * 构建系统提示补充段落，让 AI 知道用户拥有哪些技能及其详细用法。
 */

import * as path from 'path';
import * as fs from 'fs';
import type { AppPrismaClient } from '../types/prisma';
import { getRuntimeConfig } from '../config';

export interface SkillSummary {
  id: string;
  name: string;
  description: string | null;
  scope: 'enterprise' | 'personal';
  ownerId?: string | null;
  version: string | null;
  command: string | null;
  scriptPath: string | null;
  /** SKILL.md 的内容（运行时从磁盘读取） */
  skillMdContent?: string;
  /** 依赖类型：python-packages / node-modules / none 等 */
  depsType?: string;
}

/**
 * 获取用户可用的技能列表，并读取 SKILL.md 内容
 */
export async function getSkillsForUser(
  userId: string,
  prisma: AppPrismaClient,
  dataRoot?: string,
): Promise<SkillSummary[]> {
  try {
    const dbSkills = await prisma.skill.findMany({
      where: {
        enabled: true,
        OR: [
          { scope: 'enterprise', status: 'approved' },
          { scope: 'personal', ownerId: userId, status: 'active' },
        ],
      },
      select: {
        id: true,
        name: true,
        description: true,
        scope: true,
        version: true,
        command: true,
        scriptPath: true,
        ownerId: true,
        scanReport: true,
      },
    });

    // 映射为 SkillSummary，附加 SKILL.md 内容和依赖信息
    const skills: SkillSummary[] = dbSkills.map((row: { id: string; name: string; description: string | null; scope: string; ownerId: string | null; command: string | null; version: string | null; scriptPath: string | null; scanReport: any }) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      scope: row.scope as SkillSummary['scope'],
      version: row.version,
      command: row.command,
      scriptPath: row.scriptPath,
      ownerId: row.ownerId,
      depsType: (row.scanReport as any)?.depsType || undefined,
    }));

    // 读取每个技能的 SKILL.md + 检测依赖结构
    if (dataRoot) {
      for (const skill of skills) {
        try {
          const skillDir = resolveSkillDir(skill, dataRoot, userId);
          const skillMdPath = path.join(skillDir, 'SKILL.md');
          if (fs.existsSync(skillMdPath)) {
            let content = fs.readFileSync(skillMdPath, 'utf-8');
            const maxChars = getRuntimeConfig().skills.maxSkillMdChars;
            if (content.length > maxChars) {
              content = content.substring(0, maxChars) + '\n\n... (内容已截断)';
            }
            skill.skillMdContent = content;
          }
          // 旧数据可能没有 depsType，从文件系统实时检测
          if (!skill.depsType) {
            if (fs.existsSync(path.join(skillDir, 'packages'))) {
              skill.depsType = 'python-packages';
            } else if (fs.existsSync(path.join(skillDir, 'node_modules'))) {
              skill.depsType = 'node-modules';
            }
          }
        } catch (err: any) {
          console.warn(`[skills-info] Failed to read SKILL.md for ${skill.name}:`, err.message);
        }
      }
    }

    return skills;
  } catch (err: any) {
    console.warn('[skills-info] Failed to query skills:', err.message);
    return [];
  }
}

/**
 * 解析技能目录的绝对路径
 */
function resolveSkillDir(skill: Pick<SkillSummary, 'scope' | 'ownerId' | 'id'>, dataRoot: string, userId: string): string {
  if (skill.scope === 'enterprise') {
    return path.join(dataRoot, 'skills', skill.id);
  } else {
    return path.join(dataRoot, 'users', skill.ownerId || userId, 'workspace', 'skills', skill.id);
  }
}

/**
 * 构建包含技能信息的系统提示补充段落
 *
 * 对于有 SKILL.md 内容的技能，直接将操作指南嵌入系统提示，
 * 使 AI 能按照 SKILL.md 中定义的工作流自主执行技能。
 */
export function buildSkillsSystemPromptSection(skills: SkillSummary[]): string {
  if (skills.length === 0) return '';

  const enterpriseSkills = skills.filter(s => s.scope === 'enterprise');
  const personalSkills = skills.filter(s => s.scope === 'personal');

  const lines: string[] = [];
  lines.push('\n\n## 可用技能');
  lines.push('\n以下技能已启用。**使用方式：调用 `run_skill` 工具，参数说明：**');
  lines.push('- `skill_name`（必填）：技能名称');
  lines.push('- `script`（可选）：指定要执行的脚本相对路径，如 `"scripts/data_analyzer.py"`。多脚本技能必须指定此参数。');
  lines.push('- `args`（可选）：传递给脚本的命令行参数字符串，如 `"sales.xlsx --json"`');
  lines.push('');
  lines.push('**严禁手动用 exec 执行技能脚本。所有文件路径都是相对于用户工作空间的相对路径，不要使用 /workspace/ 等绝对路径。**\n');

  if (enterpriseSkills.length > 0) {
    lines.push('### 企业级技能');
    for (const s of enterpriseSkills) {
      const desc = s.description ? ` — ${s.description}` : '';
      const ver = s.version ? ` (v${s.version})` : '';
      lines.push(`- **${s.name}**${ver}${desc}`);
      lines.push(`  调用方式: \`run_skill(skill_name="${s.name}")\``);
    }
    lines.push('');
  }

  if (personalSkills.length > 0) {
    lines.push('### 个人技能');
    for (const s of personalSkills) {
      const desc = s.description ? ` — ${s.description}` : '';
      const ver = s.version ? ` (v${s.version})` : '';
      lines.push(`- **${s.name}**${ver}${desc}`);
      lines.push(`  调用方式: \`run_skill(skill_name="${s.name}")\``);
    }
    lines.push('');
  }

  lines.push('当用户触发技能时，**必须通过 `run_skill` 工具调用技能**（如下方操作指南所述），**严禁自行编写替代脚本或手动用 exec 执行**。');

  // 嵌入每个技能的 SKILL.md 操作指南
  const skillsWithMd = skills.filter(s => s.skillMdContent);
  if (skillsWithMd.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('## 技能操作指南');
    lines.push('');
    lines.push('以下是每个技能的详细操作指南。注意：**不要手动执行脚本，必须通过 `run_skill` 工具调用**。');

    for (const s of skillsWithMd) {
      lines.push('');
      lines.push(`### 📋 ${s.name}`);
      lines.push('');
      // 保留 SKILL.md 内容作为参考（输入输出格式、参数说明等）
      // {{SKILL_DIR}} 路径由 run_skill 内部处理，Agent 无需关心
      const content = s.skillMdContent!.replace(/\{\{SKILL_DIR\}\}/g, '(由 run_skill 自动处理)');
      lines.push(content);
      lines.push('');
    }
  }

  return lines.join('\n');
}
