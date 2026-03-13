import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "octopus",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "octopus", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "octopus", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "octopus", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "octopus", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "octopus", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "octopus", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "octopus", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "octopus", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".octopus-dev");
    expect(env.OCTOPUS_PROFILE).toBe("dev");
    expect(env.OCTOPUS_STATE_DIR).toBe(expectedStateDir);
    expect(env.OCTOPUS_CONFIG_PATH).toBe(path.join(expectedStateDir, "octopus.json"));
    expect(env.OCTOPUS_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      OCTOPUS_STATE_DIR: "/custom",
      OCTOPUS_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.OCTOPUS_STATE_DIR).toBe("/custom");
    expect(env.OCTOPUS_GATEWAY_PORT).toBe("19099");
    expect(env.OCTOPUS_CONFIG_PATH).toBe(path.join("/custom", "octopus.json"));
  });

  it("uses OCTOPUS_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      OCTOPUS_HOME: "/srv/octopus-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/octopus-home");
    expect(env.OCTOPUS_STATE_DIR).toBe(path.join(resolvedHome, ".octopus-work"));
    expect(env.OCTOPUS_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".octopus-work", "octopus.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "octopus doctor --fix",
      env: {},
      expected: "octopus doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "octopus doctor --fix",
      env: { OCTOPUS_PROFILE: "default" },
      expected: "octopus doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "octopus doctor --fix",
      env: { OCTOPUS_PROFILE: "Default" },
      expected: "octopus doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "octopus doctor --fix",
      env: { OCTOPUS_PROFILE: "bad profile" },
      expected: "octopus doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "octopus --profile work doctor --fix",
      env: { OCTOPUS_PROFILE: "work" },
      expected: "octopus --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "octopus --dev doctor",
      env: { OCTOPUS_PROFILE: "dev" },
      expected: "octopus --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("octopus doctor --fix", { OCTOPUS_PROFILE: "work" })).toBe(
      "octopus --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("octopus doctor --fix", { OCTOPUS_PROFILE: "  jboctopus  " })).toBe(
      "octopus --profile jboctopus doctor --fix",
    );
  });

  it("handles command with no args after octopus", () => {
    expect(formatCliCommand("octopus", { OCTOPUS_PROFILE: "test" })).toBe(
      "octopus --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm octopus doctor", { OCTOPUS_PROFILE: "work" })).toBe(
      "pnpm octopus --profile work doctor",
    );
  });
});
