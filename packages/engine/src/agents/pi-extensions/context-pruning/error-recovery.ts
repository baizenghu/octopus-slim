/**
 * 5-level error recovery chain for context window management.
 *
 * Integrates with the existing context-pruning infrastructure to provide
 * graduated recovery when the LLM hits context/output limits or errors.
 *
 *   Level 1: Prune context (existing pruneContextMessages)
 *   Level 2: Generate compressed summary replacing old messages
 *   Level 3: Upgrade max_output_tokens (8K → 64K)
 *   Level 4: Add continuation message and retry (up to 3×)
 *   Level 5: Switch to fallback model
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent, ImageContent, ToolResultMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { pruneContextMessages } from "./pruner.js";
import type { EffectiveContextPruningSettings } from "./settings.js";
import { DEFAULT_CONTEXT_PRUNING_SETTINGS } from "./settings.js";

// ── Types ──────────────────────────────────────────────────────────────

export type ErrorType =
  | "context_window_exceeded"
  | "output_truncated"
  | "rate_limit"
  | "model_error"
  | "unknown";

export type RecoveryError = {
  type: ErrorType;
  message: string;
};

export type RecoveryContext = {
  messages: AgentMessage[];
  error: RecoveryError;
  /** Current max_output_tokens value. */
  maxOutputTokens: number;
  /** Current model identifier. */
  model: string;
  /** Number of continuation retries already attempted (for Level 4). */
  continuationAttempts: number;
};

export type RecoveryResult = {
  recovered: boolean;
  level: number;
  description: string;
  /** Updated messages (if recovery modified them). */
  messages?: AgentMessage[];
  /** Updated max_output_tokens (if Level 3 applied). */
  maxOutputTokens?: number;
  /** Continuation message to append (if Level 4 applied). */
  continuationMessage?: string;
  /** Fallback model to switch to (if Level 5 applied). */
  fallbackModel?: string;
};

export type ErrorRecoverySettings = {
  /** Context pruning settings for Level 1. */
  pruningSettings?: EffectiveContextPruningSettings;
  /** Context window token count. */
  contextWindowTokens: number;
  /** Max output tokens ceiling for Level 3 upgrade. Default 65536. */
  maxOutputTokensCeiling?: number;
  /** Max continuation retries for Level 4. Default 3. */
  maxContinuationRetries?: number;
  /** Fallback model identifier for Level 5. If not set, Level 5 is skipped. */
  fallbackModel?: string;
  /** Summary char budget for Level 2 compressed summary. Default 4000. */
  summaryBudgetChars?: number;
};

export type ErrorRecoveryChain = {
  /** Try to recover from the given error, returning the first successful recovery. */
  tryRecover: (context: RecoveryContext) => RecoveryResult;
  /** Read-only list of available recovery levels. */
  levels: readonly RecoveryLevel[];
};

type RecoveryLevel = {
  level: number;
  description: string;
  canAttempt: (context: RecoveryContext) => boolean;
  attempt: (context: RecoveryContext) => RecoveryResult | null;
};

// ── Helpers ────────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

function estimateChars(messages: AgentMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        total += msg.content.length;
      } else {
        for (const block of msg.content as ReadonlyArray<TextContent | ImageContent>) {
          total += block.type === "text" ? block.text.length : 8_000;
        }
      }
    } else if (msg.role === "assistant") {
      const aMsg = msg as AssistantMessage;
      for (const b of aMsg.content) {
        if (!b || typeof b !== "object") continue;
        if (b.type === "text") total += b.text.length;
        if (b.type === "thinking") total += b.thinking.length;
      }
    } else if (msg.role === "toolResult") {
      const tMsg = msg as ToolResultMessage;
      for (const block of tMsg.content) {
        total += block.type === "text" ? block.text.length : 8_000;
      }
    }
  }
  return total;
}

function buildCompressedSummary(messages: AgentMessage[], budgetChars: number): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const msg of messages) {
    if (totalChars >= budgetChars) break;

    let text = "";
    if (msg.role === "user") {
      const content = typeof msg.content === "string" ? msg.content : "[multipart content]";
      text = `[User]: ${content}`;
    } else if (msg.role === "assistant") {
      const aMsg = msg as AssistantMessage;
      const textBlock = aMsg.content.find((b) => b && b.type === "text");
      text = `[Assistant]: ${textBlock && textBlock.type === "text" ? textBlock.text.slice(0, 200) : "[response]"}`;
    } else if (msg.role === "toolResult") {
      text = `[Tool:${(msg as ToolResultMessage).toolName ?? "unknown"}]: [result]`;
    }

    if (text.length > 0) {
      const remaining = budgetChars - totalChars;
      const truncated = text.length > remaining ? text.slice(0, remaining) + "..." : text;
      parts.push(truncated);
      totalChars += truncated.length;
    }
  }

  return parts.join("\n");
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Create a 5-level error recovery chain.
 */
