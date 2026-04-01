/**
 * Tests for the 9-section structured compact prompt upgrade.
 * Validates that REQUIRED_SUMMARY_SECTIONS, buildCompactionStructureInstructions,
 * and auditSummaryQuality all work with the expanded section set.
 *
 * Note: engine tests run in the upstream engine's vitest context, not the
 * enterprise root config which excludes packages/engine/src/.
 */
import { describe, expect, it } from "vitest";
import { __testing } from "./compaction-safeguard.js";

const { buildCompactionStructureInstructions, auditSummaryQuality } = __testing;

describe("buildCompactionStructureInstructions (upgraded sections)", () => {
  it("includes all 9 required section headings", () => {
    const instructions = buildCompactionStructureInstructions(undefined, {
      identifierPolicy: "strict",
    });

    expect(instructions).toContain("## Primary Request and Intent");
    expect(instructions).toContain("## Decisions");
    expect(instructions).toContain("## Files and Code Sections");
    expect(instructions).toContain("## Open TODOs");
    expect(instructions).toContain("## Constraints/Rules");
    expect(instructions).toContain("## Pending user asks");
    expect(instructions).toContain("## Current Work");
    expect(instructions).toContain("## All user messages");
    expect(instructions).toContain("## Exact identifiers");
  });

  it("keeps the identifier policy instruction for strict mode", () => {
    const instructions = buildCompactionStructureInstructions(undefined, {
      identifierPolicy: "strict",
    });
    expect(instructions).toContain("preserve literal values exactly");
  });

  it("respects off identifier policy", () => {
    const instructions = buildCompactionStructureInstructions(undefined, {
      identifierPolicy: "off",
    });
    expect(instructions).not.toContain("preserve literal values exactly");
    expect(instructions).toContain("do not enforce literal-preservation");
  });
});

describe("auditSummaryQuality (upgraded sections)", () => {
  it("passes when all 9 sections are present", () => {
    const summary = [
      "## Primary Request and Intent",
      "User wants to build a chat app.",
      "## Decisions",
      "Using WebSocket.",
      "## Files and Code Sections",
      "- src/chat.ts: WebSocket handler",
      "## Open TODOs",
      "- Add auth",
      "## Constraints/Rules",
      "- Must use TypeScript",
      "## Pending user asks",
      "None.",
      "## Current Work",
      "Implementing message routing.",
      "## All user messages",
      '"Build a chat app"',
      '"Add WebSocket support"',
      "## Exact identifiers",
      "- ws://localhost:8080",
    ].join("\n");

    const result = auditSummaryQuality({
      summary,
      identifiers: [],
      latestAsk: "Add WebSocket support",
    });
    expect(result.ok).toBe(true);
  });

  it("fails when a required section is missing", () => {
    const summary = [
      "## Primary Request and Intent",
      "User wants X.",
      "## Decisions",
      "Decided Y.",
    ].join("\n");

    const result = auditSummaryQuality({
      summary,
      identifiers: [],
      latestAsk: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.some((r: string) => r.startsWith("missing_section:"))).toBe(true);
  });
});
