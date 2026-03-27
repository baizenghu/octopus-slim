// STUB: removed from Octopus slim build

export type ServicePrefix<TService extends string> = { prefix: string; service: TService };

export type ChatTargetPrefixesParams = {
  trimmed: string;
  lower: string;
  chatIdPrefixes: string[];
  chatGuidPrefixes: string[];
  chatIdentifierPrefixes: string[];
};

export type ParsedChatTarget =
  | { kind: "chat_id"; chatId: number }
  | { kind: "chat_guid"; chatGuid: string }
  | { kind: "chat_identifier"; chatIdentifier: string };

export type ParsedChatAllowTarget = ParsedChatTarget | { kind: "handle"; handle: string };

export type ChatSenderAllowParams = {
  allowFrom: Array<string | number>;
  sender: string;
  chatId?: number | null;
  chatGuid?: string | null;
  chatIdentifier?: string | null;
};

export function resolveServicePrefixedTarget<TService extends string, TTarget>(_params: {
  trimmed: string;
  lower: string;
  servicePrefixes: Array<ServicePrefix<TService>>;
  isChatTarget: (remainderLower: string) => boolean;
  parseTarget: (remainder: string) => TTarget;
}): ({ kind: "handle"; to: string; service: TService } | TTarget) | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveServicePrefixedChatTarget<TService extends string, TTarget>(_params: {
  trimmed: string;
  lower: string;
  servicePrefixes: Array<ServicePrefix<TService>>;
  chatIdPrefixes: string[];
  chatGuidPrefixes: string[];
  chatIdentifierPrefixes: string[];
  extraChatPrefixes?: string[];
  parseTarget: (remainder: string) => TTarget;
}): ({ kind: "handle"; to: string; service: TService } | TTarget) | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function parseChatTargetPrefixesOrThrow(
  _params: ChatTargetPrefixesParams,
): ParsedChatTarget | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveServicePrefixedAllowTarget<TAllowTarget>(_params: {
  trimmed: string;
  lower: string;
  servicePrefixes: Array<{ prefix: string }>;
  parseAllowTarget: (remainder: string) => TAllowTarget;
}): (TAllowTarget | { kind: "handle"; handle: string }) | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveServicePrefixedOrChatAllowTarget<
  TAllowTarget extends ParsedChatAllowTarget,
>(_params: {
  trimmed: string;
  lower: string;
  servicePrefixes: Array<{ prefix: string }>;
  parseAllowTarget: (remainder: string) => TAllowTarget;
  chatIdPrefixes: string[];
  chatGuidPrefixes: string[];
  chatIdentifierPrefixes: string[];
}): TAllowTarget | null {
  throw new Error('Channel not available in Octopus slim build');
}

export function createAllowedChatSenderMatcher<TParsed extends ParsedChatAllowTarget>(_params: {
  normalizeSender: (sender: string) => string;
  parseAllowTarget: (entry: string) => TParsed;
}): (input: ChatSenderAllowParams) => boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function parseChatAllowTargetPrefixes(
  _params: ChatTargetPrefixesParams,
): ParsedChatTarget | null {
  throw new Error('Channel not available in Octopus slim build');
}
