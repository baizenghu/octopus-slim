// STUB: removed from Octopus slim build
import type { AllowlistMatch } from "../../channels/allowlist-match.js";

export function normalizeSlackSlug(_raw?: string): string {
  throw new Error('Channel not available in Octopus slim build');
}

export function normalizeAllowList(_list?: Array<string | number>): string[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function normalizeAllowListLower(_list?: Array<string | number>): string[] {
  throw new Error('Channel not available in Octopus slim build');
}

export function normalizeSlackAllowOwnerEntry(_entry: string): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}

export type SlackAllowListMatch = AllowlistMatch<
  "wildcard" | "id" | "prefixed-id" | "prefixed-user" | "name" | "prefixed-name" | "slug"
>;

export function resolveSlackAllowListMatch(_params: {
  allowList: string[];
  id?: string;
  name?: string;
  allowNameMatching?: boolean;
}): SlackAllowListMatch {
  throw new Error('Channel not available in Octopus slim build');
}

export function allowListMatches(_params: {
  allowList: string[];
  id?: string;
  name?: string;
  allowNameMatching?: boolean;
}): boolean {
  throw new Error('Channel not available in Octopus slim build');
}

export function resolveSlackUserAllowed(_params: {
  allowList?: Array<string | number>;
  userId?: string;
  userName?: string;
  allowNameMatching?: boolean;
}): boolean {
  throw new Error('Channel not available in Octopus slim build');
}
