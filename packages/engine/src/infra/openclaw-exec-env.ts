export const OCTOPUS_CLI_ENV_VAR = "OCTOPUS_CLI";
export const OCTOPUS_CLI_ENV_VALUE = "1";

export function markOctopusExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [OCTOPUS_CLI_ENV_VAR]: OCTOPUS_CLI_ENV_VALUE,
  };
}

export function ensureOctopusExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[OCTOPUS_CLI_ENV_VAR] = OCTOPUS_CLI_ENV_VALUE;
  return env;
}
