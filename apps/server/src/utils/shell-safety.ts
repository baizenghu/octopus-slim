export type ShellInjectionResult = {
  safe: boolean;
  reason?: string;
};

/**
 * 动态导入引擎安全模块，检测 shell 注入风险
 * 返回 { safe: true } 或 { safe: false, reason: string }
 */
export async function checkShellInjection(command: string): Promise<ShellInjectionResult> {
  // Non-literal path prevents TypeScript from statically resolving across rootDir boundary
  const safetyModulePath: string = '../../../../packages/engine/src/agents/pi-extensions/safety/shell-injection-detect.js';
  const mod = await import(safetyModulePath) as { detectShellInjection: (cmd: string) => ShellInjectionResult };
  return mod.detectShellInjection(command);
}
