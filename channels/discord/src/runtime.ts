import { createPluginRuntimeStore } from "octopus/plugin-sdk/compat";
import type { PluginRuntime } from "octopus/plugin-sdk/discord";

const { setRuntime: setDiscordRuntime, getRuntime: getDiscordRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Discord runtime not initialized");
export { getDiscordRuntime, setDiscordRuntime };
