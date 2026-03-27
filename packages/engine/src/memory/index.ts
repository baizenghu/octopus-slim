// SLIM STUB: native memory module removed; enterprise uses memory-lancedb-pro plugin.

export type {
  MemoryEmbeddingProbeResult,
  MemorySearchManager,
  MemorySearchResult,
} from "./types.js";

export type MemorySearchManagerResult = {
  manager: import("./types.js").MemorySearchManager | null;
  error?: string;
};

export async function getMemorySearchManager(_params: {
  cfg: unknown;
  agentId: string;
  purpose?: "default" | "status";
}): Promise<MemorySearchManagerResult> {
  return { manager: null, error: "native memory removed (slim build)" };
}

export async function closeAllMemorySearchManagers(): Promise<void> {
  // no-op stub
}

/** Stub class — never instantiated in slim build. */
export class MemoryIndexManager {
  static async get(_params: unknown): Promise<null> {
    return null;
  }
}
