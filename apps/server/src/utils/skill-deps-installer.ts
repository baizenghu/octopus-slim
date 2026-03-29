import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import path from 'path';
import { createLogger } from './logger';

const execFileAsync = promisify(execFile);
const logger = createLogger('skill-deps');

/**
 * 检测 Skill 目录下是否有 requirements.txt，如果有则安装到 .venv
 * @param skillDir Skill 根目录（如 data/skills/ent_skill-xxx/）
 * @returns 安装结果信息
 */
export async function installSkillDeps(
  skillDir: string,
): Promise<{ installed: boolean; message: string }> {
  const reqFile = path.join(skillDir, 'requirements.txt');
  if (!existsSync(reqFile)) {
    return { installed: false, message: 'No requirements.txt found' };
  }

  const venvDir = path.join(skillDir, '.venv');
  const pipPath = path.join(venvDir, 'bin', 'pip');

  try {
    // 创建 venv（如果不存在）
    if (!existsSync(venvDir)) {
      await execFileAsync('python3', ['-m', 'venv', venvDir], {
        timeout: 30_000,
      });
    }

    // 安装依赖（使用清华镜像加速）
    const { stdout } = await execFileAsync(
      pipPath,
      ['install', '-r', reqFile, '-i', 'https://pypi.tuna.tsinghua.edu.cn/simple'],
      { timeout: 120_000, cwd: skillDir },
    );

    logger.info(`Skill deps installed: ${skillDir}`, { stdout: stdout.slice(0, 200) });
    return { installed: true, message: 'Dependencies installed successfully' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Skill deps install failed: ${skillDir}`, { error: msg });
    return { installed: false, message: `Install failed: ${msg}` };
  }
}
