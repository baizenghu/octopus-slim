// STUB: removed from Octopus slim build

type TelegramBindingTargetKind = "subagent" | "acp";

export type TelegramThreadBindingRecord = {
  accountId: string;
  conversationId: string;
  targetKind: TelegramBindingTargetKind;
  targetSessionKey: string;
  agentId?: string;
  label?: string;
  boundBy?: string;
  boundAt: number;
  lastActivityAt: number;
  idleTimeoutMs?: number;
  maxAgeMs?: number;
};

export type TelegramThreadBindingManager = {
  accountId: string;
  shouldPersistMutations: () => boolean;
  getIdleTimeoutMs: () => number;
  getMaxAgeMs: () => number;
  getByConversationId: (conversationId: string) => TelegramThreadBindingRecord | undefined;
  listBySessionKey: (targetSessionKey: string) => TelegramThreadBindingRecord[];
  listBindings: () => TelegramThreadBindingRecord[];
  touchConversation: (conversationId: string, at?: number) => TelegramThreadBindingRecord | null;
  unbindConversation: (params: {
    conversationId: string;
    reason?: string;
    sendFarewell?: boolean;
  }) => TelegramThreadBindingRecord | null;
  unbindBySessionKey: (params: {
    targetSessionKey: string;
    reason?: string;
    sendFarewell?: boolean;
  }) => TelegramThreadBindingRecord[];
  stop: () => void;
};

export function createTelegramThreadBindingManager(
  params: {
    accountId?: string;
    persist?: boolean;
    idleTimeoutMs?: number;
    maxAgeMs?: number;
    enableSweeper?: boolean;
  } = {},
): TelegramThreadBindingManager {
  throw new Error('Channel not available in Octopus slim build');
}

export function getTelegramThreadBindingManager(
  accountId?: string,
): TelegramThreadBindingManager | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function setTelegramThreadBindingIdleTimeoutBySessionKey(params: {
  targetSessionKey: string;
  accountId?: string;
  idleTimeoutMs: number;
}): TelegramThreadBindingRecord[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function setTelegramThreadBindingMaxAgeBySessionKey(params: {
  targetSessionKey: string;
  accountId?: string;
  maxAgeMs: number;
}): TelegramThreadBindingRecord[] {
  throw new Error('Channel not available in Octopus slim build');
}
