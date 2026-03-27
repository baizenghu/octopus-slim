// STUB: removed from Octopus slim build

export type BrowserStatus = {
  enabled?: boolean;
  profile?: string;
  running?: boolean;
  detectedExecutablePath?: string;
  executablePath?: string;
  cdpPort?: number;
  cdpUrl?: string;
  chosenBrowser?: string;
  detectedBrowser?: string;
  color?: string;
  detectError?: string;
  [key: string]: unknown;
};

export type ProfileStatus = {
  name: string;
  type?: string;
  running?: boolean;
  tabCount?: number;
  isDefault?: boolean;
  isRemote?: boolean;
  cdpUrl?: string;
  cdpPort?: number;
  color?: string;
  [key: string]: unknown;
};

export type BrowserResetProfileResult = {
  success?: boolean;
  moved?: boolean;
  from?: string;
  to?: string;
  [key: string]: unknown;
};

export type BrowserTab = {
  targetId: string;
  url?: string;
  title?: string;
  [key: string]: unknown;
};

export type SnapshotAriaNode = {
  role: string;
  name?: string;
  children?: SnapshotAriaNode[];
  [key: string]: unknown;
};

export type SnapshotResult = {
  format?: string;
  snapshot?: string;
  imagePath?: string;
  imageType?: string;
  targetId?: string;
  url?: string;
  truncated?: boolean;
  stats?: unknown;
  refs?: unknown;
  labels?: unknown;
  labelsCount?: number;
  labelsSkipped?: number;
  nodes?: unknown;
  [key: string]: unknown;
};

export type BrowserCreateProfileResult = {
  name: string;
  profile?: unknown;
  color?: string;
  isRemote?: boolean;
  cdpUrl?: string;
  cdpPort?: number;
  [key: string]: unknown;
};

export type BrowserDeleteProfileResult = {
  name: string;
  deleted?: boolean;
  profile?: unknown;
  [key: string]: unknown;
};

const _err = (): never => { throw new Error("Browser not available in Octopus slim build"); };

export async function browserStatus(..._args: unknown[]): Promise<BrowserStatus> { return _err(); }
export async function browserProfiles(..._args: unknown[]): Promise<ProfileStatus[]> { return _err(); }
export async function browserStart(..._args: unknown[]): Promise<void> { return _err(); }
export async function browserStop(..._args: unknown[]): Promise<void> { return _err(); }
export async function browserResetProfile(..._args: unknown[]): Promise<BrowserResetProfileResult> { return _err(); }
export async function browserCreateProfile(..._args: unknown[]): Promise<BrowserCreateProfileResult> { return _err(); }
export async function browserDeleteProfile(..._args: unknown[]): Promise<BrowserDeleteProfileResult> { return _err(); }
export async function browserTabs(..._args: unknown[]): Promise<BrowserTab[]> { return _err(); }
export async function browserOpenTab(..._args: unknown[]): Promise<BrowserTab> { return _err(); }
export async function browserFocusTab(..._args: unknown[]): Promise<void> { return _err(); }
export async function browserCloseTab(..._args: unknown[]): Promise<void> { return _err(); }
export async function browserTabAction(..._args: unknown[]): Promise<unknown> { return _err(); }
export async function browserSnapshot(..._args: unknown[]): Promise<SnapshotResult> { return _err(); }
