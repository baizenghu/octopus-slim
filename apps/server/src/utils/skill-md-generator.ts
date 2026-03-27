import { skillMdName } from './skill-naming';

export interface SkillMdParams {
  name: string;
  description: string;
  scope: string;
  ownerId: string | null;
  command?: string | null;
  scriptPath?: string | null;
  version?: string | null;
}

/** 生成标准 SKILL.md frontmatter（引擎可识别格式） */
export function generateSkillMd(params: SkillMdParams): string {
  const mdName = skillMdName(params.scope, params.name, params.ownerId);
  // 包含特殊字符时用引号包裹
  const quotedName = /[:"']/.test(mdName) ? `"${mdName}"` : mdName;

  const lines = [
    '---',
    `name: ${quotedName}`,
    `description: ${params.description}`,
  ];
  if (params.version) lines.push(`version: ${params.version}`);

  // command-dispatch: tool 让引擎知道 /skill_name 命令应调用 run_skill 工具
  lines.push('command-dispatch: tool');
  lines.push('command-tool: run_skill');

  lines.push('---');
  return lines.join('\n') + '\n';
}

/**
 * 合并：用新 frontmatter 替换已有 SKILL.md 的 frontmatter，保留 body。
 * 如果原文件无 frontmatter，则在头部插入。
 */
export function mergeSkillMd(existing: string, params: SkillMdParams): string {
  const newFrontmatter = generateSkillMd(params);
  const fmRegex = /^---\s*\n[\s\S]*?\n---\s*\n?/;
  if (fmRegex.test(existing)) {
    return existing.replace(fmRegex, newFrontmatter + '\n');
  }
  return newFrontmatter + '\n' + existing;
}
