// STUB: removed from Octopus slim build

export function resolveAcpSpawnStreamLogPath(_params: {
  childSessionKey: string;
}): string | undefined {
  return undefined;
}

export type AcpSpawnParentRelayHandle = {
  dispose: () => void;
  notifyStarted: () => void;
};

export function startAcpSpawnParentStreamRelay(_params: {
  runId: string;
  parentSessionKey: string;
  childSessionKey: string;
  agentId: string;
  logPath?: string;
  streamFlushMs?: number;
  noOutputNoticeMs?: number;
  noOutputPollMs?: number;
  maxRelayLifetimeMs?: number;
  emitStartNotice?: boolean;
}): AcpSpawnParentRelayHandle {
  return {
    dispose: () => {},
    notifyStarted: () => {},
  };
}
