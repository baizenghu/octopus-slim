// STUB: removed from Octopus slim build

export const DISCORD_DEFAULT_LISTENER_TIMEOUT_MS = 120_000;
export const DISCORD_DEFAULT_INBOUND_WORKER_TIMEOUT_MS = 30 * 60_000;

export function normalizeDiscordListenerTimeoutMs(raw: number | undefined): number {
  throw new Error("Channel not available in Octopus slim build");
}

export function normalizeDiscordInboundWorkerTimeoutMs(
  raw: number | undefined,
): number | undefined {
  throw new Error("Channel not available in Octopus slim build");
}

export function isAbortError(error: unknown): boolean {
  throw new Error("Channel not available in Octopus slim build");
}