export function createErrorRecoveryChain(settings: ErrorRecoverySettings): ErrorRecoveryChain {
  const pruningSettings = settings.pruningSettings ?? DEFAULT_CONTEXT_PRUNING_SETTINGS;
  const maxOutputTokensCeiling = settings.maxOutputTokensCeiling ?? 65_536;
  const maxContinuationRetries = settings.maxContinuationRetries ?? 3;
  const summaryBudgetChars = settings.summaryBudgetChars ?? 4_000;

  const fakeCtx: Pick<ExtensionContext, "model"> = {
    model: { contextWindow: settings.contextWindowTokens } as ExtensionContext["model"],
  };

  const levels: RecoveryLevel[] = [
    // ── Level 1: Context pruning ──
    {
      level: 1,
      description: "Prune context via soft-trim and hard-clear",
      canAttempt: (ctx) =>
        ctx.error.type === "context_window_exceeded" || ctx.error.type === "output_truncated",
      attempt: (ctx) => {
        const pruned = pruneContextMessages({
          messages: ctx.messages,
          settings: { ...pruningSettings, softTrimRatio: 0, hardClearRatio: 0, minPrunableToolChars: 0 },
          ctx: fakeCtx,
        });

        if (pruned === ctx.messages) return null;

        const beforeChars = estimateChars(ctx.messages);
        const afterChars = estimateChars(pruned);
        if (afterChars >= beforeChars * 0.95) return null;

        return {
          recovered: true,
          level: 1,
          description: "Pruned context messages",
          messages: pruned,
        };
      },
    },

    // ── Level 2: Compressed summary ──
    {
      level: 2,
      description: "Replace old messages with compressed summary",
      canAttempt: (ctx) => ctx.error.type === "context_window_exceeded",
      attempt: (ctx) => {
        const msgs = ctx.messages;
        if (msgs.length <= 2) return null;

        // Keep the last 2 messages, summarize the rest
        const keepCount = Math.min(2, msgs.length);
        const toSummarize = msgs.slice(0, msgs.length - keepCount);
        const toKeep = msgs.slice(msgs.length - keepCount);

        if (toSummarize.length === 0) return null;

        const summary = buildCompressedSummary(toSummarize, summaryBudgetChars);
        const summaryMessage: AgentMessage = {
          role: "user",
          content: `[Conversation summary due to context limit]\n${summary}`,
          timestamp: Date.now(),
        };

        return {
          recovered: true,
          level: 2,
          description: "Replaced old messages with compressed summary",
          messages: [summaryMessage, ...toKeep],
        };
      },
    },

    // ── Level 3: Upgrade max_output_tokens ──
    {
      level: 3,
      description: "Upgrade max_output_tokens (8K → 64K)",
      canAttempt: (ctx) =>
        ctx.error.type === "output_truncated" && ctx.maxOutputTokens < maxOutputTokensCeiling,
      attempt: (ctx) => {
        const newLimit = Math.min(ctx.maxOutputTokens * 4, maxOutputTokensCeiling);
        if (newLimit <= ctx.maxOutputTokens) return null;

        return {
          recovered: true,
          level: 3,
          description: `Upgraded max_output_tokens from ${ctx.maxOutputTokens} to ${newLimit}`,
          maxOutputTokens: newLimit,
        };
      },
    },

    // ── Level 4: Continuation message retry ──
    {
      level: 4,
      description: "Add continuation message and retry (up to 3×)",
      canAttempt: (ctx) =>
        ctx.error.type === "output_truncated" &&
        ctx.continuationAttempts < maxContinuationRetries,
      attempt: (ctx) => {
        return {
          recovered: true,
          level: 4,
          description: `Continuation retry ${ctx.continuationAttempts + 1}/${maxContinuationRetries}`,
          continuationMessage: "Please continue from where you left off.",
        };
      },
    },

    // ── Level 5: Fallback model ──
    {
      level: 5,
      description: "Switch to fallback model",
      canAttempt: () => !!settings.fallbackModel,
      attempt: () => {
        if (!settings.fallbackModel) return null;

        return {
          recovered: true,
          level: 5,
          description: `Switching to fallback model: ${settings.fallbackModel}`,
          fallbackModel: settings.fallbackModel,
        };
      },
    },
  ];

  return {
    levels,
    tryRecover(context: RecoveryContext): RecoveryResult {
      for (const level of levels) {
        if (!level.canAttempt(context)) continue;
        const result = level.attempt(context);
        if (result) return result;
      }

      return {
        recovered: false,
        level: 0,
        description: "No recovery strategy available",
      };
    },
  };
}
