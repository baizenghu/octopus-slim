/**
 * Octopus Enterprise - Skills 安全管理模块
 *
 * 提供 Skill 的完整生命周期管理：发现、扫描、审批、执行、监控。
 * 支持企业级（全员共享）和个人级（用户隔离）两种作用域。
 *
 * @example
 * ```typescript
 * import { SkillManager } from '@octopus/skills';
 *
 * const manager = new SkillManager(workspaceManager, {
 *   globalSkillsDir: '/opt/octopus-data/system/global-skills',
 *   defaultIsolationMode: 'process',
 * });
 *
 * // 发现 Skills
 * await manager.discoverEnterpriseSkills();
 * await manager.discoverPersonalSkills(userId);
 *
 * // 列出可用 Skills
 * const skills = await manager.listAvailableSkills(userId);
 *
 * // 执行 Skill
 * const result = await manager.executeSkill({
 *   skillId: 'echarts-visualization',
 *   userId: 'user-lisi',
 *   scriptPath: 'scripts/echarts_generator.py',
 *   args: ['--data', 'sales.xlsx', '--output', 'outputs/dashboard.html'],
 * });
 * ```
 */

// 类型导出
export type {
  SkillScope,
  SkillStatus,
  SkillMetadata,
  SkillInfo,
  ScanSeverity,
  ScanFinding,
  ScanReport,
  IsolationMode,
  SkillExecutionRequest,
  SkillExecutionResult,
  ResourceMetrics,
  ResourceLimits,
  SkillsConfig,
  InterpreterPaths,
} from './types';

// 常量导出
export {
  DEFAULT_RESOURCE_LIMITS,
  DEFAULT_SKILLS_CONFIG,
} from './types';

// 核心组件导出
export { SkillScanner } from './SkillScanner';
export { SkillExecutor } from './SkillExecutor';
export { SkillMonitor } from './SkillMonitor';
export type { MonitorCallbacks } from './SkillMonitor';
export { SkillManager } from './SkillManager';
