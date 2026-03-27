// STUB: removed from Octopus slim build
export * from "./client-actions-core.js";

const _err = (): never => { throw new Error("Browser not available in Octopus slim build"); };

export async function browserAct(..._args: unknown[]): Promise<unknown> { return _err(); }
export async function browserConsoleMessages(..._args: unknown[]): Promise<unknown[]> { return _err(); }
export async function browserScreenshotAction(..._args: unknown[]): Promise<unknown> { return _err(); }
export async function browserPdfSave(..._args: unknown[]): Promise<unknown> { return _err(); }
