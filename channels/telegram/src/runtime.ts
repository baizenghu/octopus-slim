import { createPluginRuntimeStore } from "octopus/plugin-sdk/compat";
import type { PluginRuntime } from "octopus/plugin-sdk/telegram";

const { setRuntime: setTelegramRuntime, getRuntime: getTelegramRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Telegram runtime not initialized");
export { getTelegramRuntime, setTelegramRuntime };
