/**
 * CronLockProvider registry — process-global singleton via Symbol.for.
 *
 * Mirrors the AgentStore / ContextEngine registry pattern: a well-known
 * Symbol key ensures duplicated dist chunks still share one provider
 * reference at runtime.
 */

import { type CronLockProvider, LocalCronLockProvider } from "./lock-provider.js";

const CRON_LOCK_PROVIDER_KEY = Symbol.for("octopus.cron.lockProvider");

type CronLockRegistryState = {
  provider: CronLockProvider | null;
};

function getCronLockRegistryState(): CronLockRegistryState {
  const globalState = globalThis as typeof globalThis & {
    [CRON_LOCK_PROVIDER_KEY]?: CronLockRegistryState;
  };
  if (!globalState[CRON_LOCK_PROVIDER_KEY]) {
    globalState[CRON_LOCK_PROVIDER_KEY] = { provider: null };
  }
  return globalState[CRON_LOCK_PROVIDER_KEY];
}

/**
 * Register a CronLockProvider implementation.
 * Only one provider can be active at a time — the last call wins.
 */
export function registerCronLockProvider(provider: CronLockProvider): void {
  getCronLockRegistryState().provider = provider;
}

/**
 * Resolve the active CronLockProvider.
 *
 * Resolution order:
 *   1. Explicitly registered provider (via registerCronLockProvider)
 *   2. Default LocalCronLockProvider (single-node, always grants)
 */
let defaultLocal: LocalCronLockProvider | undefined;

export function resolveCronLockProvider(): CronLockProvider {
  const registered = getCronLockRegistryState().provider;
  if (registered) return registered;
  defaultLocal ??= new LocalCronLockProvider();
  return defaultLocal;
}
