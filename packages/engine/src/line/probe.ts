// STUB: removed from Octopus slim build

import type { LineProbeResult } from "./types.js";

export async function probeLineBot(
  _channelAccessToken: string,
  _timeoutMs?: number,
): Promise<LineProbeResult> {
  throw new Error('Channel not available in Octopus slim build');
}
