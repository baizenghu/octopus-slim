// STUB: removed from Octopus slim build

export type TrackedSessionBrowserTab = {
  sessionKey: string;
  targetId: string;
  tabId?: string;
};

export function trackSessionBrowserTab(_params: unknown): void {}

export function untrackSessionBrowserTab(_params: unknown): void {}

export async function closeTrackedBrowserTabsForSessions(_params: unknown): Promise<void> {}

export function __resetTrackedSessionBrowserTabsForTests(): void {}

export function __countTrackedSessionBrowserTabsForTests(_sessionKey?: string): number {
  return 0;
}
