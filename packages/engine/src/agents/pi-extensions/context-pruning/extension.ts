import type { ContextEvent, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { tokenCountWithEstimation } from "../../token-estimation.js";
import { createSubsystemLogger } from "../../../logging/subsystem.js";
import { pruneContextMessages } from "./pruner.js";
import { getContextPruningRuntime } from "./runtime.js";

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
