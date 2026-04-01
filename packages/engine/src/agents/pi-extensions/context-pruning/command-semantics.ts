/**
 * Command semantics for interpreting exit codes in different contexts.
 *
 * Many commands use exit codes to convey information other than just success/failure.
 * For example, grep returns 1 when no matches are found, which is not an error condition.
 *
 * Ported from Claude Code BashTool/commandSemantics.ts — adapted as a pure function
 * with zero external dependencies.
 */

export type CommandSemanticResult = {
  isError: boolean;
  message?: string;
};

type CommandSemantic = (
  exitCode: number,
  stdout: string,
  stderr: string,
) => CommandSemanticResult;

const DEFAULT_SEMANTIC: CommandSemantic = (exitCode) => ({
  isError: exitCode !== 0,
  message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
});

/**
 * Command-specific exit code semantics.
 */
const COMMAND_SEMANTICS: ReadonlyMap<string, CommandSemantic> = new Map([
  // grep: 0=matches found, 1=no matches, 2+=error
  ["grep", (exitCode) => ({ isError: exitCode >= 2, message: exitCode === 1 ? "No matches found" : undefined })],
  // ripgrep same as grep
  ["rg", (exitCode) => ({ isError: exitCode >= 2, message: exitCode === 1 ? "No matches found" : undefined })],
  // find: 0=success, 1=partial success (some dirs inaccessible), 2+=error
  ["find", (exitCode) => ({ isError: exitCode >= 2, message: exitCode === 1 ? "Some directories were inaccessible" : undefined })],
  // diff: 0=no differences, 1=differences found, 2+=error
  ["diff", (exitCode) => ({ isError: exitCode >= 2, message: exitCode === 1 ? "Files differ" : undefined })],
  // test/[: 0=condition true, 1=condition false, 2+=error
  ["test", (exitCode) => ({ isError: exitCode >= 2, message: exitCode === 1 ? "Condition is false" : undefined })],
  ["[", (exitCode) => ({ isError: exitCode >= 2, message: exitCode === 1 ? "Condition is false" : undefined })],
]);

/**
 * Split a command line into segments by pipe/semicolon/&& /||.
 * Lightweight heuristic — not a full shell parser.
 */
function splitCommandSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\" && !inSingleQuote) {
      escaped = true;
      current += ch;
      continue;
    }
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      // pipe
      if (ch === "|") {
        segments.push(current);
        current = "";
        // skip || second char
        if (command[i + 1] === "|") i++;
        continue;
      }
      // semicolon
      if (ch === ";") {
        segments.push(current);
        current = "";
        continue;
      }
      // &&
      if (ch === "&" && command[i + 1] === "&") {
        segments.push(current);
        current = "";
        i++;
        continue;
      }
    }

    current += ch;
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

function extractBaseCommand(segment: string): string {
  return segment.trim().split(/\s+/)[0] ?? "";
}

/**
 * Interpret exit code based on command-specific semantics.
 *
 * Uses the LAST segment of a piped/chained command (since that determines
 * the overall exit code).
 */
export function getCommandSemantic(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): CommandSemanticResult {
  const segments = splitCommandSegments(command);
  const lastSegment = segments[segments.length - 1] ?? command;
  const baseCommand = extractBaseCommand(lastSegment);

  const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC;
  return semantic(exitCode, stdout, stderr);
}
