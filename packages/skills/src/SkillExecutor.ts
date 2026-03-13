/**
 * SkillExecutor — Skill 隔离执行器
 *
 * 支持两种隔离模式：
 * - process: 子进程执行，通过 cwd 限定到用户工作空间
 * - docker: Docker 容器执行，挂载用户工作空间目录
 *
 * 核心原则：
 * - Skill 代码目录只读引用
 * - 执行的 cwd 为用户 workspace（输出自然落到用户目录）
 * - 资源限制（超时、内存、CPU）
 */

import { spawn, type ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import type {
  SkillExecutionRequest,
  SkillExecutionResult,
  SkillInfo,
  ResourceLimits,
  SkillsConfig,
} from './types';

/** 当前正在执行的任务数 */
let activeExecutions = 0;

export class SkillExecutor {
  private config: SkillsConfig;

  constructor(config: SkillsConfig) {
    this.config = config;
  }

  /**
   * 执行 Skill 脚本
   *
   * @param skill - Skill 信息（用于获取代码路径）
   * @param request - 执行请求
   * @param userWorkspacePath - 用户工作空间路径（执行 cwd）
   * @param userEnv - 用户个人 .env 中的环境变量（已过滤安全敏感项）
   */
  async execute(
    skill: SkillInfo,
    request: SkillExecutionRequest,
    userWorkspacePath: string,
    userEnv?: Record<string, string>,
  ): Promise<SkillExecutionResult> {
    // 并发控制
    if (activeExecutions >= this.config.maxConcurrentExecutions) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: `并发执行数已达上限 (${this.config.maxConcurrentExecutions})，请稍后重试`,
        duration: 0,
        outputFiles: [],
      };
    }

    const mode = request.isolationMode || this.config.defaultIsolationMode;
    const limits = this.config.defaultResourceLimits;

    activeExecutions++;
    try {
      if (mode === 'docker') {
        return await this.executeInDocker(skill, request, userWorkspacePath, limits, userEnv);
      } else {
        return await this.executeInProcess(skill, request, userWorkspacePath, limits, userEnv);
      }
    } finally {
      activeExecutions--;
    }
  }

  /**
   * 子进程隔离执行
   *
   * Skill 代码路径作为脚本参数，cwd 设为用户 workspace。
   * 企业 Skill: 代码在 globalSkillsDir（只读），输出在用户 workspace
   * 个人 Skill: 代码在用户 workspace/skills/（用户目录），输出在用户 workspace
   */
  private async executeInProcess(
    skill: SkillInfo,
    request: SkillExecutionRequest,
    userWorkspacePath: string,
    limits: ResourceLimits,
    userEnv?: Record<string, string>,
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    const timeout = request.timeout || limits.timeout;

    // 确定脚本的绝对路径
    const scriptAbsPath = path.resolve(skill.skillPath, request.scriptPath);
    // 安全校验：确保脚本路径在 skill 目录内
    const skillRoot = path.resolve(skill.skillPath);
    if (!scriptAbsPath.startsWith(skillRoot + path.sep) && scriptAbsPath !== skillRoot) {
      return {
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: `安全拦截：脚本路径 "${request.scriptPath}" 超出 skill 目录范围`,
        duration: Date.now() - startTime,
        outputFiles: [],
      };
    }
    if (!fs.existsSync(scriptAbsPath)) {
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: `脚本不存在: ${request.scriptPath}`,
        duration: Date.now() - startTime,
        outputFiles: [],
      };
    }

    // 确保 outputs 目录存在
    const outputsDir = path.join(userWorkspacePath, 'outputs');
    if (!fs.existsSync(outputsDir)) {
      await fsp.mkdir(outputsDir, { recursive: true });
    }

    // 确定解释器
    const interpreter = this.getInterpreter(scriptAbsPath);

    // 构建命令
    const cmdArgs = interpreter
      ? [scriptAbsPath, ...request.args]
      : request.args;
    const cmd = interpreter || scriptAbsPath;

    return new Promise<SkillExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const child: ChildProcess = spawn(cmd, cmdArgs, {
        cwd: userWorkspacePath,
        env: {
          // 用户个人 .env 变量（优先级最低，被下方系统变量覆盖）
          ...userEnv,
          // 最小化环境变量，不继承宿主
          PATH: process.env.PATH || '/usr/bin:/usr/local/bin',
          HOME: userWorkspacePath,
          PYTHONIOENCODING: 'utf-8',
          LANG: 'en_US.UTF-8',
          // Skill 可访问的工作空间路径
          WORKSPACE_PATH: userWorkspacePath,
          OUTPUTS_PATH: outputsDir,
          // Skill 自身的代码目录（只读引用，脚本可用于定位资源文件）
          SKILL_DIR: skill.skillPath,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        // 设置 uid/gid 需要 root 权限，生产环境可启用
        // uid: ...,
        // gid: ...,
      });

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // 限制输出大小（防止 OOM）
        if (stdout.length > 1024 * 1024) {
          child.kill('SIGKILL');
          killed = true;
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1024 * 1024) {
          child.kill('SIGKILL');
          killed = true;
        }
      });

      // 超时控制
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, timeout);

      child.on('close', async (code) => {
        clearTimeout(timer);
        const duration = Date.now() - startTime;

        // 收集输出文件
        const outputFiles = await this.collectOutputFiles(outputsDir);

        resolve({
          success: !killed && code === 0,
          exitCode: code ?? -1,
          stdout: stdout.substring(0, 100_000), // 截断
          stderr: killed
            ? `执行超时或输出过大，已强制终止\n${stderr.substring(0, 10_000)}`
            : stderr.substring(0, 100_000),
          duration,
          outputFiles,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: -1,
          stdout,
          stderr: `进程启动失败: ${err.message}`,
          duration: Date.now() - startTime,
          outputFiles: [],
        });
      });
    });
  }

  /**
   * Docker 容器隔离执行
   */
  private async executeInDocker(
    skill: SkillInfo,
    request: SkillExecutionRequest,
    userWorkspacePath: string,
    limits: ResourceLimits,
    userEnv?: Record<string, string>,
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    const timeout = request.timeout || limits.timeout;
    const image = this.config.dockerImage || 'octopus-skill-sandbox:latest';

    // 确保 outputs 目录存在（Docker 挂载不会自动创建子目录）
    const outputsDir = path.join(userWorkspacePath, 'outputs');
    if (!fs.existsSync(outputsDir)) {
      await fsp.mkdir(outputsDir, { recursive: true });
    }

    // 构建 docker run 命令
    const dockerArgs = [
      'run', '--rm',
      // 资源限制
      `--memory=${limits.memoryLimit}`,
      `--cpus=${limits.cpus}`,
      // 网络限制
      ...(limits.networkDisabled ? ['--network=none'] : []),
      // 只读挂载 Skill 代码
      '-v', `${skill.skillPath}:/skill:ro`,
      // 读写挂载用户工作空间
      '-v', `${userWorkspacePath}:/workspace`,
      // 工作目录
      '-w', '/workspace',
      // 用户个人 .env 变量
      ...(userEnv ? Object.entries(userEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]) : []),
      // 系统环境变量（覆盖用户同名变量）
      '-e', 'WORKSPACE_PATH=/workspace',
      '-e', 'OUTPUTS_PATH=/workspace/outputs',
      '-e', 'SKILL_DIR=/skill',
      // 镜像
      image,
      // 命令
      ...this.buildDockerCommand(request.scriptPath, request.args),
    ];

    return new Promise<SkillExecutionResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;

      const child = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGKILL');
      }, timeout + 5000); // Docker 有额外开销

      child.on('close', async (code) => {
        clearTimeout(timer);
        const dockerOutputsDir = path.join(userWorkspacePath, 'outputs');
        const outputFiles = await this.collectOutputFiles(dockerOutputsDir);

        resolve({
          success: !killed && code === 0,
          exitCode: code ?? -1,
          stdout: stdout.substring(0, 100_000),
          stderr: killed ? `容器执行超时\n${stderr.substring(0, 10_000)}` : stderr.substring(0, 100_000),
          duration: Date.now() - startTime,
          outputFiles,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: `Docker 启动失败: ${err.message}`,
          duration: Date.now() - startTime,
          outputFiles: [],
        });
      });
    });
  }

  /**
   * 根据文件扩展名确定解释器
   * 优先使用配置中的解释器路径，未配置则使用默认值
   */
  private getInterpreter(scriptPath: string): string | null {
    const ext = path.extname(scriptPath).toLowerCase();
    const interpreters = this.config.interpreters;
    switch (ext) {
      case '.py': return interpreters?.python || 'python3';
      case '.js': return interpreters?.node || 'node';
      case '.sh': return interpreters?.bash || 'bash';
      case '.ts': return 'npx';
      default: return null;
    }
  }

  /**
   * 构建 Docker 内执行的命令
   */
  private buildDockerCommand(scriptPath: string, args: string[]): string[] {
    // 安全校验：防止路径穿越逃逸出 /skill/ 挂载目录
    const normalized = path.normalize(scriptPath);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      throw new Error(`安全拦截：脚本路径 "${scriptPath}" 不合法`);
    }
    const ext = path.extname(scriptPath).toLowerCase();
    const containerScriptPath = `/skill/${normalized}`;

    switch (ext) {
      case '.py': return ['python3', containerScriptPath, ...args];
      case '.js': return ['node', containerScriptPath, ...args];
      case '.sh': return ['bash', containerScriptPath, ...args];
      default: return [containerScriptPath, ...args];
    }
  }

  /**
   * 收集输出文件列表
   */
  private async collectOutputFiles(outputsDir: string): Promise<string[]> {
    if (!fs.existsSync(outputsDir)) return [];

    const files: string[] = [];
    const walk = async (dir: string) => {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          files.push(path.relative(outputsDir, fullPath));
        }
      }
    };

    await walk(outputsDir);
    return files;
  }

  /** 获取当前活跃执行数 */
  getActiveExecutions(): number {
    return activeExecutions;
  }
}
