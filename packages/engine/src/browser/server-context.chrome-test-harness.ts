import { vi } from "vitest";
import { installChromeUserDataDirHooks } from "./chrome-user-data-dir.test-harness.js";

const chromeUserDataDir = { dir: "/tmp/octopus" };
installChromeUserDataDirHooks(chromeUserDataDir);

vi.mock("./chrome.js", () => ({
  isChromeCdpReady: vi.fn(async () => true),
  isChromeReachable: vi.fn(async () => true),
  launchOctopusChrome: vi.fn(async () => {
    throw new Error("unexpected launch");
  }),
  resolveOctopusUserDataDir: vi.fn(() => chromeUserDataDir.dir),
  stopOctopusChrome: vi.fn(async () => {}),
}));
