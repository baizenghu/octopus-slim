import type { Command } from "commander";
import type { OctopusConfig } from "../../config/config.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import { getPrimaryCommand, hasHelpOrVersion } from "../argv.js";
import { reparseProgramFromActionArgs } from "./action-reparse.js";
import { removeCommand, removeCommandByName } from "./command-tree.js";

type SubCliRegistrar = (program: Command) => Promise<void> | void;

type SubCliEntry = {
  name: string;
  description: string;
  hasSubcommands: boolean;
  register: SubCliRegistrar;
};

const shouldRegisterPrimaryOnly = (argv: string[]) => {
  if (isTruthyEnvValue(process.env.OCTOPUS_DISABLE_LAZY_SUBCOMMANDS)) {
    return false;
  }
  if (hasHelpOrVersion(argv)) {
    return false;
  }
  return true;
};

const shouldEagerRegisterSubcommands = (_argv: string[]) => {
  return isTruthyEnvValue(process.env.OCTOPUS_DISABLE_LAZY_SUBCOMMANDS);
};

export const loadValidatedConfigForPluginRegistration =
  async (): Promise<OctopusConfig | null> => {
    const mod = await import("../../config/config.js");
    const snapshot = await mod.readConfigFileSnapshot();
    if (!snapshot.valid) {
      return null;
    }
    return mod.loadConfig();
  };

// Note for humans and agents:
// If you update the list of commands, also check whether they have subcommands
// and set the flag accordingly.
// SLIM: most sub-CLI modules removed; only completion-cli and memory-cli remain
const entries: SubCliEntry[] = [
  {
    name: "completion",
    description: "Generate shell completion script",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../completion-cli.js");
      mod.registerCompletionCli(program);
    },
  },
];

export function getSubCliEntries(): SubCliEntry[] {
  return entries;
}

export function getSubCliCommandsWithSubcommands(): string[] {
  return entries.filter((entry) => entry.hasSubcommands).map((entry) => entry.name);
}

export async function registerSubCliByName(program: Command, name: string): Promise<boolean> {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    return false;
  }
  removeCommandByName(program, entry.name);
  await entry.register(program);
  return true;
}

function registerLazyCommand(program: Command, entry: SubCliEntry) {
  const placeholder = program.command(entry.name).description(entry.description);
  placeholder.allowUnknownOption(true);
  placeholder.allowExcessArguments(true);
  placeholder.action(async (...actionArgs) => {
    removeCommand(program, placeholder);
    await entry.register(program);
    await reparseProgramFromActionArgs(program, actionArgs);
  });
}

export function registerSubCliCommands(program: Command, argv: string[] = process.argv) {
  if (shouldEagerRegisterSubcommands(argv)) {
    for (const entry of entries) {
      void entry.register(program);
    }
    return;
  }
  const primary = getPrimaryCommand(argv);
  if (primary && shouldRegisterPrimaryOnly(argv)) {
    const entry = entries.find((candidate) => candidate.name === primary);
    if (entry) {
      registerLazyCommand(program, entry);
      return;
    }
  }
  for (const candidate of entries) {
    registerLazyCommand(program, candidate);
  }
}
