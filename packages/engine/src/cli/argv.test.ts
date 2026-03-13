import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getCommandPositionalsWithRootOptions,
  getCommandPathWithRootOptions,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  isRootHelpInvocation,
  isRootVersionInvocation,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    {
      name: "help flag",
      argv: ["node", "octopus", "--help"],
      expected: true,
    },
    {
      name: "version flag",
      argv: ["node", "octopus", "-V"],
      expected: true,
    },
    {
      name: "normal command",
      argv: ["node", "octopus", "status"],
      expected: false,
    },
    {
      name: "root -v alias",
      argv: ["node", "octopus", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "octopus", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with log-level",
      argv: ["node", "octopus", "--log-level", "debug", "-v"],
      expected: true,
    },
    {
      name: "subcommand -v should not be treated as version",
      argv: ["node", "octopus", "acp", "-v"],
      expected: false,
    },
    {
      name: "root -v alias with equals profile",
      argv: ["node", "octopus", "--profile=work", "-v"],
      expected: true,
    },
    {
      name: "subcommand path after global root flags should not be treated as version",
      argv: ["node", "octopus", "--dev", "skills", "list", "-v"],
      expected: false,
    },
  ])("detects help/version flags: $name", ({ argv, expected }) => {
    expect(hasHelpOrVersion(argv)).toBe(expected);
  });

  it.each([
    {
      name: "root --version",
      argv: ["node", "octopus", "--version"],
      expected: true,
    },
    {
      name: "root -V",
      argv: ["node", "octopus", "-V"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "octopus", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "subcommand version flag",
      argv: ["node", "octopus", "status", "--version"],
      expected: false,
    },
    {
      name: "unknown root flag with version",
      argv: ["node", "octopus", "--unknown", "--version"],
      expected: false,
    },
  ])("detects root-only version invocations: $name", ({ argv, expected }) => {
    expect(isRootVersionInvocation(argv)).toBe(expected);
  });

  it.each([
    {
      name: "root --help",
      argv: ["node", "octopus", "--help"],
      expected: true,
    },
    {
      name: "root -h",
      argv: ["node", "octopus", "-h"],
      expected: true,
    },
    {
      name: "root --help with profile",
      argv: ["node", "octopus", "--profile", "work", "--help"],
      expected: true,
    },
    {
      name: "subcommand --help",
      argv: ["node", "octopus", "status", "--help"],
      expected: false,
    },
    {
      name: "help before subcommand token",
      argv: ["node", "octopus", "--help", "status"],
      expected: false,
    },
    {
      name: "help after -- terminator",
      argv: ["node", "octopus", "nodes", "run", "--", "git", "--help"],
      expected: false,
    },
    {
      name: "unknown root flag before help",
      argv: ["node", "octopus", "--unknown", "--help"],
      expected: false,
    },
    {
      name: "unknown root flag after help",
      argv: ["node", "octopus", "--help", "--unknown"],
      expected: false,
    },
  ])("detects root-only help invocations: $name", ({ argv, expected }) => {
    expect(isRootHelpInvocation(argv)).toBe(expected);
  });

  it.each([
    {
      name: "single command with trailing flag",
      argv: ["node", "octopus", "status", "--json"],
      expected: ["status"],
    },
    {
      name: "two-part command",
      argv: ["node", "octopus", "agents", "list"],
      expected: ["agents", "list"],
    },
    {
      name: "terminator cuts parsing",
      argv: ["node", "octopus", "status", "--", "ignored"],
      expected: ["status"],
    },
  ])("extracts command path: $name", ({ argv, expected }) => {
    expect(getCommandPath(argv, 2)).toEqual(expected);
  });

  it("extracts command path while skipping known root option values", () => {
    expect(
      getCommandPathWithRootOptions(
        ["node", "octopus", "--profile", "work", "--no-color", "config", "validate"],
        2,
      ),
    ).toEqual(["config", "validate"]);
  });

  it("extracts routed config get positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "octopus", "config", "get", "--log-level", "debug", "update.channel", "--json"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("extracts routed config unset positionals with interleaved root options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "octopus", "config", "unset", "--profile", "work", "update.channel"],
        {
          commandPath: ["config", "unset"],
        },
      ),
    ).toEqual(["update.channel"]);
  });

  it("returns null when routed command sees unknown options", () => {
    expect(
      getCommandPositionalsWithRootOptions(
        ["node", "octopus", "config", "get", "--mystery", "value", "update.channel"],
        {
          commandPath: ["config", "get"],
          booleanFlags: ["--json"],
        },
      ),
    ).toBeNull();
  });

  it.each([
    {
      name: "returns first command token",
      argv: ["node", "octopus", "agents", "list"],
      expected: "agents",
    },
    {
      name: "returns null when no command exists",
      argv: ["node", "octopus"],
      expected: null,
    },
    {
      name: "skips known root option values",
      argv: ["node", "octopus", "--log-level", "debug", "status"],
      expected: "status",
    },
  ])("returns primary command: $name", ({ argv, expected }) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    {
      name: "detects flag before terminator",
      argv: ["node", "octopus", "status", "--json"],
      flag: "--json",
      expected: true,
    },
    {
      name: "ignores flag after terminator",
      argv: ["node", "octopus", "--", "--json"],
      flag: "--json",
      expected: false,
    },
  ])("parses boolean flags: $name", ({ argv, flag, expected }) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    {
      name: "value in next token",
      argv: ["node", "octopus", "status", "--timeout", "5000"],
      expected: "5000",
    },
    {
      name: "value in equals form",
      argv: ["node", "octopus", "status", "--timeout=2500"],
      expected: "2500",
    },
    {
      name: "missing value",
      argv: ["node", "octopus", "status", "--timeout"],
      expected: null,
    },
    {
      name: "next token is another flag",
      argv: ["node", "octopus", "status", "--timeout", "--json"],
      expected: null,
    },
    {
      name: "flag appears after terminator",
      argv: ["node", "octopus", "--", "--timeout=99"],
      expected: undefined,
    },
  ])("extracts flag values: $name", ({ argv, expected }) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "octopus", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "octopus", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "octopus", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing flag",
      argv: ["node", "octopus", "status"],
      expected: undefined,
    },
    {
      name: "missing value",
      argv: ["node", "octopus", "status", "--timeout"],
      expected: null,
    },
    {
      name: "valid positive integer",
      argv: ["node", "octopus", "status", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "invalid integer",
      argv: ["node", "octopus", "status", "--timeout", "nope"],
      expected: undefined,
    },
  ])("parses positive integer flag values: $name", ({ argv, expected }) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("builds parse argv from raw args", () => {
    const cases = [
      {
        rawArgs: ["node", "octopus", "status"],
        expected: ["node", "octopus", "status"],
      },
      {
        rawArgs: ["node-22", "octopus", "status"],
        expected: ["node-22", "octopus", "status"],
      },
      {
        rawArgs: ["node-22.2.0.exe", "octopus", "status"],
        expected: ["node-22.2.0.exe", "octopus", "status"],
      },
      {
        rawArgs: ["node-22.2", "octopus", "status"],
        expected: ["node-22.2", "octopus", "status"],
      },
      {
        rawArgs: ["node-22.2.exe", "octopus", "status"],
        expected: ["node-22.2.exe", "octopus", "status"],
      },
      {
        rawArgs: ["/usr/bin/node-22.2.0", "octopus", "status"],
        expected: ["/usr/bin/node-22.2.0", "octopus", "status"],
      },
      {
        rawArgs: ["node24", "octopus", "status"],
        expected: ["node24", "octopus", "status"],
      },
      {
        rawArgs: ["/usr/bin/node24", "octopus", "status"],
        expected: ["/usr/bin/node24", "octopus", "status"],
      },
      {
        rawArgs: ["node24.exe", "octopus", "status"],
        expected: ["node24.exe", "octopus", "status"],
      },
      {
        rawArgs: ["nodejs", "octopus", "status"],
        expected: ["nodejs", "octopus", "status"],
      },
      {
        rawArgs: ["node-dev", "octopus", "status"],
        expected: ["node", "octopus", "node-dev", "octopus", "status"],
      },
      {
        rawArgs: ["octopus", "status"],
        expected: ["node", "octopus", "status"],
      },
      {
        rawArgs: ["bun", "src/entry.ts", "status"],
        expected: ["bun", "src/entry.ts", "status"],
      },
    ] as const;

    for (const testCase of cases) {
      const parsed = buildParseArgv({
        programName: "octopus",
        rawArgs: [...testCase.rawArgs],
      });
      expect(parsed).toEqual([...testCase.expected]);
    }
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "octopus",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "octopus", "status"]);
  });

  it("decides when to migrate state", () => {
    const nonMutatingArgv = [
      ["node", "octopus", "status"],
      ["node", "octopus", "health"],
      ["node", "octopus", "sessions"],
      ["node", "octopus", "config", "get", "update"],
      ["node", "octopus", "config", "unset", "update"],
      ["node", "octopus", "models", "list"],
      ["node", "octopus", "models", "status"],
      ["node", "octopus", "memory", "status"],
      ["node", "octopus", "agent", "--message", "hi"],
    ] as const;
    const mutatingArgv = [
      ["node", "octopus", "agents", "list"],
      ["node", "octopus", "message", "send"],
    ] as const;

    for (const argv of nonMutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(false);
    }
    for (const argv of mutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(true);
    }
  });

  it.each([
    { path: ["status"], expected: false },
    { path: ["config", "get"], expected: false },
    { path: ["models", "status"], expected: false },
    { path: ["agents", "list"], expected: true },
  ])("reuses command path for migrate state decisions: $path", ({ path, expected }) => {
    expect(shouldMigrateStateFromPath(path)).toBe(expected);
  });
});
