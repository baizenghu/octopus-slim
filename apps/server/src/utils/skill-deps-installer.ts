import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { createLogger } from './logger';

const logger = createLogger('skill-deps');

/**
 * 验证 Skill 目录下的 requirements.txt 格式。
 * 依赖安装在 Docker sandbox 内完成，不在主进程执行 pip install。
 * @param skillDir Skill 根目录
 */
export async function installSkillDeps(
  skillDir: string,
): Promise<{ installed: boolean; message: string }> {
  const reqFile = path.join(skillDir, 'requirements.txt');
  if (!existsSync(reqFile)) {
    return { installed: false, message: 'No requirements.txt found' };
  }

  try {
    const content = await readFile(reqFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));

    // 基本格式验证（不执行安装）
    const invalidLines = lines.filter(l => /[;&|`$]/.test(l));
    if (invalidLines.length > 0) {
      logger.warn(`Suspicious requirements.txt in ${skillDir}`, { invalidLines });
      return { installed: false, message: `Suspicious entries found: ${invalidLines.join(', ')}` };
    }

    logger.info(`Skill deps validated: ${skillDir} (${lines.length} packages, will install in sandbox)`);
    return { installed: true, message: `${lines.length} dependencies detected, will be installed in sandbox at runtime` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { installed: false, message: `Validation failed: ${msg}` };
  }
}
