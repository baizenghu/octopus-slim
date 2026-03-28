#!/usr/bin/env python3
"""Run Claude Code (claude CLI) reliably.

PTY wrapper: uses script(1) to provide a pseudo-terminal,
solving the hang issue in non-TTY environments (exec/cron).

Adapted for Octopus: claude binary auto-detected from PATH.
"""

from __future__ import annotations

import argparse
import os
import shlex
import subprocess
import sys
from pathlib import Path


def which(name: str) -> str | None:
    paths = os.environ.get("PATH", "").split(":")
    for p in paths:
        cand = Path(p) / name
        try:
            if cand.is_file() and os.access(cand, os.X_OK):
                return str(cand)
        except OSError:
            pass
    return None


DEFAULT_CLAUDE = os.environ.get("CLAUDE_CODE_BIN") or which("claude") or "claude"


def build_headless_cmd(args: argparse.Namespace) -> list[str]:
    cmd: list[str] = [args.claude_bin]

    if args.permission_mode:
        cmd += ["--permission-mode", args.permission_mode]

    if args.prompt is not None and len(args.prompt) <= 1500:
        cmd += ["-p", args.prompt]
    elif args.prompt is not None:
        cmd += ["-p", "-"]

    if args.allowedTools:
        cmd += ["--allowedTools", args.allowedTools]
    if args.disallowedTools:
        cmd += ["--disallowedTools", args.disallowedTools]
    if args.append_system_prompt:
        cmd += ["--append-system-prompt", args.append_system_prompt]
    if args.append_system_prompt_file:
        cmd += ["--append-system-prompt-file", args.append_system_prompt_file]
    if args.teammate_mode:
        cmd += ["--teammate-mode", args.teammate_mode]
    if args.agents_json:
        cmd += ["--agents", args.agents_json]
    if args.max_budget_usd is not None:
        cmd += ["--max-budget-usd", str(args.max_budget_usd)]
    if args.max_turns is not None:
        cmd += ["--max-turns", str(args.max_turns)]
    if args.fallback_model:
        cmd += ["--fallback-model", args.fallback_model]
    if args.worktree:
        cmd += ["--worktree", args.worktree]
    if args.no_session_persistence:
        cmd.append("--no-session-persistence")
    if args.mcp_config:
        cmd += ["--mcp-config", args.mcp_config]
    if args.verbose:
        cmd.append("--verbose")
    if args.model:
        cmd += ["--model", args.model]
    if args.extra:
        cmd += args.extra

    return cmd


def build_agent_teams_env(args: argparse.Namespace) -> dict[str, str]:
    env = os.environ.copy()
    if args.agent_teams:
        env["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] = "1"
    return env


def run_with_pty(
    cmd: list[str],
    cwd: str | None,
    env: dict[str, str] | None = None,
    stdin_text: str | None = None,
) -> int:
    cmd_str = " ".join(shlex.quote(c) for c in cmd)
    script_bin = which("script")

    if stdin_text:
        import tempfile

        with tempfile.NamedTemporaryFile(
            mode="w", suffix=".txt", delete=False, prefix="claude-prompt-"
        ) as f:
            f.write(stdin_text)
            prompt_path = f.name
        try:
            shell_cmd = f"cat {shlex.quote(prompt_path)} | {cmd_str}"
            if script_bin:
                proc = subprocess.run(
                    [script_bin, "-q", "-c", shell_cmd, "/dev/null"],
                    cwd=cwd,
                    text=True,
                    env=env,
                )
            else:
                proc = subprocess.run(
                    ["bash", "-c", shell_cmd], cwd=cwd, text=True, env=env
                )
            return proc.returncode
        finally:
            try:
                os.unlink(prompt_path)
            except OSError:
                pass
    else:
        if not script_bin:
            proc = subprocess.run(cmd, cwd=cwd, text=True, env=env)
            return proc.returncode

        proc = subprocess.run(
            [script_bin, "-q", "-c", cmd_str, "/dev/null"],
            cwd=cwd,
            text=True,
            env=env,
        )
        return proc.returncode


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Run Claude Code reliably with PTY wrapper"
    )

    ap.add_argument("-p", "--prompt", help="Prompt text")
    ap.add_argument("--prompt-file", dest="prompt_file", help="Read prompt from file")
    ap.add_argument(
        "--permission-mode", default=None, help="Claude Code permission mode"
    )
    ap.add_argument("--allowedTools", dest="allowedTools", help="Allowed tools")
    ap.add_argument("--disallowedTools", dest="disallowedTools", help="Disallowed tools")
    ap.add_argument(
        "--append-system-prompt",
        dest="append_system_prompt",
        help="Append to system prompt",
    )
    ap.add_argument(
        "--append-system-prompt-file",
        dest="append_system_prompt_file",
        help="Append system prompt from file",
    )
    ap.add_argument(
        "--agent-teams", action="store_true", help="Enable Agent Teams"
    )
    ap.add_argument("--teammate-mode", default=None, help="Agent Teams display mode")
    ap.add_argument("--agents-json", dest="agents_json", default=None, help="Custom subagents JSON")
    ap.add_argument(
        "--max-budget-usd", dest="max_budget_usd", type=float, default=None, help="Max USD spend"
    )
    ap.add_argument(
        "--max-turns", dest="max_turns", type=int, default=None, help="Max agentic turns"
    )
    ap.add_argument("--fallback-model", dest="fallback_model", default=None, help="Fallback model")
    ap.add_argument("--worktree", dest="worktree", default=None, help="Git worktree name")
    ap.add_argument(
        "--no-session-persistence",
        dest="no_session_persistence",
        action="store_true",
        help="Don't save session",
    )
    ap.add_argument("--mcp-config", dest="mcp_config", default=None, help="MCP config file")
    ap.add_argument("--model", default=None, help="Model override")
    ap.add_argument("--verbose", action="store_true", help="Verbose logging")
    ap.add_argument(
        "--claude-bin", default=DEFAULT_CLAUDE, help=f"Path to claude (default: {DEFAULT_CLAUDE})"
    )
    ap.add_argument("--cwd", help="Working directory")
    ap.add_argument("extra", nargs=argparse.REMAINDER, help="Extra args after --")

    args = ap.parse_args()

    if args.prompt_file:
        pf = Path(args.prompt_file)
        if not pf.exists():
            print(f"Prompt file not found: {args.prompt_file}", file=sys.stderr)
            return 2
        args.prompt = pf.read_text(encoding="utf-8").strip()

    extra = args.extra
    if extra and extra[0] == "--":
        extra = extra[1:]
    args.extra = extra

    if not Path(args.claude_bin).exists():
        found = which("claude")
        if found:
            args.claude_bin = found
        else:
            print(f"claude binary not found: {args.claude_bin}", file=sys.stderr)
            print("Tip: set CLAUDE_CODE_BIN=/path/to/claude", file=sys.stderr)
            return 2

    cmd = build_headless_cmd(args)
    env = build_agent_teams_env(args)
    stdin_text = args.prompt if (args.prompt and len(args.prompt) > 1500) else None
    return run_with_pty(cmd, cwd=args.cwd, env=env, stdin_text=stdin_text)


if __name__ == "__main__":
    raise SystemExit(main())
