import type { OctopusConfig } from "../../config/config.js";
import { resolveAgentSkillsFilter } from "../agent-scope.js";
import { loadWorkspaceSkillEntries, type SkillEntry, type SkillSnapshot } from "../skills.js";

export function resolveEmbeddedRunSkillEntries(params: {
  workspaceDir: string;
  config?: OctopusConfig;
  skillsSnapshot?: SkillSnapshot;
  agentId?: string;
}): {
  shouldLoadSkillEntries: boolean;
  skillEntries: SkillEntry[];
} {
  const shouldLoadSkillEntries = !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
  if (!shouldLoadSkillEntries) {
    return { shouldLoadSkillEntries: false, skillEntries: [] };
  }

  let entries = loadWorkspaceSkillEntries(params.workspaceDir, { config: params.config });

  // Apply per-agent skill whitelist from config (entry.skills).
  // Without this, agents with no skill permissions see all workspace skills.
  if (params.agentId && params.config) {
    const skillFilter = resolveAgentSkillsFilter(params.config, params.agentId);
    if (skillFilter !== undefined) {
      const allowed = new Set(skillFilter);
      entries = allowed.size > 0
        ? entries.filter((e) => allowed.has(e.skill.name))
        : [];
    }
  }

  return { shouldLoadSkillEntries: true, skillEntries: entries };
}
