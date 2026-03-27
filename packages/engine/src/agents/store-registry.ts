import type { AgentStore } from "./store.js";
import { FileAgentStore } from "./store-file.js";

// ---------------------------------------------------------------------------
// AgentStore Registry (module-level singleton via Symbol.for)
// ---------------------------------------------------------------------------
// Mirrors the context-engine registry pattern: a process-global symbol key
// ensures duplicated dist chunks still share one registry at runtime.

const AGENT_STORE_REGISTRY_STATE = Symbol.for("octopus.agentStoreRegistryState");

type AgentStoreRegistryState = {
  stores: Map<string, AgentStore>;
  /** The currently active store id (set by registerAgentStore). */
  activeId: string | null;
};

function getAgentStoreRegistryState(): AgentStoreRegistryState {
  const globalState = globalThis as typeof globalThis & {
    [AGENT_STORE_REGISTRY_STATE]?: AgentStoreRegistryState;
  };
  if (!globalState[AGENT_STORE_REGISTRY_STATE]) {
    globalState[AGENT_STORE_REGISTRY_STATE] = {
      stores: new Map<string, AgentStore>(),
      activeId: null,
    };
  }
  return globalState[AGENT_STORE_REGISTRY_STATE];
}

/**
 * Register an AgentStore implementation under the given id.
 * The last registered store becomes the active one.
 */
export function registerAgentStore(id: string, store: AgentStore): void {
  const state = getAgentStoreRegistryState();
  state.stores.set(id, store);
  state.activeId = id;
}

/**
 * Return the registered store for the given id, or undefined.
 */
export function getAgentStore(id: string): AgentStore | undefined {
  return getAgentStoreRegistryState().stores.get(id);
}

/**
 * List all registered store ids.
 */
export function listAgentStoreIds(): string[] {
  return [...getAgentStoreRegistryState().stores.keys()];
}

// Lazy-initialized default file store (created on first resolveAgentStore call
// when no plugin has registered a custom store).
let defaultFileStore: FileAgentStore | null = null;

/**
 * Resolve the active AgentStore.
 *
 * Resolution order:
 *   1. Explicitly registered store (via registerAgentStore — e.g. DB-backed)
 *   2. Default FileAgentStore (reads/writes octopus.json)
 */
export function resolveAgentStore(): AgentStore {
  const state = getAgentStoreRegistryState();
  if (state.activeId) {
    const store = state.stores.get(state.activeId);
    if (store) {
      return store;
    }
  }
  // Fallback: default file-backed store
  if (!defaultFileStore) {
    defaultFileStore = new FileAgentStore();
  }
  return defaultFileStore;
}
