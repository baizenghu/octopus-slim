import { loadConfig, writeConfigFile } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { AgentStore, AgentStoreEntry } from "./store.js";

// ---------------------------------------------------------------------------
// FileAgentStore — default file-backed AgentStore implementation
// ---------------------------------------------------------------------------
// Reads from / writes to octopus.json agents.list via the existing config I/O
// layer.  This preserves full backward compatibility with the native engine
// config flow (caching, json5 fallback, runtime snapshots, etc.).

export class FileAgentStore implements AgentStore {
  async list(_filter?: { tenantId?: string }): Promise<AgentStoreEntry[]> {
    const cfg = loadConfig();
    const list = cfg.agents?.list;
    if (!Array.isArray(list)) {
      return [];
    }
    return list.filter(
      (entry): entry is AgentStoreEntry => Boolean(entry && typeof entry === "object"),
    );
  }

  async get(agentId: string): Promise<AgentStoreEntry | null> {
    const id = normalizeAgentId(agentId);
    const all = await this.list();
    return all.find((a) => normalizeAgentId(a.id) === id) ?? null;
  }

  async create(entry: AgentStoreEntry): Promise<void> {
    const cfg = loadConfig();
    const list = Array.isArray(cfg.agents?.list) ? [...cfg.agents!.list!] : [];
    const id = normalizeAgentId(entry.id);

    // Prevent duplicates
    if (list.some((a) => normalizeAgentId(a.id) === id)) {
      throw new Error(`agent "${entry.id}" already exists`);
    }

    list.push(entry);
    await writeConfigFile({
      ...cfg,
      agents: { ...cfg.agents, list },
    });
  }

  async update(agentId: string, patch: Partial<AgentStoreEntry>): Promise<void> {
    const cfg = loadConfig();
    const list = Array.isArray(cfg.agents?.list) ? [...cfg.agents!.list!] : [];
    const id = normalizeAgentId(agentId);
    const index = list.findIndex((a) => normalizeAgentId(a.id) === id);
    if (index < 0) {
      throw new Error(`agent "${agentId}" not found`);
    }

    // Shallow merge — intentionally does NOT deep-merge nested objects like
    // tools/subagents; callers must send the complete sub-object when updating
    // nested fields (consistent with configApply array-replace semantics).
    list[index] = { ...list[index], ...patch, id: list[index].id };
    await writeConfigFile({
      ...cfg,
      agents: { ...cfg.agents, list },
    });
  }

  async delete(agentId: string): Promise<void> {
    const cfg = loadConfig();
    const list = Array.isArray(cfg.agents?.list) ? [...cfg.agents!.list!] : [];
    const id = normalizeAgentId(agentId);
    const filtered = list.filter((a) => normalizeAgentId(a.id) !== id);

    if (filtered.length === list.length) {
      throw new Error(`agent "${agentId}" not found`);
    }

    await writeConfigFile({
      ...cfg,
      agents: { ...cfg.agents, list: filtered.length > 0 ? filtered : undefined },
    });
  }
}
