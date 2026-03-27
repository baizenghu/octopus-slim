// STUB: removed from Octopus slim build
import os from "node:os";
import path from "node:path";

const _tmpDir = path.join(os.tmpdir(), "octopus-browser");

export const DEFAULT_BROWSER_TMP_DIR = _tmpDir;
export const DEFAULT_TRACE_DIR = _tmpDir;
export const DEFAULT_DOWNLOAD_DIR = path.join(_tmpDir, "downloads");
export const DEFAULT_UPLOAD_DIR = path.join(_tmpDir, "uploads");

export type PathsResult = { ok: boolean; error?: string; paths?: string[] };

export function resolvePathWithinRoot(_params: unknown): string {
  throw new Error("Browser not available in Octopus slim build");
}

export async function resolveWritablePathWithinRoot(_params: unknown): Promise<string> {
  throw new Error("Browser not available in Octopus slim build");
}

export function resolvePathsWithinRoot(_params: unknown): string[] {
  return [];
}

export async function resolveExistingPathsWithinRoot(_params: unknown): Promise<PathsResult> {
  return { ok: true, paths: [] };
}

export async function resolveStrictExistingPathsWithinRoot(_params: unknown): Promise<PathsResult> {
  return { ok: true, paths: [] };
}
