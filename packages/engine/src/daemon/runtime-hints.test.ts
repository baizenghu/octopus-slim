import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          OCTOPUS_STATE_DIR: "/tmp/octopus-state",
          OCTOPUS_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "octopus-gateway",
        windowsTaskName: "Octopus Gateway",
      }),
    ).toEqual([
      "Launchd stdout (if installed): /tmp/octopus-state/logs/gateway.log",
      "Launchd stderr (if installed): /tmp/octopus-state/logs/gateway.err.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        systemdServiceName: "octopus-gateway",
        windowsTaskName: "Octopus Gateway",
      }),
    ).toEqual(["Logs: journalctl --user -u octopus-gateway.service -n 200 --no-pager"]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        systemdServiceName: "octopus-gateway",
        windowsTaskName: "Octopus Gateway",
      }),
    ).toEqual(['Logs: schtasks /Query /TN "Octopus Gateway" /V /FO LIST']);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installCommand: "octopus gateway install",
        startCommand: "octopus gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.octopus.gateway.plist",
        systemdServiceName: "octopus-gateway",
        windowsTaskName: "Octopus Gateway",
      }),
    ).toEqual([
      "octopus gateway install",
      "octopus gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.octopus.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installCommand: "octopus gateway install",
        startCommand: "octopus gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.octopus.gateway.plist",
        systemdServiceName: "octopus-gateway",
        windowsTaskName: "Octopus Gateway",
      }),
    ).toEqual([
      "octopus gateway install",
      "octopus gateway",
      "systemctl --user start octopus-gateway.service",
    ]);
  });
});
