// STUB: removed from Octopus slim build

export type SignalSender =
  | { kind: "phone"; raw: string; e164: string }
  | { kind: "uuid"; raw: string };

export function looksLikeUuid(_value: string): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveSignalSender(_params: {
  sourceNumber?: string | null;
  sourceUuid?: string | null;
}): SignalSender | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function formatSignalSenderId(_sender: SignalSender): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function formatSignalSenderDisplay(_sender: SignalSender): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function formatSignalPairingIdLine(_sender: SignalSender): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveSignalRecipient(_sender: SignalSender): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveSignalPeerId(_sender: SignalSender): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function normalizeSignalAllowRecipient(_entry: string): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export function isSignalSenderAllowed(_sender: SignalSender, _allowFrom: string[]): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function isSignalGroupAllowed(_params: {
  groupPolicy: "open" | "disabled" | "allowlist";
  allowFrom: string[];
  sender: SignalSender;
}): boolean {
  throw new Error('Channel not available in Octopus slim build');
}
