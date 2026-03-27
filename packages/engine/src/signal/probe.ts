// STUB: removed from Octopus slim build

import type { BaseProbeResult } from "../channels/plugins/types.js";

export type SignalProbe = BaseProbeResult & {
  status?: number | null;
  elapsedMs: number;
  version?: string | null;
};

export async function probeSignal(_baseUrl: string, _timeoutMs: number): Promise<SignalProbe> {
  throw new Error('Channel not available in Octopus slim build');
}
