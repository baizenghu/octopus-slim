import type { AgentConfig } from "../config/types.agents.js";

// ---------------------------------------------------------------------------
// AgentStore — pluggable agent configuration storage
// ---------------------------------------------------------------------------
// Default implementation reads/writes octopus.json agents.list.
// Enterprise layer can register a DB-backed store via registerAgentStore().

/**
 * Minimal entry returned by the store.
 * Intentionally a superset of AgentConfig so the file-backed store can return
 * raw config entries unchanged while a DB-backed store may add extra fields.
 */
export type AgentStoreEntry = AgentConfig & {
  [key: string]: unknown;
};

export interface AgentStore {
  /** List all agent entries, optionally filtered by tenant. */
  list(filter?: { tenantId?: string }): Promise<AgentStoreEntry[]>;

  /** Get a single agent by id. */
  get(agentId: string): Promise<AgentStoreEntry | null>;

  /** Create a new agent entry. */
  create(entry: AgentStoreEntry): Promise<void>;

  /** Partially update an existing agent entry. */
  update(agentId: string, patch: Partial<AgentStoreEntry>): Promise<void>;

  /** Delete an agent entry. */
  delete(agentId: string): Promise<void>;

  /** Subscribe to agent changes (optional). */
  onChanged?(callback: (agentId: string) => void): void;
}
