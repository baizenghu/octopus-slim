/**
 * 一次性迁移脚本：将 data/skills/ 下的 skill 目录统一为新命名规范
 *
 * 新规范：
 *   - enterprise scope: ent_{skillId}
 *   - personal scope:   usr_{ownerId}_{skillId}
 *
 * 用法：
 *   npx tsx scripts/migrate-skills.ts           # 执行迁移
 *   npx tsx scripts/migrate-skills.ts --dry-run  # 只打印计划不执行
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// tsx 下 __dirname 不可用，手动计算
const __filename_resolved = fileURLToPath(import.meta.url);
const __dirname_resolved = path.dirname(__filename_resolved);

// ── 内联工具函数（来自 skill-naming.ts + skill-md-generator.ts） ──

/** 生成 skill 在 data/skills/ 下的目录名（全局唯一） */
function skillDirName(scope: string, skillId: string, ownerId: string | null): string {
  if (scope === 'personal' && ownerId) {
    return `usr_${ownerId}_${skillId}`;
  }
  return `ent_${skillId}`;
}

/** 生成 SKILL.md 中的 name 字段（引擎按此过滤，必须全局唯一） */
function skillMdName(scope: string, name: string, ownerId: string | null): string {
  if (scope === 'personal' && ownerId) {
    const short = ownerId.length > 6 ? ownerId.slice(0, 6) : ownerId;
    return `${name}:${short}`;
  }
  return name;
}

interface SkillMdParams {
  name: string;
  description: string;
  scope: string;
  ownerId: string | null;
  command?: string | null;
  scriptPath?: string | null;
  version?: string | null;
}

/** 生成标准 SKILL.md frontmatter（引擎可识别格式） */
function generateSkillMd(params: SkillMdParams): string {
  const mdName = skillMdName(params.scope, params.name, params.ownerId);
  const quotedName = /[:"']/.test(mdName) ? `"${mdName}"` : mdName;
  const lines = [
    '---',
    `name: ${quotedName}`,
    `description: ${params.description}`,
  ];
  if (params.version) lines.push(`version: ${params.version}`);
  lines.push('command-dispatch: tool');
  lines.push('command-tool: run_skill');
  lines.push('---');
  return lines.join('\n') + '\n';
}

/** 合并：用新 frontmatter 替换已有 SKILL.md 的 frontmatter，保留 body */
function mergeSkillMd(existing: string, params: SkillMdParams): string {
  const newFrontmatter = generateSkillMd(params);
  const fmRegex = /^---\s*\n[\s\S]*?\n---\s*\n?/;
  if (fmRegex.test(existing)) {
    return existing.replace(fmRegex, newFrontmatter + '\n');
  }
  return newFrontmatter + '\n' + existing;
}

// ── 配置 ──────────────────────────────────────────────
const SKILLS_DIR = path.resolve(__dirname_resolved, '..', 'data', 'skills');
const DRY_RUN = process.argv.includes('--dry-run');

// 需要跳过的特殊目录和文件
const SKIP_ENTRIES = new Set(['.venv', 'requirements.txt']);

// ── 日志工具 ──────────────────────────────────────────
function info(msg: string): void {
  console.log(`[INFO]  ${msg}`);
}
function warn(msg: string): void {
  console.log(`[WARN]  ${msg}`);
}
function ok(msg: string): void {
  console.log(`[OK]    ${msg}`);
}

// ── 核心逻辑 ──────────────────────────────────────────

interface SkillRow {
  id: string;
  name: string;
  description: string | null;
  scope: string;
  ownerId: string | null;
  version: string | null;
  scriptPath: string | null;
  command: string | null;
}

/**
 * 对一个 DB skill 生成可能的旧目录名候选列表
 * 按优先级从高到低排列，匹配到第一个即停止
 */
function legacyCandidates(skill: SkillRow): string[] {
  const candidates: string[] = [];

  // 1. name（如 team-research）
  if (skill.name) candidates.push(skill.name);

  // 2. id（如 skill-1773064953337-lqicu5）
  candidates.push(skill.id);

  // 3. 个人 skill 旧路径格式 users/{ownerId}/skills/{name}
  //    不在 data/skills/ 下，跳过

  // 去重
  return [...new Set(candidates)];
}

/**
 * 在 data/skills/ 中查找旧目录（按候选列表依次匹配）
 */
function findExistingDir(candidates: string[]): string | null {
  for (const name of candidates) {
    const fullPath = path.join(SKILLS_DIR, name);
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      return name;
    }
  }
  return null;
}

/**
 * 读取并更新 SKILL.md frontmatter
 */
