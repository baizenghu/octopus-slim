import { afterEach, beforeEach } from "vitest";
import "../app.ts";
import type { OctopusApp } from "../app.ts";

export function mountApp(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const app = document.createElement("octopus-app") as OctopusApp;
  app.connect = () => {
    // no-op: avoid real gateway WS connections in browser tests
  };
  document.body.append(app);
  return app;
}

export function registerAppMountHooks() {
  beforeEach(() => {
    window.__OCTOPUS_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });

  afterEach(() => {
    window.__OCTOPUS_CONTROL_UI_BASE_PATH__ = undefined;
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
  });
}
