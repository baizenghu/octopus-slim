/**
 * Shell injection detection — pure detection logic extracted from Claude Code
 * BashTool/bashSecurity.ts.
 *
 * Checks for command substitution, dangerous zsh commands, unescaped backticks,
 * control characters, and other shell injection vectors.
 *
 * Pure function, no side effects, no external dependencies.
 */

export type ShellInjectionResult = {
  safe: boolean;
  reason?: string;
};

// ── Command substitution patterns ──────────────────────────────────────

const COMMAND_SUBSTITUTION_PATTERNS: readonly { pattern: RegExp; message: string }[] = [
  { pattern: /<\(/, message: "process substitution <()" },
  { pattern: />\(/, message: "process substitution >()" },
  { pattern: /=\(/, message: "Zsh process substitution =()" },
  { pattern: /(?:^|[\s;&|])=[a-zA-Z_]/, message: "Zsh equals expansion (=cmd)" },
  { pattern: /\$\(/, message: "$() command substitution" },
  { pattern: /\$\{/, message: "${} parameter substitution" },
  { pattern: /\$\[/, message: "$[] legacy arithmetic expansion" },
  { pattern: /~\[/, message: "Zsh-style parameter expansion" },
  { pattern: /\(e:/, message: "Zsh-style glob qualifiers" },
  { pattern: /\(\+/, message: "Zsh glob qualifier with command execution" },
  { pattern: /\}\s*always\s*\{/, message: "Zsh always block (try/always construct)" },
  { pattern: /<#/, message: "PowerShell comment syntax" },
];

// ── Zsh dangerous commands ─────────────────────────────────────────────

const ZSH_DANGEROUS_COMMANDS: ReadonlySet<string> = new Set([
  "zmodload",
  "emulate",
  // zsh/system builtins
  "sysopen", "sysread", "syswrite", "sysseek",
  // pseudo-terminal / network
  "zpty", "ztcp", "zsocket",
  // zsh/files builtins
  "mapfile", "zf_rm", "zf_mv", "zf_ln", "zf_chmod", "zf_chown", "zf_mkdir", "zf_rmdir", "zf_chgrp",
]);

// ── Control character detection ────────────────────────────────────────

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0e-\x1f\x7f]/;

// ── Unicode whitespace (non-ASCII spaces that can hide content) ────────

const UNICODE_WHITESPACE_PATTERN = /[\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Strip single-quoted and double-quoted content from a command string,
 * leaving only the unquoted portions visible to the shell.
 */
function extractUnquotedContent(command: string): string {
  let result = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (escaped) {
      escaped = false;
      if (!inSingleQuote && !inDoubleQuote) result += ch;
      continue;
    }
    if (ch === "\\" && !inSingleQuote) {
      escaped = true;
      if (!inSingleQuote && !inDoubleQuote) result += ch;
      continue;
    }
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      result += ch;
    }
  }

  return result;
}

/**
 * Check for unescaped backtick in content (backtick command substitution).
 */
function hasUnescapedBacktick(content: string): boolean {
  let i = 0;
  while (i < content.length) {
    if (content[i] === "\\" && i + 1 < content.length) {
      i += 2;
      continue;
    }
    if (content[i] === "`") {
      return true;
    }
    i++;
  }
  return false;
}

/**
 * Extract base command (first word) from each segment of a piped/chained command.
 */
function extractBaseCommands(command: string): string[] {
  const bases: string[] = [];
  // Rough split on |, ;, &&, ||
  const segments = command.split(/\s*(?:\|\||&&|[|;])\s*/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    const base = trimmed.split(/\s+/)[0];
    if (base) bases.push(base);
  }
  return bases;
}

// ── Main detection ─────────────────────────────────────────────────────

/**
 * Detect potential shell injection vectors in a command string.
 *
 * Checks against the unquoted portion of the command to avoid false positives
 * from content inside string literals.
 *
 * @returns `{ safe: true }` if no injection detected,
 *          `{ safe: false, reason }` describing the first detected issue.
 */
export function detectShellInjection(command: string): ShellInjectionResult {
  // 1. Control characters (never legitimate in a command)
  if (CONTROL_CHAR_PATTERN.test(command)) {
    return { safe: false, reason: "Command contains control characters" };
  }

  // 2. Unicode whitespace (can hide content)
  if (UNICODE_WHITESPACE_PATTERN.test(command)) {
    return { safe: false, reason: "Command contains non-ASCII whitespace characters" };
  }

  const unquoted = extractUnquotedContent(command);

  // 3. Command substitution patterns (checked against unquoted content)
  for (const { pattern, message } of COMMAND_SUBSTITUTION_PATTERNS) {
    if (pattern.test(unquoted)) {
      return { safe: false, reason: `Detected ${message}` };
    }
  }

  // 4. Unescaped backticks (command substitution via `...`)
  if (hasUnescapedBacktick(unquoted)) {
    return { safe: false, reason: "Detected unescaped backtick command substitution" };
  }

  // 5. Zsh dangerous commands
  const bases = extractBaseCommands(unquoted);
  for (const base of bases) {
    if (ZSH_DANGEROUS_COMMANDS.has(base)) {
      return { safe: false, reason: `Detected dangerous Zsh command: ${base}` };
    }
  }

  // 6. IFS manipulation (can alter word splitting)
  if (/\bIFS\s*=/.test(unquoted)) {
    return { safe: false, reason: "Detected IFS variable manipulation" };
  }

  // 7. /proc/*/environ access (credential exfiltration)
  if (/\/proc\/[^/]*\/environ/.test(unquoted)) {
    return { safe: false, reason: "Detected /proc/*/environ access" };
  }

  return { safe: true };
}
