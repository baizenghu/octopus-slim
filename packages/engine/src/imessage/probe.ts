// STUB: removed from Octopus slim build

import type { BaseProbeResult } from "../channels/plugins/types.js";
import type { RuntimeEnv } from "../runtime.js";

export const DEFAULT_IMESSAGE_PROBE_TIMEOUT_MS = 10000;

export type IMessageProbe = BaseProbeResult & {
  fatal?: boolean;
};

export type IMessageProbeOptions = {
  cliPath?: string;
  dbPath?: string;
  runtime?: RuntimeEnv;
};

export async function probeIMessage(
  _timeoutMs?: number,
  _opts: IMessageProbeOptions = {},
): Promise<IMessageProbe> {
  throw new Error('Channel not available in Octopus slim build');
}
