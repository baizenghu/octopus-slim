import type { OctopusConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: OctopusConfig, pluginId: string): OctopusConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
