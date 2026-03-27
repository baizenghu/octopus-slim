// SLIM STUB: native memory CLI removed; enterprise uses memory-lancedb-pro plugin.

import type { Command } from "commander";

export async function runMemoryStatus(_opts: Record<string, unknown>): Promise<void> {
  console.log("Memory CLI is not available in slim build.");
}

export function registerMemoryCli(_program: Command): void {
  // no-op stub — native memory CLI removed
}
