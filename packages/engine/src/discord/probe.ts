// STUB: removed from Octopus slim build
import type { BaseProbeResult } from "../channels/plugins/types.js";

export type DiscordProbe = BaseProbeResult & {
  status?: number | null;
  elapsedMs: number;
  bot?: { id?: string | null; username?: string | null };
  application?: DiscordApplicationSummary;
};

export type DiscordPrivilegedIntentStatus = "enabled" | "limited" | "disabled";

export type DiscordPrivilegedIntentsSummary = {
  messageContent: DiscordPrivilegedIntentStatus;
  guildMembers: DiscordPrivilegedIntentStatus;
  presence: DiscordPrivilegedIntentStatus;
};

export type DiscordApplicationSummary = {
  id?: string | null;
  flags?: number | null;
  intents?: DiscordPrivilegedIntentsSummary;
};

export function resolveDiscordPrivilegedIntentsFromFlags(
  flags: number,
): DiscordPrivilegedIntentsSummary {
  throw new Error("Channel not available in Octopus slim build");
}

export async function fetchDiscordApplicationSummary(
  token: string,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<DiscordApplicationSummary | undefined> {
  throw new Error("Channel not available in Octopus slim build");
}

export function parseApplicationIdFromToken(token: string): string | undefined {
  throw new Error("Channel not available in Octopus slim build");
}

export async function fetchDiscordApplicationId(
  token: string,
  timeoutMs: number,
  fetcher: typeof fetch = fetch,
): Promise<string | undefined> {
  throw new Error("Channel not available in Octopus slim build");
}

export async function probeDiscord(
  token: string,
  timeoutMs: number,
  opts?: { fetcher?: typeof fetch; includeApplication?: boolean },
): Promise<DiscordProbe> {
  throw new Error("Channel not available in Octopus slim build");
}
