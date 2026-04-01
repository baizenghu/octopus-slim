/**
 * Message Bus — 薄封装层
 *
 * 说明：octopus 引擎已内建完整的 Parent-Child Agent 通信机制：
 *
 * - 父 Agent 通过 `sessions_spawn` 工具派发子任务（fire-and-forget）
 * - 子 Agent 完成后，`subagent-announce.ts` 自动推送结果给父 Agent（无需轮询）
 * - 结果以 `<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>...<<<END_UNTRUSTED_CHILD_RESULT>>>` 标签包裹，
 *   以 `AgentTaskCompletionInternalEvent` 格式注入父 Agent 的对话上下文
 *
 * 本模块提供：
 * 1. 类型定义（与引擎内部 AgentTaskCompletionInternalEvent 对齐）
 * 2. 辅助函数（解析/格式化 coordinator 收到的子任务结果）
 *
 * 注意：本模块不实现 pub/sub 逻辑，引擎已原生支持，无需重复实现。
 */

/** 子任务执行结果 */
export interface SubtaskResult {
  /** 执行该子任务的 Worker Agent ID */
  agentId: string;
  /** Worker 角色描述（用于汇总报告） */
  role: string;
  /** 任务执行状态 */
  status: "ok" | "error" | "timeout";
  /** Worker 返回的结果内容 */
  result: string;
  /** 执行耗时（毫秒），可选 */
  executionTimeMs?: number;
}

/** 聚合报告构建选项 */
export interface AggregatedReportOptions {
  /** 报告标题，不传则使用默认标题 */
  title?: string;
  /** 是否在摘要中包含执行统计信息，默认 true */
  includeStats?: boolean;
}

const BEGIN_TAG = "<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>";
const END_TAG = "<<<END_UNTRUSTED_CHILD_RESULT>>>";

const STATUS_LABEL: Record<SubtaskResult["status"], string> = {
  ok: "completed",
  error: "failed",
  timeout: "timed out",
};

/**
 * 从 coordinator 收到的原始消息中提取子任务结果。
 *
 * 解析引擎注入的 `<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>` 标签块，
 * 从前缀行中提取 agentId、role、status 等字段。
 *
 * 若原始消息不包含合法标签块，返回 null。
 *
 * @param rawMessage - coordinator 对话上下文中收到的原始消息字符串
 * @returns 解析出的 SubtaskResult，或 null（解析失败时）
 */
export function extractSubtaskResult(rawMessage: string): SubtaskResult | null {
  if (typeof rawMessage !== "string") {
    return null;
  }

  const beginIdx = rawMessage.indexOf(BEGIN_TAG);
  const endIdx = rawMessage.indexOf(END_TAG);

  if (beginIdx < 0 || endIdx < 0 || endIdx <= beginIdx) {
    return null;
  }

  const resultContent = rawMessage.slice(beginIdx + BEGIN_TAG.length, endIdx).trim();

  // Extract structured fields from the prefix block (lines before BEGIN tag)
  const prefix = rawMessage.slice(0, beginIdx);
  const agentId = extractPrefixField(prefix, "session_key") ?? extractPrefixField(prefix, "agent");
  const statusRaw = extractPrefixField(prefix, "status");
  const status = normalizeStatus(statusRaw);

  // Role is not always present in engine events; fall back to agentId
  const role = extractPrefixField(prefix, "role") ?? agentId ?? "unknown";

  if (!agentId) {
    // Cannot identify the source agent; not a valid subtask result
    return null;
  }

  return {
    agentId,
    role,
    status,
    result: resultContent,
  };
}

/**
 * 将多个子任务结果格式化为聚合报告字符串。
 *
 * 报告包含：
 * - 执行摘要（成功/失败/超时数量）
 * - 每个 Worker 的结果块（按 role 分组）
 *
 * @param results - SubtaskResult 数组
 * @param title - 报告标题（可选），默认为 "Multi-Agent Task Report"
 * @returns 格式化的 Markdown 报告字符串
 */
export function buildAggregatedReport(results: SubtaskResult[], title?: string): string {
  const reportTitle = title?.trim() ?? "Multi-Agent Task Report";

  if (results.length === 0) {
    return `# ${reportTitle}\n\nNo worker results received.`;
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const timeoutCount = results.filter((r) => r.status === "timeout").length;

  const summaryLines = [`# ${reportTitle}`, ""];
  summaryLines.push("## Summary");
  summaryLines.push(
    `- Workers: ${results.length} total | ${okCount} completed | ${errorCount} failed | ${timeoutCount} timed out`,
  );
  summaryLines.push("");

  const resultBlocks = results.map((r) => {
    const statusLabel = STATUS_LABEL[r.status] ?? r.status;
    const statsNote =
      typeof r.executionTimeMs === "number"
        ? ` (${(r.executionTimeMs / 1000).toFixed(1)}s)`
        : "";
    const heading = `## Worker: ${r.role} [${statusLabel}${statsNote}]`;
    const content =
      r.status === "ok"
        ? r.result || "(no output)"
        : `Worker ${r.status === "timeout" ? "timed out" : "failed"}.\n\n${r.result || "(no details)"}`;
    return [heading, "", content].join("\n");
  });

  return [...summaryLines, ...resultBlocks].join("\n\n");
}

/**
 * 生成 coordinator 等待多个 worker 完成的提示文本。
 *
 * 该文本可注入到 coordinator system prompt 的汇总部分，
 * 指导 coordinator 在收齐所有 worker 结果后再汇总。
 *
 * @param workerCount - 预期的 worker 数量
 * @returns 提示文本字符串
 */
export function buildWaitForWorkersInstruction(workerCount: number): string {
  const count = Math.max(1, Math.floor(workerCount));
  return [
    `You have dispatched ${count} worker agent${count > 1 ? "s" : ""}.`,
    `Wait until you have received ${count} task_completion event${count > 1 ? "s" : ""} ` +
      "(each containing a <<<BEGIN_UNTRUSTED_CHILD_RESULT>>> block) " +
      "before proceeding to aggregate results.",
    "",
    "If a worker result indicates an error or timeout, note it in your aggregated report " +
      "and continue with the results you have.",
    "",
    "Do NOT proceed to the aggregation step until all expected results have arrived.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * 从前缀文本中提取特定字段值。
 * 格式：`fieldName: value` 或 `fieldName: value` (行首)。
 */
function extractPrefixField(prefix: string, fieldName: string): string | null {
  const pattern = new RegExp(`^${escapeRegex(fieldName)}:\\s*(.+)$`, "im");
  const match = pattern.exec(prefix);
  if (!match || match[1] === undefined) {
    return null;
  }
  const value = match[1].trim();
  return value.length > 0 ? value : null;
}

/** 将原始 status 字符串归一化为 SubtaskResult["status"] */
function normalizeStatus(raw: string | null): SubtaskResult["status"] {
  if (!raw) {
    return "ok";
  }
  const lower = raw.toLowerCase().trim();
  if (lower === "ok" || lower === "success" || lower === "completed") {
    return "ok";
  }
  if (lower === "timeout" || lower === "timed_out" || lower === "timedout") {
    return "timeout";
  }
  return "error";
}

/** 转义正则表达式特殊字符 */
function escapeRegex(text: string): string {
  return text.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&");
}
