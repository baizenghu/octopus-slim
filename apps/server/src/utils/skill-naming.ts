/** 生成 skill 在 data/skills/ 下的目录名（全局唯一） */
export function skillDirName(scope: string, skillId: string, ownerId: string | null): string {
  if (scope === 'personal' && ownerId) {
    return `usr_${ownerId}_${skillId}`;
  }
  return `ent_${skillId}`;
}

/** 生成 MCP 项目在 data/mcp-servers/ 下的目录名（全局唯一） */
export function mcpDirName(scope: string, projectName: string, ownerId: string | null): string {
  if (scope === 'personal' && ownerId) {
    return `usr_${ownerId}_${projectName}`;
  }
  return `ent_${projectName}`;
}

/** 生成 SKILL.md 中的 name 字段（引擎按此过滤，必须全局唯一） */
export function skillMdName(scope: string, name: string, ownerId: string | null): string {
  if (scope === 'personal' && ownerId) {
    const short = ownerId.length > 6 ? ownerId.slice(0, 6) : ownerId;
    return `${name}:${short}`;
  }
  return name;
}

/** 从 SKILL.md name 反解出原始 name（去掉 :ownerIdShort 后缀） */
export function parseSkillMdName(mdName: string): { name: string; ownerHint?: string } {
  const idx = mdName.lastIndexOf(':');
  if (idx > 0 && mdName.length - idx <= 7) {
    return { name: mdName.slice(0, idx), ownerHint: mdName.slice(idx + 1) };
  }
  return { name: mdName };
}
