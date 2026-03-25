import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks for the functions we want to verify
const mocks = vi.hoisted(() => ({
  loadNodes: vi.fn(),
  loadLogs: vi.fn(),
  loadDebug: vi.fn(),
  startNodesPolling: vi.fn(),
  stopNodesPolling: vi.fn(),
  startLogsPolling: vi.fn(),
  stopLogsPolling: vi.fn(),
  startDebugPolling: vi.fn(),
  stopDebugPolling: vi.fn(),
}));

// Mock modules before any imports
vi.mock("./controllers/nodes.ts", () => ({ loadNodes: mocks.loadNodes }));
vi.mock("./controllers/logs.ts", () => ({ loadLogs: mocks.loadLogs, parseLogLine: vi.fn() }));
vi.mock("./controllers/debug.ts", () => ({
  loadDebug: mocks.loadDebug,
  callDebugMethod: vi.fn(),
}));
vi.mock("./app-polling.ts", () => ({
  startNodesPolling: mocks.startNodesPolling,
  stopNodesPolling: mocks.stopNodesPolling,
  startLogsPolling: mocks.startLogsPolling,
  stopLogsPolling: mocks.stopLogsPolling,
  startDebugPolling: mocks.startDebugPolling,
  stopDebugPolling: mocks.stopDebugPolling,
}));

// Supporting mocks required by app-gateway.ts transitive imports
vi.mock("./controllers/chat.ts", () => ({
  handleChatEvent: vi.fn(() => "idle"),
  loadChatHistory: vi.fn(),
}));
vi.mock("./app-tool-stream.ts", () => ({
  handleAgentEvent: vi.fn(),
  resetToolStream: vi.fn(),
}));
vi.mock("./app-settings.ts", () => ({
  applySettings: vi.fn(),
  setLastActiveSessionKey: vi.fn(),
  loadCron: vi.fn(),
  refreshActiveTab: vi.fn(),
  applySettingsFromUrl: vi.fn(),
  attachThemeListener: vi.fn(),
  detachThemeListener: vi.fn(),
  inferBasePath: vi.fn(() => "/"),
  syncTabWithLocation: vi.fn(),
  syncThemeWithSettings: vi.fn(),
}));
vi.mock("./controllers/devices.ts", () => ({ loadDevices: vi.fn() }));
vi.mock("./controllers/exec-approval.ts", () => ({
  addExecApproval: vi.fn(() => []),
  parseExecApprovalRequested: vi.fn(() => null),
  parseExecApprovalResolved: vi.fn(() => null),
  removeExecApproval: vi.fn(() => []),
}));
vi.mock("./controllers/sessions.ts", () => ({ loadSessions: vi.fn() }));
vi.mock("./chat-event-reload.ts", () => ({
  shouldReloadHistoryForFinalEvent: vi.fn(() => false),
}));
vi.mock("./controllers/agents.ts", () => ({
  loadAgents: vi.fn(),
  loadToolsCatalog: vi.fn(),
}));
vi.mock("./controllers/assistant-identity.ts", () => ({
  loadAssistantIdentity: vi.fn(),
}));
vi.mock("./app-chat.ts", () => ({
  flushChatQueueForEvent: vi.fn(),
  CHAT_SESSIONS_ACTIVE_MINUTES: 30,
}));

// GatewayBrowserClient mock that captures callbacks for onHello / onClose
type MockClientOpts = {
  onHello?: (hello: unknown) => void;
  onClose?: (info: { code: number; reason: string; error?: unknown }) => void;
  onEvent?: (evt: { event: string; payload?: unknown }) => void;
  onGap?: (info: { expected: number; received: number }) => void;
};

type MockClientInstance = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emitHello: () => void;
  emitClose: (info: { code: number; reason?: string; error?: unknown }) => void;
  emitEvent: (evt: { event: string; payload?: unknown }) => void;
};

const gatewayInstances: MockClientInstance[] = [];

vi.mock("./gateway.ts", () => {
  function resolveGatewayErrorDetailCode(_err: unknown): string | null {
    return null;
  }

  class GatewayBrowserClient {
    readonly start = vi.fn();
    readonly stop = vi.fn();

    constructor(private opts: MockClientOpts) {
      gatewayInstances.push({
        start: this.start,
        stop: this.stop,
        emitHello: () => this.opts.onHello?.({}),
        emitClose: (info) =>
          this.opts.onClose?.({ code: info.code, reason: info.reason ?? "", error: info.error }),
        emitEvent: (evt) => this.opts.onEvent?.(evt),
      });
    }
  }

  return { GatewayBrowserClient, resolveGatewayErrorDetailCode };
});

vi.mock("../../../src/gateway/events.js", () => ({
  GATEWAY_EVENT_UPDATE_AVAILABLE: "update.available",
}));

vi.mock("../../../src/gateway/protocol/connect-error-details.js", () => ({
  ConnectErrorDetailCodes: {
    AUTH_TOKEN_MISMATCH: "AUTH_TOKEN_MISMATCH",
    AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED",
    AUTH_UNAUTHORIZED: "AUTH_UNAUTHORIZED",
  },
}));

import { connectGateway, handleGatewayEvent } from "./app-gateway.ts";

