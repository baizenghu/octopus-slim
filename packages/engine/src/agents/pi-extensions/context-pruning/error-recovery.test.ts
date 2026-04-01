import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it } from "vitest";
import { createErrorRecoveryChain } from "./error-recovery.js";
import type { RecoveryContext, RecoveryError } from "./error-recovery.js";

type AssistantMessage = Extract<AgentMessage, { role: "assistant" }>;

function makeUser(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: Date.now() };
}

function makeAssistant(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

function makeToolResult(toolName: string, text: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: `tc_${Math.random().toString(36).slice(2)}`,
    toolName,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: Date.now(),
  };
}

function makeLargeMessages(count: number, charsEach: number): AgentMessage[] {
  const msgs: AgentMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push(makeUser("u" + i));
    msgs.push(makeAssistant("a" + i));
    msgs.push(makeToolResult("exec", "x".repeat(charsEach)));
  }
  return msgs;
}

const contextWindowError: RecoveryError = { type: "context_window_exceeded", message: "Context too long" };
const outputTruncatedError: RecoveryError = { type: "output_truncated", message: "Output truncated" };
const unknownError: RecoveryError = { type: "unknown", message: "Something went wrong" };

describe("createErrorRecoveryChain", () => {
  it("has 5 levels", () => {
    const chain = createErrorRecoveryChain({ contextWindowTokens: 100_000 });
    expect(chain.levels).toHaveLength(5);
  });

  describe("Level 1: context pruning", () => {
    it("prunes large tool results on context_window_exceeded", () => {
      const chain = createErrorRecoveryChain({ contextWindowTokens: 1_000 });
      const messages = makeLargeMessages(5, 10_000);

      const result = chain.tryRecover({
        messages,
        error: contextWindowError,
        maxOutputTokens: 8192,
        model: "test-model",
        continuationAttempts: 0,
      });

      expect(result.recovered).toBe(true);
      expect(result.level).toBe(1);
      expect(result.messages).toBeDefined();
      expect(result.messages!.length).toBe(messages.length);
    });
  });

  describe("Level 2: compressed summary", () => {
    it("replaces old messages with summary when pruning is insufficient", () => {
      const chain = createErrorRecoveryChain({ contextWindowTokens: 100 });
      // Only 3 messages — Level 1 may not help, Level 2 kicks in
      const messages = [
        makeUser("First question about architecture"),
        makeAssistant("Here is a long answer about architecture..."),
        makeUser("Follow-up question"),
      ];

      const ctx: RecoveryContext = {
        messages,
        error: contextWindowError,
        maxOutputTokens: 8192,
        model: "test-model",
        continuationAttempts: 0,
      };

      // Level 1 won't help (no tool results to prune), so Level 2 should fire
      const result = chain.tryRecover(ctx);
      expect(result.recovered).toBe(true);
      expect(result.level).toBe(2);
      expect(result.messages).toBeDefined();
      expect(result.messages!.length).toBeLessThanOrEqual(messages.length);
      // Summary message should contain conversation summary marker
      const firstMsg = result.messages![0]!;
      expect(firstMsg.role).toBe("user");
      const content = firstMsg.role === "user" && typeof firstMsg.content === "string" ? firstMsg.content : "";
      expect(content).toContain("summary");
    });
  });

  describe("Level 3: max_output_tokens upgrade", () => {
    it("upgrades tokens on output_truncated", () => {
      const chain = createErrorRecoveryChain({ contextWindowTokens: 100_000 });

      const result = chain.tryRecover({
        messages: [makeUser("hi"), makeAssistant("hello")],
        error: outputTruncatedError,
        maxOutputTokens: 8192,
        model: "test-model",
        continuationAttempts: 0,
      });

      expect(result.recovered).toBe(true);
      expect(result.level).toBe(3);
      expect(result.maxOutputTokens).toBe(32768); // 8192 * 4
    });

    it("caps at ceiling", () => {
      const chain = createErrorRecoveryChain({
        contextWindowTokens: 100_000,
        maxOutputTokensCeiling: 16_384,
      });

      const result = chain.tryRecover({
        messages: [makeUser("hi")],
        error: outputTruncatedError,
        maxOutputTokens: 8192,
        model: "test-model",
        continuationAttempts: 0,
      });

      expect(result.recovered).toBe(true);
      expect(result.maxOutputTokens).toBe(16_384);
    });

    it("does not upgrade when already at ceiling", () => {
      const chain = createErrorRecoveryChain({
        contextWindowTokens: 100_000,
        maxOutputTokensCeiling: 65_536,
      });

      const result = chain.tryRecover({
        messages: [makeUser("hi")],
        error: outputTruncatedError,
        maxOutputTokens: 65_536,
        model: "test-model",
        continuationAttempts: 0,
      });

      // Level 3 skipped, falls through to Level 4
      expect(result.level).toBe(4);
    });
  });

  describe("Level 4: continuation retry", () => {
    it("returns continuation message", () => {
      const chain = createErrorRecoveryChain({ contextWindowTokens: 100_000 });

      const result = chain.tryRecover({
        messages: [makeUser("hi")],
        error: outputTruncatedError,
        maxOutputTokens: 65_536, // already at ceiling, skip Level 3
        model: "test-model",
        continuationAttempts: 0,
      });

      expect(result.recovered).toBe(true);
      expect(result.level).toBe(4);
      expect(result.continuationMessage).toContain("continue");
    });

    it("respects max continuation retries", () => {
      const chain = createErrorRecoveryChain({
        contextWindowTokens: 100_000,
        maxContinuationRetries: 2,
      });

      const result = chain.tryRecover({
        messages: [makeUser("hi")],
        error: outputTruncatedError,
        maxOutputTokens: 65_536,
        model: "test-model",
        continuationAttempts: 2, // already at max
      });

      // Level 4 skipped (at max retries), falls through to Level 5
      expect(result.level).not.toBe(4);
    });
  });

  describe("Level 5: fallback model", () => {
    it("switches to fallback model when configured", () => {
      const chain = createErrorRecoveryChain({
        contextWindowTokens: 100_000,
        fallbackModel: "deepseek-v3",
      });

      const result = chain.tryRecover({
        messages: [makeUser("hi")],
        error: outputTruncatedError,
        maxOutputTokens: 65_536,
        model: "test-model",
        continuationAttempts: 3, // past max retries
      });

      expect(result.recovered).toBe(true);
      expect(result.level).toBe(5);
      expect(result.fallbackModel).toBe("deepseek-v3");
    });

    it("is skipped when no fallback model configured", () => {
      const chain = createErrorRecoveryChain({
        contextWindowTokens: 100_000,
        // no fallbackModel
      });

      const result = chain.tryRecover({
        messages: [makeUser("hi")],
        error: outputTruncatedError,
        maxOutputTokens: 65_536,
        model: "test-model",
        continuationAttempts: 3,
      });

      expect(result.recovered).toBe(false);
      expect(result.level).toBe(0);
    });
  });

  describe("no recovery available", () => {
    it("returns recovered=false for unknown errors with no fallback", () => {
      const chain = createErrorRecoveryChain({ contextWindowTokens: 100_000 });

      const result = chain.tryRecover({
        messages: [makeUser("hi")],
        error: unknownError,
        maxOutputTokens: 65_536,
        model: "test-model",
        continuationAttempts: 0,
      });

      expect(result.recovered).toBe(false);
      expect(result.level).toBe(0);
    });
  });
});
