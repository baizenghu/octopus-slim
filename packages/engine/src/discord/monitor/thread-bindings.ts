// STUB: removed from Octopus slim build

export type ThreadBindingTargetKind = "subagent" | "acp";

export type ThreadBindingRecord = {
  accountId: string;
  channelId: string;
  threadId: string;
  targetKind: ThreadBindingTargetKind;
  targetSessionKey: string;
  agentId: string;
  label?: string;
  webhookId?: string;
  webhookToken?: string;
  boundBy: string;
  boundAt: number;
  lastActivityAt: number;
  idleTimeoutMs?: number;
  maxAgeMs?: number;
};

export type ThreadBindingManager = {
  accountId: string;
  getIdleTimeoutMs: () => number;
  getMaxAgeMs: () => number;
  getByThreadId: (threadId: string) => ThreadBindingRecord | undefined;
  getBySessionKey: (targetSessionKey: string) => ThreadBindingRecord | undefined;
  listBySessionKey: (targetSessionKey: string) => ThreadBindingRecord[];
  listBindings: () => ThreadBindingRecord[];
  touchThread: (params: {
    threadId: string;
    at?: number;
    persist?: boolean;
  }) => ThreadBindingRecord | null;
  bindTarget: (params: {
    threadId?: string | number;
    channelId?: string;
    createThread?: boolean;
    threadName?: string;
    targetKind: ThreadBindingTargetKind;
    targetSessionKey: string;
    agentId?: string;
    label?: string;
    boundBy?: string;
    introText?: string;
    webhookId?: string;
    webhookToken?: string;
  }) => Promise<ThreadBindingRecord | null>;
  unbindThread: (params: {
    threadId: string;
    reason?: string;
    sendFarewell?: boolean;
    farewellText?: string;
  }) => ThreadBindingRecord | null;
  unbindBySessionKey: (params: {
    targetSessionKey: string;
    targetKind?: ThreadBindingTargetKind;
    reason?: string;
    sendFarewell?: boolean;
    farewellText?: string;
  }) => ThreadBindingRecord[];
  stop: () => void;
};

export type AcpThreadBindingReconciliationResult = {
  bound: number;
  unbound: number;
};

export function formatThreadBindingDurationLabel(..._args: unknown[]): string {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingIntroText(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingThreadName(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingPersona(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingPersonaFromRecord(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordThreadBindingIdleTimeoutMs(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveDiscordThreadBindingMaxAgeMs(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingsEnabled(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function isRecentlyUnboundThreadWebhookMessage(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingIdleTimeoutMs(params: {
  record: Pick<ThreadBindingRecord, "idleTimeoutMs">;
  defaultIdleTimeoutMs: number;
}): number {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingInactivityExpiresAt(params: {
  record: Pick<ThreadBindingRecord, "lastActivityAt" | "idleTimeoutMs">;
  defaultIdleTimeoutMs: number;
}): number | undefined {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingMaxAgeExpiresAt(params: {
  record: Pick<ThreadBindingRecord, "boundAt" | "maxAgeMs">;
  defaultMaxAgeMs: number;
}): number | undefined {
  throw new Error("Channel not available in Octopus slim build");
}

export function resolveThreadBindingMaxAgeMs(params: {
  record: Pick<ThreadBindingRecord, "maxAgeMs">;
  defaultMaxAgeMs: number;
}): number {
  throw new Error("Channel not available in Octopus slim build");
}

export function autoBindSpawnedDiscordSubagent(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function listThreadBindingsBySessionKey(..._args: unknown[]): ThreadBindingRecord[] {
  throw new Error("Channel not available in Octopus slim build");
}

export function listThreadBindingsForAccount(..._args: unknown[]): ThreadBindingRecord[] {
  throw new Error("Channel not available in Octopus slim build");
}

export function reconcileAcpThreadBindingsOnStartup(..._args: unknown[]): unknown {
  throw new Error("Channel not available in Octopus slim build");
}

export function setThreadBindingIdleTimeoutBySessionKey(params: {
  targetSessionKey: string;
  accountId?: string;
  idleTimeoutMs: number;
}): ThreadBindingRecord[] {
  throw new Error("Channel not available in Octopus slim build");
}

export function setThreadBindingMaxAgeBySessionKey(params: {
  targetSessionKey: string;
  accountId?: string;
  maxAgeMs: number;
}): ThreadBindingRecord[] {
  throw new Error("Channel not available in Octopus slim build");
}

export function unbindThreadBindingsBySessionKey(params: {
  targetSessionKey: string;
  accountId?: string;
  targetKind?: ThreadBindingTargetKind;
  reason?: string;
  sendFarewell?: boolean;
  farewellText?: string;
}): ThreadBindingRecord[] {
  throw new Error("Channel not available in Octopus slim build");
}

export const __testing = {};

export function createNoopThreadBindingManager(..._args: unknown[]): ThreadBindingManager {
  throw new Error("Channel not available in Octopus slim build");
}

export function createThreadBindingManager(..._args: unknown[]): ThreadBindingManager {
  throw new Error("Channel not available in Octopus slim build");
}

export function getThreadBindingManager(..._args: unknown[]): ThreadBindingManager | undefined {
  throw new Error("Channel not available in Octopus slim build");
}
