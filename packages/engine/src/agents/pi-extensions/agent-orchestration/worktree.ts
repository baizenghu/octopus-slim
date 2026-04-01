import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  agentId: string;
  path: string;
  branch: string;
  commitHash?: string;
  createdAt?: Date;
}

const WORKTREES_DIR = ".claude/worktrees";
const BRANCH_PREFIX = "agent-worktree/";
const AGENT_DIR_PREFIX = "agent-";
const MAX_AGENT_ID_LENGTH = 50;

/**
 * Sanitize an agentId so it is safe to use in file paths and branch names.
 * Replaces any character outside [a-zA-Z0-9_-] with a hyphen and truncates to 50 chars.
 */
function sanitizeAgentId(agentId: string): string {
  return agentId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, MAX_AGENT_ID_LENGTH);
}

/**
 * Return the standard worktree path for an agent (may or may not exist).
 * Path: <repoRoot>/.claude/worktrees/agent-<agentId>/
 */
export function getWorktreePath(agentId: string, repoRoot: string): string {
  const safeId = sanitizeAgentId(agentId);
  return path.resolve(path.join(repoRoot, WORKTREES_DIR, `${AGENT_DIR_PREFIX}${safeId}`));
}

/**
 * Return the standard branch name for an agent worktree.
 * Format: agent-worktree/<agentId>
 */
function getWorktreeBranch(agentId: string): string {
  return `${BRANCH_PREFIX}${sanitizeAgentId(agentId)}`;
}

/**
 * Run a git command with execFile (no shell injection risk).
 * Throws an Error wrapping the stderr output on non-zero exit.
 */
async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "stderr" in err
          ? String((err as { stderr: unknown }).stderr)
          : String(err);
    // Re-surface "not a git repository" clearly
    if (message.includes("not a git repository")) {
      throw new Error("not a git repository");
    }
    throw new Error(message);
  }
}

/**
 * Check whether a worktree directory is already registered in git.
 */
