import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { randomUUID } from "node:crypto";

export const COMPACT_BOUNDARY_TYPE = "compact_boundary";

export interface CompactBoundaryMetadata {
  trigger: "manual" | "auto";
  preTokens: number;
  messagesSummarized: number;
}

export interface CompactBoundaryLine {
  type: typeof COMPACT_BOUNDARY_TYPE;
  id: string;
  timestamp: string;
  metadata: CompactBoundaryMetadata;
}

export function createCompactBoundaryLine(
  metadata: CompactBoundaryMetadata,
): CompactBoundaryLine {
  return {
    type: COMPACT_BOUNDARY_TYPE,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    metadata,
  };
}

export function isCompactBoundaryMessage(message: AgentMessage): boolean {
  const octopus = (message as unknown as Record<string, unknown>).__octopus as
    | { kind?: string }
    | undefined;
  return octopus?.kind === COMPACT_BOUNDARY_TYPE;
}

export function findLastCompactBoundaryIndex(messages: AgentMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isCompactBoundaryMessage(messages[i])) return i;
  }
  return -1;
}

export function getMessagesAfterCompactBoundary(
  messages: AgentMessage[],
): AgentMessage[] {
  const boundaryIndex = findLastCompactBoundaryIndex(messages);
  // Slice from boundaryIndex + 1: exclude the boundary marker itself from API messages
  return boundaryIndex === -1 ? messages : messages.slice(boundaryIndex + 1);
}
