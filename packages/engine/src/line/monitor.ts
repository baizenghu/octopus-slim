// STUB: removed from Octopus slim build

import type { OctopusConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";

export function monitorLineProvider(_opts: {
  cfg?: OctopusConfig;
  config?: OctopusConfig;
  accountId?: string;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  channelAccessToken?: string;
  channelSecret?: string;
}): Promise<{ stop: () => void }> {
  throw new Error('Channel not available in Octopus slim build');
}
