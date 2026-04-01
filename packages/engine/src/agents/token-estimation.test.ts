import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  tokenCountWithEstimation,
  roughTokenCountForMessage,
  CHARS_PER_TOKEN_DEFAULT,
  CHARS_PER_TOKEN_CHINESE,
} from "./token-estimation.js";

function makeUser(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }], timestamp: Date.now() };
}

function makeAssistantWithUsage(
  text: string,
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): AgentMessage {
  const totalTokens =
    usage.input + usage.output + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    api: "messages",
    provider: "anthropic",
    model: "test",
    timestamp: Date.now(),
    usage: {
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead ?? 0,
      cacheWrite: usage.cacheWrite ?? 0,
      totalTokens,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as AgentMessage;
}

function makeAssistantNoUsage(text: string): AgentMessage {
  // Simulate an assistant message that somehow has no usage (e.g. custom message type
  // or a stream partial that was persisted without usage).
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
    api: "messages",
    provider: "anthropic",
    model: "test",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  } as AgentMessage;
}

describe("tokenCountWithEstimation", () => {
  it("returns rough estimate when no assistant with nonzero usage exists", () => {
    const messages = [makeUser("hello world"), makeAssistantNoUsage("hi")];
    const result = tokenCountWithEstimation(messages);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(50);
  });

  it("anchors on the last assistant message with nonzero usage", () => {
    const messages = [
      makeUser("first question"),
      makeAssistantWithUsage("first answer", { input: 100, output: 50 }),
      makeUser("second question"),
    ];
    const result = tokenCountWithEstimation(messages);
    // anchor = 100 + 50 = 150, plus rough estimate of "second question" (~4 tokens)
    expect(result).toBeGreaterThanOrEqual(150);
    expect(result).toBeLessThan(170);
  });

  it("includes cache tokens in anchor calculation", () => {
    const messages = [
      makeUser("question"),
      makeAssistantWithUsage("answer", {
        input: 80,
        output: 20,
        cacheWrite: 30,
        cacheRead: 10,
      }),
    ];
    const result = tokenCountWithEstimation(messages);
    // anchor = 80 + 20 + 30 + 10 = 140, no messages after anchor
    expect(result).toBe(140);
  });

  it("uses the LAST assistant with nonzero usage, not the first", () => {
    const messages = [
      makeUser("q1"),
      makeAssistantWithUsage("a1", { input: 50, output: 10 }),
      makeUser("q2"),
      makeAssistantWithUsage("a2", { input: 200, output: 30 }),
      makeUser("q3"),
    ];
    const result = tokenCountWithEstimation(messages);
    // anchor = 200 + 30 = 230, plus rough estimate of "q3" (~1 token)
    expect(result).toBeGreaterThanOrEqual(230);
    expect(result).toBeLessThan(250);
  });

  it("skips assistant messages with zero usage (no real API call)", () => {
    const messages = [
      makeUser("q1"),
      makeAssistantWithUsage("a1", { input: 100, output: 20 }),
      makeUser("q2"),
      makeAssistantNoUsage("a2"), // zero usage — skipped as anchor
      makeUser("q3"),
    ];
    const result = tokenCountWithEstimation(messages);
    // anchor at a1: 100 + 20 = 120, then rough estimate of q2 + a2(no usage) + q3
    expect(result).toBeGreaterThanOrEqual(120);
  });
});

describe("roughTokenCountForMessage", () => {
  it("estimates a simple text message", () => {
    const msg = makeUser("hello");
    const tokens = roughTokenCountForMessage(msg);
    expect(tokens).toBeGreaterThanOrEqual(1);
    expect(tokens).toBeLessThanOrEqual(5);
  });

  it("detects Chinese content and uses smaller divisor", () => {
    const chineseText = "你好世界这是一段中文文本测试";
    const msg = makeUser(chineseText);
    const tokens = roughTokenCountForMessage(msg);
    // 14 Chinese chars / 2 = 7 tokens minimum
    expect(tokens).toBeGreaterThanOrEqual(5);
  });
});

describe("constants", () => {
  it("exports expected default values", () => {
    expect(CHARS_PER_TOKEN_DEFAULT).toBe(4);
    expect(CHARS_PER_TOKEN_CHINESE).toBe(2);
  });
});
