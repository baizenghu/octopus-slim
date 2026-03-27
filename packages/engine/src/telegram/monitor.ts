// STUB: removed from Octopus slim build
import type { OctopusConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  config?: OctopusConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  webhookPort?: number;
  webhookSecret?: string;
  webhookHost?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
  webhookCertPath?: string;
};

export function createTelegramRunnerOptions(cfg: OctopusConfig): unknown {
  throw new Error('Channel not available in Octopus slim build');
}

export async function monitorTelegramProvider(opts: MonitorTelegramOpts = {}): Promise<void> {
  throw new Error('Channel not available in Octopus slim build');
}
