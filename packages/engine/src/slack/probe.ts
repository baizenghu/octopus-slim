// STUB: removed from Octopus slim build
import type { BaseProbeResult } from "../channels/plugins/types.js";

export type SlackProbe = BaseProbeResult & {
  status?: number | null;
  elapsedMs?: number | null;
  bot?: { id?: string; name?: string };
  team?: { id?: string; name?: string };
};

export async function probeSlack(_token: string, _timeoutMs = 2500): Promise<SlackProbe> {
  throw new Error('Channel not available in Octopus slim build');
}
