import { isValueToken } from "../../infra/cli-root-options.js";
import { defaultRuntime } from "../../runtime.js";
import {
  getFlagValue,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasFlag,
} from "../argv.js";

export type RouteSpec = {
  match: (path: string[]) => boolean;
  loadPlugins?: boolean | ((argv: string[]) => boolean);
  run: (argv: string[]) => Promise<boolean>;
};

const routeHealth: RouteSpec = {
  match: (path) => path[0] === "health",
  // `health --json` only relays gateway RPC output and does not need local plugin metadata.
  // Keep plugin preload for text output where channel diagnostics/logSelfId are rendered.
  loadPlugins: (argv) => !hasFlag(argv, "--json"),
  run: async (argv) => {
    const json = hasFlag(argv, "--json");
    const verbose = getVerboseFlag(argv, { includeDebug: true });
    const timeoutMs = getPositiveIntFlagValue(argv, "--timeout");
    if (timeoutMs === null) {
      return false;
    }
    const { healthCommand } = await import("../../commands/health.js");
    await healthCommand({ json, timeoutMs, verbose }, defaultRuntime);
    return true;
  },
};

const routeStatus: RouteSpec = {
  match: (path) => path[0] === "status",
  // Status runs security audit with channel checks in both text and JSON output,
  // so plugin registry must be ready for consistent findings.
  loadPlugins: true,
  run: async (argv) => {
    const json = hasFlag(argv, "--json");
    const deep = hasFlag(argv, "--deep");
    const all = hasFlag(argv, "--all");
    const usage = hasFlag(argv, "--usage");
    const verbose = getVerboseFlag(argv, { includeDebug: true });
    const timeoutMs = getPositiveIntFlagValue(argv, "--timeout");
    if (timeoutMs === null) {
      return false;
    }
    const { statusCommand } = await import("../../commands/status.js");
    await statusCommand({ json, deep, all, usage, timeoutMs, verbose }, defaultRuntime);
    return true;
  },
};

// SLIM: routeSessions and routeAgentsList removed (CLI commands deleted)

const routeMemoryStatus: RouteSpec = {
  match: (path) => path[0] === "memory" && path[1] === "status",
  run: async (argv) => {
    const agent = getFlagValue(argv, "--agent");
    if (agent === null) {
      return false;
    }
    const json = hasFlag(argv, "--json");
    const deep = hasFlag(argv, "--deep");
    const index = hasFlag(argv, "--index");
    const verbose = hasFlag(argv, "--verbose");
    const { runMemoryStatus } = await import("../memory-cli.js");
    await runMemoryStatus({ agent, json, deep, index, verbose });
    return true;
  },
};

function getFlagValues(argv: string[], name: string): string[] | null {
  const values: string[] = [];
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg || arg === "--") {
      break;
    }
    if (arg === name) {
      const next = args[i + 1];
      if (!isValueToken(next)) {
        return null;
      }
      values.push(next);
      i += 1;
      continue;
    }
    if (arg.startsWith(`${name}=`)) {
      const value = arg.slice(name.length + 1).trim();
      if (!value) {
        return null;
      }
      values.push(value);
    }
  }
  return values;
}

// SLIM: routeConfigGet and routeConfigUnset removed (config-cli deleted)

// SLIM: routeModelsList and routeModelsStatus removed (CLI commands deleted)

const routes: RouteSpec[] = [
  routeHealth,
  routeStatus,
  routeMemoryStatus,
];

export function findRoutedCommand(path: string[]): RouteSpec | null {
  for (const route of routes) {
    if (route.match(path)) {
      return route;
    }
  }
  return null;
}
