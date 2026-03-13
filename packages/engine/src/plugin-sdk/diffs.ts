// Narrow plugin-sdk surface for the bundled diffs plugin.
// Keep this list additive and scoped to symbols used under extensions/diffs.

export type { OctopusConfig } from "../config/config.js";
export { resolvePreferredOctopusTmpDir } from "../infra/tmp-octopus-dir.js";
export type {
  AnyAgentTool,
  OctopusPluginApi,
  OctopusPluginConfigSchema,
  PluginLogger,
} from "../plugins/types.js";
