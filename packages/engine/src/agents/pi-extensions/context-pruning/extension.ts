import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { tokenCountWithEstimation } from "../../token-estimation.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { pruneContextMessages } from "./pruner.js";
import { getContextPruningRuntime } from "./runtime.js";
import { createErrorRecoveryChain, type RecoveryContext, type ErrorType } from "./error-recovery.js";
import { getCommandSemantic } from "./command-semantics.js";

const log = createSubsystemLogger("context-pruning");

export default function contextPruningExtension(api: ExtensionAPI): void {
  api.on("context", (event: ContextEvent, ctx: ExtensionContext) => {
    const runtime = getContextPruningRuntime(ctx.sessionManager);
    if (!runtime) {
      return undefined;
    }

    if (runtime.settings.mode === "cache-ttl") {
      const ttlMs = runtime.settings.ttlMs;
      const lastTouch = runtime.lastCacheTouchAt ?? null;
      if (!lastTouch || ttlMs <= 0) {
        return undefined;
      }
      if (ttlMs > 0 && Date.now() - lastTouch < ttlMs) {
        return undefined;
      }
    }

    const next = pruneContextMessages({
      messages: event.messages,
      settings: runtime.settings,
      ctx,
      isToolPrunable: runtime.isToolPrunable,
      contextWindowTokensOverride: runtime.contextWindowTokens ?? undefined,
    });

    if (next === event.messages) {
      return undefined;
    }

    // Log token-level context usage when pruning occurs (uses API usage anchor for precision)
    const contextWindowTokens = runtime.contextWindowTokens ?? ctx.model?.contextWindow;
    if (contextWindowTokens && contextWindowTokens > 0) {
      const beforeTokens = tokenCountWithEstimation(event.messages);
      const afterTokens = tokenCountWithEstimation(next);
      log.info(
        `context-pruning (${runtime.settings.mode}): ` +
        `${beforeTokens} → ${afterTokens} tokens ` +
        `(${Math.round((beforeTokens / contextWindowTokens) * 100)}% → ${Math.round((afterTokens / contextWindowTokens) * 100)}% of ${contextWindowTokens} window)`,
      );
    }

    if (runtime.settings.mode === "cache-ttl") {
      runtime.lastCacheTouchAt = Date.now();
    }

    return { messages: next };
  });

}

// ── Error Recovery API ─────────────────────────────────────────────────
// Exported for use by the agent runner when catching API errors.
// The ExtensionAPI "on" only supports known event types (context/input),
// so error recovery is invoked directly rather than via event hook.

export function tryErrorRecovery(
  runtime: ReturnType<typeof getContextPruningRuntime>,
  ctx: ExtensionContext,
  error: Error,
  messages: any[],
  maxOutputTokens = 8_192,
  model = "unknown",
): ReturnType<typeof createErrorRecoveryChain>["tryRecover"] extends (ctx: any) => infer R ? R : never {
  if (!runtime) {
    return { recovered: false, level: 0, description: "No runtime available" };
  }

  const errorType = classifyError(error);
  if (!errorType) {
    return { recovered: false, level: 0, description: "Unclassified error" };
  }

  const chain = createErrorRecoveryChain({
    pruningSettings: runtime.settings,
    contextWindowTokens: runtime.contextWindowTokens ?? ctx.model?.contextWindow ?? 128_000,
    fallbackModel: runtime.fallbackModel ?? undefined,
  });

  const recoveryCtx: RecoveryContext = {
    messages,
    error: { type: errorType, message: error.message },
    maxOutputTokens,
    model,
    continuationAttempts: 0,
  };

  const result = chain.tryRecover(recoveryCtx);
  if (result.recovered) {
    log.info(`error-recovery L${result.level}: ${result.description}`);
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

function classifyError(error: Error): ErrorType | null {
  const msg = error.message.toLowerCase();
  if (msg.includes("prompt_too_long") || msg.includes("context") || msg.includes("token limit")) {
    return "context_window_exceeded";
  }
  if (msg.includes("max_tokens") || msg.includes("output truncated") || msg.includes("max_output")) {
    return "output_truncated";
  }
  if (msg.includes("rate_limit") || msg.includes("429")) {
    return "rate_limit";
  }
  if (msg.includes("500") || msg.includes("internal") || msg.includes("model_error")) {
    return "model_error";
  }
  return null;
}
