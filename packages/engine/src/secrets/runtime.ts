// SLIM: removed
export type activateSecretsRuntimeSnapshot = any;
export function activateSecretsRuntimeSnapshot(..._args: any[]): any { return undefined; }
export type clearSecretsRuntimeSnapshot = any;
export function clearSecretsRuntimeSnapshot(..._args: any[]): any { return undefined; }
export type getActiveSecretsRuntimeSnapshot = any;
export function getActiveSecretsRuntimeSnapshot(..._args: any[]): any { return undefined; }
export type prepareSecretsRuntimeSnapshot = any;
export async function prepareSecretsRuntimeSnapshot(..._args: any[]): Promise<any> {
  const config = _args[0]?.config ?? {};
  return { warnings: [], sourceConfig: config, config };
}
export type resolveCommandSecretsFromActiveRuntimeSnapshot = any;
export function resolveCommandSecretsFromActiveRuntimeSnapshot(..._args: any[]): any { return undefined; }
