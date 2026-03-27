/**
 * tools-cache.json — unified path resolution & read helpers
 *
 * The canonical file is written by plugins/mcp at:
 *   $OCTOPUS_STATE_DIR/tools-cache.json  (default: .octopus-state/tools-cache.json)
 *
 * Legacy fallback: plugins/mcp/tools-cache.json (may be stale)
 */

import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/** Ordered candidate paths — canonical first, legacy fallback second */
const CANDIDATE_PATHS = [
  path.join(PROJECT_ROOT, '.octopus-state', 'tools-cache.json'),
  path.join(PROJECT_ROOT, 'plugins', 'mcp', 'tools-cache.json'),
];

/** Resolve the first existing tools-cache.json path, or null */
export function resolveToolsCachePath(): string | null {
  return CANDIDATE_PATHS.find(p => fs.existsSync(p)) ?? null;
}

/** Minimal shape shared by both consumers */
export interface ToolsCacheEntry {
  serverId: string;
  serverName: string;
  toolName: string;
  nativeToolName: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  scope?: 'enterprise' | 'personal';
  ownerId?: string | null;
}

/** Read & parse tools-cache.json. Returns [] on missing / malformed file. */
export function readToolsCache(): ToolsCacheEntry[] {
  const cachePath = resolveToolsCachePath();
  if (!cachePath) return [];
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return [];
  }
}

/** Async variant for route handlers that prefer await */
export async function readToolsCacheAsync(): Promise<ToolsCacheEntry[]> {
  const cachePath = resolveToolsCachePath();
  if (!cachePath) return [];
  try {
    const raw = await fs.promises.readFile(cachePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
