// STUB: removed from Octopus slim build

export type BrowserFormField = {
  ref?: string;
  type?: string;
  value?: string | boolean | string[];
  label?: string;
  [key: string]: unknown;
};

export type BrowserActRequest = {
  action?: string;
  kind?: string;
  targetId?: string;
  ref?: string;
  value?: string;
  [key: string]: unknown;
};

export type BrowserActResponse = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

export type BrowserDownloadPayload = {
  url: string;
  path?: string;
  [key: string]: unknown;
};

const _err = (): never => { throw new Error("Browser not available in Octopus slim build"); };

export async function browserNavigate(..._args: unknown[]): Promise<unknown> { return _err(); }
export async function browserArmDialog(..._args: unknown[]): Promise<unknown> { return _err(); }
export async function browserArmFileChooser(..._args: unknown[]): Promise<unknown> { return _err(); }
export async function browserWaitForDownload(..._args: unknown[]): Promise<unknown> { return _err(); }
