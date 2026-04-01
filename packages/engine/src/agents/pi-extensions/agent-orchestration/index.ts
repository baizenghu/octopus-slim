/**
 * Agent Orchestration — Coordinator/Worker 多 Agent 并行执行框架
 *
 * 模块结构：
 * - coordinator.ts  — Coordinator 角色定义与 system prompt 构建
 * - worker.ts       — Worker 角色定义与预设配置
 * - message-bus.ts  — 子任务结果解析与聚合报告工具（薄封装层）
 *
 * 快速使用：
 * ```typescript
 * import {
 *   buildCoordinatorSystemPrompt,
 *   buildWorkerSystemPrompt,
 *   REVIEW_WORKER_PRESETS,
 * } from "./agent-orchestration/index.js";
 * ```
 */

export {
  COORDINATOR_ALLOWED_TOOLS,
  buildCoordinatorSystemPrompt,
  validateCoordinatorConfig,
} from "./coordinator.js";

export type {
  CoordinatorAllowedTool,
  CoordinatorConfig,
  CoordinatorConfigValidation,
  WorkerAgentRef,
} from "./coordinator.js";

export {
  WORKER_ALLOWED_TOOLS_DEFAULT,
  REVIEW_WORKER_PRESETS,
  buildWorkerSystemPrompt,
} from "./worker.js";

export type { WorkerConfig, WorkerDefaultAllowedTool, WorkerRole } from "./worker.js";

export {
  buildAggregatedReport,
  buildWaitForWorkersInstruction,
  extractSubtaskResult,
} from "./message-bus.js";

export type { AggregatedReportOptions, SubtaskResult } from "./message-bus.js";
