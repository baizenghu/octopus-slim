// Narrow plugin-sdk surface for the bundled phone-control plugin.
// Keep this list additive and scoped to symbols used under extensions/phone-control.

export type {
  OctopusPluginApi,
  OctopusPluginCommandDefinition,
  OctopusPluginService,
  PluginCommandContext,
} from "../plugins/types.js";
