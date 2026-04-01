import { describe, expect, it } from "vitest";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
  createCompactBoundaryLine,
  getMessagesAfterCompactBoundary,
  findLastCompactBoundaryIndex,
  isCompactBoundaryMessage,
  COMPACT_BOUNDARY_TYPE,
} from "./compact-boundary.js";

function makeUser(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }] } as AgentMessage;
}

function makeAssistant(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    stopReason: "stop",
  } as AgentMessage;
}

function makeBoundaryMessage(id: string): AgentMessage {
  return {
    role: "system",
    content: [{ type: "text", text: "Conversation compacted" }],
    __octopus: { kind: COMPACT_BOUNDARY_TYPE, id },
  } as unknown as AgentMessage;
}

describe("createCompactBoundaryLine", () => {
  it("creates a valid JSONL line object", () => {
    const line = createCompactBoundaryLine({
      trigger: "auto",
      preTokens: 150000,
      messagesSummarized: 42,
    });
    expect(line.type).toBe(COMPACT_BOUNDARY_TYPE);
    expect(line.id).toBeTruthy();
    expect(line.timestamp).toBeTruthy();
    expect(line.metadata.trigger).toBe("auto");
    expect(line.metadata.preTokens).toBe(150000);
    expect(line.metadata.messagesSummarized).toBe(42);
  });
});

describe("isCompactBoundaryMessage", () => {
  it("returns true for a boundary message", () => {
    const msg = makeBoundaryMessage("test-id");
    expect(isCompactBoundaryMessage(msg)).toBe(true);
  });

  it("returns false for a regular message", () => {
    expect(isCompactBoundaryMessage(makeUser("hi"))).toBe(false);
    expect(isCompactBoundaryMessage(makeAssistant("hello"))).toBe(false);
  });
});

describe("findLastCompactBoundaryIndex", () => {
  it("returns -1 when no boundary exists", () => {
    const messages = [makeUser("a"), makeAssistant("b")];
    expect(findLastCompactBoundaryIndex(messages)).toBe(-1);
  });

  it("returns the index of the last boundary", () => {
    const messages = [
      makeUser("old"),
      makeBoundaryMessage("b1"),
      makeUser("mid"),
      makeBoundaryMessage("b2"),
      makeUser("new"),
    ];
    expect(findLastCompactBoundaryIndex(messages)).toBe(3);
  });
});

describe("getMessagesAfterCompactBoundary", () => {
  it("returns all messages when no boundary exists", () => {
    const messages = [makeUser("a"), makeAssistant("b")];
    const result = getMessagesAfterCompactBoundary(messages);
    expect(result).toEqual(messages);
  });

  it("returns only messages after the last boundary (inclusive)", () => {
    const messages = [
      makeUser("old question"),
      makeAssistant("old answer"),
      makeBoundaryMessage("b1"),
      makeUser("summary"),
      makeUser("new question"),
      makeAssistant("new answer"),
    ];
    const result = getMessagesAfterCompactBoundary(messages);
    expect(result.length).toBe(4);
    expect(isCompactBoundaryMessage(result[0])).toBe(true);
  });

  it("handles multiple boundaries — uses the last one", () => {
    const messages = [
      makeUser("v1"),
      makeBoundaryMessage("b1"),
      makeUser("v2"),
      makeBoundaryMessage("b2"),
      makeUser("v3"),
    ];
    const result = getMessagesAfterCompactBoundary(messages);
    expect(result.length).toBe(2);
    expect(isCompactBoundaryMessage(result[0])).toBe(true);
  });
});
