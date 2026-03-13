import { createPluginRuntimeStore } from "octopus/plugin-sdk/compat";
import type { PluginRuntime } from "octopus/plugin-sdk/slack";

const { setRuntime: setSlackRuntime, getRuntime: getSlackRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Slack runtime not initialized");
export { getSlackRuntime, setSlackRuntime };
