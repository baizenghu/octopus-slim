// STUB: browser module removed from Octopus slim build
// All exports consolidated into single file.

// ── config.ts ──
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

// ── client-actions-core.ts ──
export type BrowserFormField = any;

// ── server.ts ──
export function startBrowserControlServiceFromConfig(..._args: any[]): any { return undefined; }
export function startBrowserControlServerFromConfig(..._args: any[]): any { return undefined; }

// ── proxy-files.ts ──
export function applyBrowserProxyPaths(..._args: any[]): any { return undefined; }
export function persistBrowserProxyFiles(..._args: any[]): any { return undefined; }

// ── client-actions.ts ──
export function browserAct(..._args: any[]): any { return undefined; }
export function browserConsoleMessages(..._args: any[]): any { return undefined; }
export function browserArmDialog(..._args: any[]): any { return undefined; }
export function browserArmFileChooser(..._args: any[]): any { return undefined; }
export function browserNavigate(..._args: any[]): any { return undefined; }
export function browserPdfSave(..._args: any[]): any { return undefined; }
export function browserScreenshotAction(..._args: any[]): any { return undefined; }

// ── paths.ts ──
export const DEFAULT_UPLOAD_DIR: any = '';
export function resolveExistingPathsWithinRoot(..._args: any[]): any { return undefined; }

// ── bridge-server.ts ──
export type BrowserBridge = any;
export function startBrowserBridgeServer(..._args: any[]): any { return undefined; }
export function stopBrowserBridgeServer(..._args: any[]): any { return undefined; }

// ── constants.ts ──
export const DEFAULT_AI_SNAPSHOT_MAX_CHARS: any = 0;
export const DEFAULT_BROWSER_EVALUATE_ENABLED: any = {};
export const DEFAULT_OCTOPUS_BROWSER_COLOR: any = '';
export const DEFAULT_OCTOPUS_BROWSER_PROFILE_NAME: any = '';

// ── session-tab-registry.ts ──
export function trackSessionBrowserTab(..._args: any[]): any { return undefined; }
export function untrackSessionBrowserTab(..._args: any[]): any { return undefined; }
export function closeTrackedBrowserTabsForSessions(..._args: any[]): any { return undefined; }

// ── client.ts ──
export type SnapshotResult = any;
export type BrowserCreateProfileResult = any;
export type BrowserDeleteProfileResult = any;
export type BrowserResetProfileResult = any;
export type BrowserStatus = any;
export type BrowserTab = any;
export type ProfileStatus = any;
export function browserCloseTab(..._args: any[]): any { return undefined; }
export function browserFocusTab(..._args: any[]): any { return undefined; }
export function browserOpenTab(..._args: any[]): any { return undefined; }
export function browserProfiles(..._args: any[]): any { return undefined; }
// Note: browserScreenshotAction already exported from client-actions section
export function browserStart(..._args: any[]): any { return undefined; }
export function browserStatus(..._args: any[]): any { return undefined; }
export function browserStop(..._args: any[]): any { return undefined; }
export function browserSnapshot(..._args: any[]): any { return undefined; }
export function browserTabs(..._args: any[]): any { return undefined; }

// ── trash.ts ──
export function movePathToTrash(..._args: any[]): any { return undefined; }

// ── control-auth.ts ──
export function ensureBrowserControlAuth(..._args: any[]): any { return undefined; }
export function resolveBrowserControlAuth(..._args: any[]): any { return undefined; }

// ── routes/dispatcher.ts ──
export function createBrowserRouteDispatcher(..._args: any[]): any { return undefined; }

// ── control-service.ts ──
export function createBrowserControlContext(..._args: any[]): any { return undefined; }
// Note: startBrowserControlServiceFromConfig already exported from server section

// ── form-fields.ts ──
export function normalizeBrowserFormField(..._args: any[]): any { return undefined; }
export function normalizeBrowserFormFieldValue(..._args: any[]): any { return undefined; }
