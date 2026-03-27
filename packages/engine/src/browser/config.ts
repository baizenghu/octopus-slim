// STUB: removed from Octopus slim build

export type ResolvedBrowserConfig = {
  enabled: boolean;
  port?: number;
  cdpPort?: number;
  profiles: ResolvedBrowserProfile[] | Record<string, ResolvedBrowserProfile>;
  defaultProfile?: string | ResolvedBrowserProfile;
  [key: string]: unknown;
};

export type ResolvedBrowserProfile = {
  name?: string;
  type?: string;
  cdpPort?: number;
  cdpUrl?: string;
  cdpIsLoopback?: boolean;
  isDefault?: boolean;
  isRemote?: boolean;
  color?: string;
  tabCount?: number;
  [key: string]: unknown;
};

export function parseHttpUrl(_raw: string, _label: string): URL {
  throw new Error("Browser not available in Octopus slim build");
}

export function resolveBrowserConfig(_browserConfig: unknown, _cfg?: unknown): ResolvedBrowserConfig {
  return { enabled: false, profiles: [] };
}

export function resolveProfile(_cfg: unknown, _profileName?: string): ResolvedBrowserProfile | undefined {
  return undefined;
}

export function shouldStartLocalBrowserServer(_resolved: ResolvedBrowserConfig): boolean {
  return false;
}
