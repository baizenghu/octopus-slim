import { createPluginRuntimeStore } from "octopus/plugin-sdk/compat";
import type { PluginRuntime } from "octopus/plugin-sdk/feishu";

const { setRuntime: setFeishuRuntime, getRuntime: getFeishuRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Feishu runtime not initialized");
export { getFeishuRuntime, setFeishuRuntime };
