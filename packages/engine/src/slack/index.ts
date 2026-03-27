// STUB: removed from Octopus slim build
export {
  listEnabledSlackAccounts,
  listSlackAccountIds,
  resolveDefaultSlackAccountId,
  resolveSlackAccount,
} from "./accounts.js";
export { monitorSlackProvider } from "./monitor.js";
export { probeSlack } from "./probe.js";
export { sendMessageSlack } from "./send.js";

// Stubbed action exports (actions.ts removed in slim build)
export async function reactSlackMessage(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function removeSlackReaction(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function removeOwnSlackReactions(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function listSlackReactions(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function sendSlackMessage(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function editSlackMessage(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function deleteSlackMessage(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function readSlackMessages(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function getSlackMemberInfo(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function listSlackEmojis(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function pinSlackMessage(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function unpinSlackMessage(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}
export async function listSlackPins(..._args: unknown[]): Promise<unknown> {
  throw new Error('Channel not available in Octopus slim build');
}

// Stubbed token exports (token.ts removed in slim build)
export function resolveSlackAppToken(..._args: unknown[]): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}
export function resolveSlackBotToken(..._args: unknown[]): string | undefined {
  throw new Error('Channel not available in Octopus slim build');
}