function createHost(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:19791",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
    },
    password: "",
    clientInstanceId: "test-instance",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    lastErrorCode: null,
    eventLogBuffer: [] as unknown[],
    eventLog: [] as unknown[],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    toolsCatalogLoading: false,
    toolsCatalogError: null,
    toolsCatalogResult: null,
    debugHealth: null,
    assistantName: "Octopus",
    assistantAvatar: null,
    assistantAgentId: null,
    serverVersion: null,
    sessionKey: "main",
    chatRunId: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
    updateAvailable: null,
    // fields used by app-tool-stream (resetToolStream)
    toolStreamOrder: [] as unknown[],
    // polling interval fields (used by startXxxPolling / stopXxxPolling)
    nodesPollInterval: null as number | null,
    logsPollInterval: null as number | null,
    debugPollInterval: null as number | null,
    ...overrides,
  };
}

// --------------------------------------------------------------------------
// Tests: handleGatewayEvent — WS-event-driven data refresh
// --------------------------------------------------------------------------
describe("handleGatewayEvent - WS-event-driven data refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls loadNodes when nodes.update event arrives", () => {
    const host = createHost();
    handleGatewayEvent(host as never, { event: "nodes.update", payload: {} });
    expect(mocks.loadNodes).toHaveBeenCalledOnce();
    expect(mocks.loadNodes).toHaveBeenCalledWith(host, { quiet: true });
  });

  it("calls loadLogs on tick event when tab is logs", () => {
    const host = createHost({ tab: "logs" });
    handleGatewayEvent(host as never, { event: "tick", payload: { ts: Date.now() } });
    expect(mocks.loadLogs).toHaveBeenCalledOnce();
    expect(mocks.loadLogs).toHaveBeenCalledWith(host, { quiet: true });
  });

  it("does not call loadLogs on tick event when tab is not logs", () => {
    const host = createHost({ tab: "overview" });
    handleGatewayEvent(host as never, { event: "tick", payload: { ts: Date.now() } });
    expect(mocks.loadLogs).not.toHaveBeenCalled();
  });

  it("calls loadDebug on health event when tab is debug", () => {
    const host = createHost({ tab: "debug" });
    handleGatewayEvent(host as never, { event: "health", payload: {} });
    expect(mocks.loadDebug).toHaveBeenCalledOnce();
    expect(mocks.loadDebug).toHaveBeenCalledWith(host);
  });

  it("does not call loadDebug on health event when tab is not debug", () => {
    const host = createHost({ tab: "overview" });
    handleGatewayEvent(host as never, { event: "health", payload: {} });
    expect(mocks.loadDebug).not.toHaveBeenCalled();
  });
});

// --------------------------------------------------------------------------
// Tests: connectGateway — stop polling on WS connect, restart on disconnect
// --------------------------------------------------------------------------
describe("connectGateway - polling lifecycle with WS connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayInstances.length = 0;
  });

  it("stops all polling when WS connection succeeds (onHello)", () => {
    const host = createHost({ nodesPollInterval: 1, logsPollInterval: 2, debugPollInterval: 3 });
    connectGateway(host as never);
    const client = gatewayInstances[0];
    expect(client).toBeDefined();

    client.emitHello();

    expect(mocks.stopNodesPolling).toHaveBeenCalledOnce();
    expect(mocks.stopLogsPolling).toHaveBeenCalledOnce();
    expect(mocks.stopDebugPolling).toHaveBeenCalledOnce();
  });

  it("restarts nodes polling when WS disconnects (onClose)", () => {
    const host = createHost({ tab: "overview" });
    connectGateway(host as never);
    const client = gatewayInstances[0];

    client.emitClose({ code: 1006 });

    expect(mocks.startNodesPolling).toHaveBeenCalledOnce();
  });

  it("restarts logs polling on disconnect when tab is logs", () => {
    const host = createHost({ tab: "logs" });
    connectGateway(host as never);
    const client = gatewayInstances[0];

    client.emitClose({ code: 1006 });

    expect(mocks.startNodesPolling).toHaveBeenCalledOnce();
    expect(mocks.startLogsPolling).toHaveBeenCalledOnce();
  });

  it("does not restart logs polling on disconnect when tab is not logs", () => {
    const host = createHost({ tab: "overview" });
    connectGateway(host as never);
    const client = gatewayInstances[0];

    client.emitClose({ code: 1006 });

    expect(mocks.startLogsPolling).not.toHaveBeenCalled();
  });

  it("restarts debug polling on disconnect when tab is debug", () => {
    const host = createHost({ tab: "debug" });
    connectGateway(host as never);
    const client = gatewayInstances[0];

    client.emitClose({ code: 1006 });

    expect(mocks.startDebugPolling).toHaveBeenCalledOnce();
  });

  it("does not restart debug polling on disconnect when tab is not debug", () => {
    const host = createHost({ tab: "overview" });
    connectGateway(host as never);
    const client = gatewayInstances[0];

    client.emitClose({ code: 1006 });

    expect(mocks.startDebugPolling).not.toHaveBeenCalled();
  });

  it("does not restart polling for stale client after reconnect", () => {
    const host = createHost({ tab: "overview" });
    connectGateway(host as never);
    const firstClient = gatewayInstances[0];

    // Reconnect
    connectGateway(host as never);

    // Stale client closes — should not trigger polling restart
    firstClient.emitClose({ code: 1006 });
    expect(mocks.startNodesPolling).not.toHaveBeenCalled();
  });
});