async function worktreeExists(worktreePath: string, repoRoot: string): Promise<boolean> {
  const output = await runGit(["worktree", "list", "--porcelain"], repoRoot);
  const normalizedPath = path.resolve(worktreePath);
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      const wPath = path.resolve(line.slice("worktree ".length).trim());
      if (wPath === normalizedPath) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Create an isolated git worktree for the specified agent.
 *
 * @param agentId - Unique agent identifier (used for directory and branch name).
 * @param baseBranch - Base ref to branch from (default: HEAD).
 * @param repoRoot - Absolute path to the git repository root.
 * @returns Absolute path to the created (or already-existing) worktree.
 */
export async function createAgentWorktree(
  agentId: string,
  baseBranch: string = "HEAD",
  repoRoot: string,
): Promise<string> {
  const worktreePath = getWorktreePath(agentId, repoRoot);
  const branch = getWorktreeBranch(agentId);

  // Idempotent: return existing worktree path without error
  if (await worktreeExists(worktreePath, repoRoot)) {
    return worktreePath;
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(worktreePath), { recursive: true });

  // Create the worktree on a new branch
  await runGit(["worktree", "add", "-b", branch, worktreePath, baseBranch], repoRoot);

  return worktreePath;
}

/**
 * Remove the git worktree for the specified agent.
 * Also deletes the associated branch and prunes the worktree metadata.
 *
 * @param agentId - Unique agent identifier.
 * @param repoRoot - Absolute path to the git repository root.
 */
export async function removeAgentWorktree(agentId: string, repoRoot: string): Promise<void> {
  const worktreePath = getWorktreePath(agentId, repoRoot);
  const branch = getWorktreeBranch(agentId);

  const exists = await worktreeExists(worktreePath, repoRoot);
  if (exists) {
    await runGit(["worktree", "remove", "--force", worktreePath], repoRoot);
  }

  // Delete the branch if it exists
  try {
    await runGit(["branch", "-D", branch], repoRoot);
  } catch {
    // Branch may not exist; ignore
  }

  await pruneWorktrees(repoRoot);
}

/**
 * Parse a single stanza from `git worktree list --porcelain` output.
 * Returns null if the stanza does not represent an agent-worktree branch.
 */
function parseWorktreeStanza(stanza: string): WorktreeInfo | null {
  const lines = stanza
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let worktreePath: string | undefined;
  let commitHash: string | undefined;
  let branch: string | undefined;

  for (const line of lines) {
    if (line.startsWith("worktree ")) {
      worktreePath = line.slice("worktree ".length);
    } else if (line.startsWith("HEAD ")) {
      commitHash = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      // refs/heads/agent-worktree/<id>  or  refs/heads/...
      const ref = line.slice("branch ".length);
      const shortName = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      branch = shortName;
    }
  }

  if (!worktreePath || !branch) {
    return null;
  }

  // Only return agent-managed worktrees
  if (!branch.startsWith(BRANCH_PREFIX)) {
    return null;
  }

  const agentId = branch.slice(BRANCH_PREFIX.length);

  return {
    agentId,
    path: worktreePath,
    branch,
    commitHash,
  };
}

/**
 * List all agent-managed git worktrees in the repository.
 * Only returns worktrees whose branch starts with "agent-worktree/".
 *
 * @param repoRoot - Absolute path to the git repository root.
 * @returns Array of WorktreeInfo objects.
 */
export async function listAgentWorktrees(repoRoot: string): Promise<WorktreeInfo[]> {
  const output = await runGit(["worktree", "list", "--porcelain"], repoRoot);

  // Stanzas are separated by blank lines
  const stanzas = output.split(/\n\n+/);
  const results: WorktreeInfo[] = [];

  for (const stanza of stanzas) {
    if (!stanza.trim()) {
      continue;
    }
    const info = parseWorktreeStanza(stanza);
    if (info) {
      results.push(info);
    }
  }

  return results;
}

/**
 * Prune stale worktree metadata from the git repository.
 * Equivalent to `git worktree prune`.
 *
 * @param repoRoot - Absolute path to the git repository root.
 */
export async function pruneWorktrees(repoRoot: string): Promise<void> {
  await runGit(["worktree", "prune"], repoRoot);
}

/**
 * Get a diff summary between a worktree and its merge-base with HEAD.
 * Returns null if the worktree does not exist or there are no commits yet.
 *
 * @param agentId - Unique agent identifier.
 * @param repoRoot - Absolute path to the git repository root.
 * @returns Object with changed file paths, insertion count, and deletion count; or null.
 */
export async function getWorktreeDiff(
  agentId: string,
  repoRoot: string,
): Promise<{ files: string[]; insertions: number; deletions: number } | null> {
  const worktreePath = getWorktreePath(agentId, repoRoot);

  const exists = await worktreeExists(worktreePath, repoRoot);
  if (!exists) {
    return null;
  }

  let mergeBase: string;
  try {
    const output = await runGit(["merge-base", "HEAD", "HEAD"], worktreePath);
    mergeBase = output.trim();
  } catch {
    return null;
  }

  // Use --stat to get a human-readable summary including file list and insertion/deletion counts
  let statOutput: string;
  try {
    statOutput = await runGit(["diff", "--stat", mergeBase], worktreePath);
  } catch {
    return null;
  }

  if (!statOutput.trim()) {
    return { files: [], insertions: 0, deletions: 0 };
  }

  const lines = statOutput.split("\n").filter(Boolean);
  const files: string[] = [];
  let insertions = 0;
  let deletions = 0;

  for (const line of lines) {
    // Summary line: " 3 files changed, 12 insertions(+), 4 deletions(-)"
    const summaryMatch = line.match(
      /(\d+)\s+files?\s+changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/,
    );
    if (summaryMatch) {
      insertions = summaryMatch[2] !== undefined ? parseInt(summaryMatch[2], 10) : 0;
      deletions = summaryMatch[3] !== undefined ? parseInt(summaryMatch[3], 10) : 0;
      continue;
    }
    // File line: " path/to/file.ts | 10 +++--"
    const fileMatch = line.match(/^\s+(.+?)\s+\|/);
    if (fileMatch?.[1]) {
      files.push(fileMatch[1].trim());
    }
  }

  return { files, insertions, deletions };
}
