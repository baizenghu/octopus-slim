// STUB: removed from Octopus slim build

import type { OctopusConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";

export type MonitorIMessageOpts = {
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  cliPath?: string;
  dbPath?: string;
  accountId?: string;
  config?: OctopusConfig;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  includeAttachments?: boolean;
  mediaMaxMb?: number;
  requireMention?: boolean;
};

export function monitorIMessageProvider(_opts: MonitorIMessageOpts): never {
  throw new Error('Channel not available in Octopus slim build');
}
