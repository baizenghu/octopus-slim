import path from "node:path";
import { expect } from "vitest";

export const IS_WINDOWS = process.platform === "win32";

export function resolveConfigPathFromTempState(fileName = "octopus.json"): string {
  const stateDir = process.env.OCTOPUS_STATE_DIR?.trim();
  if (!stateDir) {
    throw new Error("Expected OCTOPUS_STATE_DIR to be set by withTempHome");
  }
  return path.join(stateDir, fileName);
}

export function expectPosixMode(statMode: number, expectedMode: number): void {
  if (IS_WINDOWS) {
    return;
  }
  expect(statMode & 0o777).toBe(expectedMode);
}