function updateSkillMd(dirPath: string, skill: SkillRow): void {
  const mdPath = path.join(dirPath, 'SKILL.md');
  const params: SkillMdParams = {
    name: skill.name,
    description: skill.description ?? '',
    scope: skill.scope,
    ownerId: skill.ownerId,
    command: skill.command,
    scriptPath: skill.scriptPath,
    version: skill.version,
  };

  if (fs.existsSync(mdPath)) {
    const existing = fs.readFileSync(mdPath, 'utf-8');
    const updated = mergeSkillMd(existing, params);
    if (updated !== existing) {
      if (!DRY_RUN) {
        fs.writeFileSync(mdPath, updated, 'utf-8');
      }
      info(`  SKILL.md frontmatter 已更新`);
    } else {
      info(`  SKILL.md frontmatter 无需变更`);
    }
  } else {
    warn(`  SKILL.md 不存在，跳过 frontmatter 更新`);
  }
}

async function main(): Promise<void> {
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  Skill 目录迁移脚本');
  console.log(`  模式: ${DRY_RUN ? 'DRY-RUN（仅预览）' : '实际执行'}`);
  console.log(`  目录: ${SKILLS_DIR}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');

  // 1. 连接数据库，读取所有 skill
  const prisma = new PrismaClient();
  let skills: SkillRow[];
  try {
    skills = await prisma.skill.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        scope: true,
        ownerId: true,
        version: true,
        scriptPath: true,
        command: true,
      },
    });
  } finally {
    await prisma.$disconnect();
  }

  info(`数据库中共 ${skills.length} 个 skill\n`);

  // 统计
  let moved = 0;
  let alreadyOk = 0;
  let missing = 0;
  let mdUpdated = 0;

  // 2. 逐个处理
  for (const skill of skills) {
    const targetDirName = skillDirName(skill.scope, skill.id, skill.ownerId);
    const targetPath = path.join(SKILLS_DIR, targetDirName);

    console.log(`── ${skill.name} (id=${skill.id}, scope=${skill.scope}) ──`);
    info(`  目标目录: ${targetDirName}/`);

    // 已经在正确位置？
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
      ok(`  已在正确位置，无需移动`);
      updateSkillMd(targetPath, skill);
      alreadyOk++;
      console.log('');
      continue;
    }

    // 查找旧目录
    const candidates = legacyCandidates(skill);
    info(`  候选旧目录: [${candidates.join(', ')}]`);

    const foundDirName = findExistingDir(candidates);

    if (!foundDirName) {
      warn(`  ⚠ 未找到任何旧目录，跳过`);
      missing++;
      console.log('');
      continue;
    }

    const sourcePath = path.join(SKILLS_DIR, foundDirName);
    info(`  找到旧目录: ${foundDirName}/`);
    info(`  计划: ${foundDirName}/ → ${targetDirName}/`);

    if (!DRY_RUN) {
      fs.renameSync(sourcePath, targetPath);
      ok(`  已移动`);
      updateSkillMd(targetPath, skill);
    } else {
      info(`  [DRY-RUN] 将移动 ${foundDirName}/ → ${targetDirName}/`);
      // dry-run 模式下也检查 SKILL.md 状态
      const mdPath = path.join(sourcePath, 'SKILL.md');
      if (fs.existsSync(mdPath)) {
        info(`  [DRY-RUN] 将更新 SKILL.md frontmatter`);
        mdUpdated++;
      }
    }
    moved++;
    console.log('');
  }

  // 3. 检查 data/skills/ 中未被 DB 引用的目录（如 lesson/）
  console.log('── 检查未关联的目录 ──');
  const allEntries = fs.readdirSync(SKILLS_DIR);
  const dbDirNames = new Set(
    skills.map(s => skillDirName(s.scope, s.id, s.ownerId))
  );
  // 在 dry-run 模式下旧目录名也算"已处理"
  const processedOldNames = new Set(
    skills.flatMap(s => legacyCandidates(s))
  );

  for (const entry of allEntries) {
    if (SKIP_ENTRIES.has(entry)) continue;

    const fullPath = path.join(SKILLS_DIR, entry);
    // 跳过非目录（zip 文件等）
    if (!fs.statSync(fullPath).isDirectory()) continue;

    if (dbDirNames.has(entry) || processedOldNames.has(entry)) continue;

    info(`  未关联目录（不在 DB 中）: ${entry}/ — 保持不动`);
  }

  // 4. 汇总
  console.log('');
  console.log('═══════════════════════════════════════════════════');
  console.log('  汇总');
  console.log(`  已移动/待移动: ${moved}`);
  console.log(`  已在正确位置: ${alreadyOk}`);
  console.log(`  目录缺失:     ${missing}`);
  console.log(`  总计:         ${skills.length}`);
  console.log('═══════════════════════════════════════════════════');
  console.log('');
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
