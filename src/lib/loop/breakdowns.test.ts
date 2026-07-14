import { describe, expect, it } from "vitest";
import {
  breakdownInputHash,
  breakdownLine,
  breakdownsPromptBlock,
  EMPTY_BREAKDOWNS_NOTE,
  parseBreakdown,
  planBreakdownRefresh,
  type Breakdown,
  type BreakdownDimensions,
  type BreakdownTarget,
  type ExistingBreakdownRow,
  type WinnerBreakdown,
} from "@/lib/loop/breakdowns";
import { buildBreakdownPrompt } from "@/lib/loop/breakdowns-refresh";

const dims: BreakdownDimensions = {
  family: "Data Edge",
  hook_line: "The data said bet the underdog",
  hook_angle: "Foresight",
  archetype: "Qualifier",
  sport: "WNBA",
  format: "Video",
};

const validBreakdown: Breakdown = {
  hook: {
    device: "contrarian data reveal",
    first_three_seconds: "Two players, same matchup — the data said bet the underdog.",
    why_it_works: "flips the expected pick, creating an open loop",
  },
  beats: [
    { beat: "show both players' surface stats", purpose: "establish the obvious pick" },
    { beat: "reveal the one hidden number", purpose: "payoff the open loop with proof" },
  ],
  proof_device: "side-by-side Outlier data screens",
  cta: { text: "Stop guessing. Get Outlier.", placement: "final 2s", style: "spoken + on-screen" },
  delivery: {
    pacing: "fast cuts every 2s",
    format_rationale: "screen-record keeps focus on the data",
    talent_rationale: "faceless — the numbers are the star",
    theme: "Information",
  },
  replicable_pattern: "Pick a matchup with a counterintuitive data edge; tease the wrong pick, reveal the number that flips it, close on the tool.",
  vary_next: ["try NBA instead of WNBA", "face-on-camera variant"],
};

function target(overrides: Partial<BreakdownTarget> = {}): BreakdownTarget {
  const script = overrides.script ?? "full script text";
  const transcript = "transcript" in overrides ? (overrides.transcript ?? null) : "what the cut said";
  const d = overrides.dims ?? dims;
  return {
    creative_id: "cr1",
    org_id: "org1",
    source: "performance",
    script,
    script_version: overrides.script_version ?? 3,
    transcript,
    dims: d,
    family: null,
    why_it_won: "Hit: CPT $8.00 <= $30.00 over 50 trials",
    cpt_cents: 800,
    results: 50,
    target_cents: 3000,
    ...overrides,
    input_hash:
      overrides.input_hash ??
      breakdownInputHash(script, overrides.script_version ?? 3, transcript, d),
  };
}

function existing(t: BreakdownTarget, overrides: Partial<ExistingBreakdownRow> = {}): ExistingBreakdownRow {
  return {
    creative_id: t.creative_id,
    input_hash: t.input_hash,
    status: "active",
    source: t.source,
    why_it_won: t.why_it_won,
    cpt_cents: t.cpt_cents,
    results: t.results,
    target_cents: t.target_cents,
    ...overrides,
  };
}

describe("breakdownInputHash — stable staleness key", () => {
  it("is deterministic and independent of dims key order", () => {
    const a = breakdownInputHash("s", 1, "t", dims);
    const reordered = Object.fromEntries(Object.entries(dims).reverse()) as BreakdownDimensions;
    expect(breakdownInputHash("s", 1, "t", reordered)).toBe(a);
  });

  it("changes when script, version, transcript, or a dimension changes", () => {
    const base = breakdownInputHash("s", 1, "t", dims);
    expect(breakdownInputHash("s2", 1, "t", dims)).not.toBe(base);
    expect(breakdownInputHash("s", 2, "t", dims)).not.toBe(base);
    expect(breakdownInputHash("s", 1, "t2", dims)).not.toBe(base);
    expect(breakdownInputHash("s", 1, "t", { ...dims, sport: "NBA" })).not.toBe(base);
  });

  it("normalizes null to empty (no-content is no-content) and stays stable", () => {
    expect(breakdownInputHash(null, null, null, dims)).toBe(breakdownInputHash(null, null, null, dims));
    expect(breakdownInputHash(null, 1, "t", dims)).toBe(breakdownInputHash("", 1, "t", dims));
  });
});

describe("planBreakdownRefresh — the pure diff", () => {
  it("generates for a new target and deactivates a vanished one", () => {
    const t = target();
    const gone = existing(target({ creative_id: "cr-gone" }));
    const plan = planBreakdownRefresh([t], [gone], 5);
    expect(plan.generate.map((x) => x.creative_id)).toEqual(["cr1"]);
    expect(plan.deactivate).toEqual(["cr-gone"]);
    expect(plan.reactivate).toEqual([]);
    expect(plan.retag).toEqual([]);
  });

  it("regenerates on hash mismatch (inputs changed)", () => {
    const t = target();
    const stale = existing(t, { input_hash: "old-hash" });
    const plan = planBreakdownRefresh([t], [stale], 5);
    expect(plan.generate).toHaveLength(1);
  });

  it("reactivates an inactive hash-match without a model call", () => {
    const t = target();
    const inactive = existing(t, { status: "inactive" });
    const plan = planBreakdownRefresh([t], [inactive], 5);
    expect(plan.generate).toEqual([]);
    expect(plan.reactivate.map((x) => x.creative_id)).toEqual(["cr1"]);
  });

  it("retags (metadata-only) when hash matches but source or metrics moved", () => {
    const t = target();
    const wasEditorial = existing(t, { source: "editorial", why_it_won: null, cpt_cents: null, results: null, target_cents: null });
    const plan = planBreakdownRefresh([t], [wasEditorial], 5);
    expect(plan.generate).toEqual([]);
    expect(plan.retag.map((x) => x.creative_id)).toEqual(["cr1"]);
  });

  it("does nothing for an unchanged active row, and leaves inactive non-targets alone", () => {
    const t = target();
    const idle = existing(target({ creative_id: "cr-idle" }), { status: "inactive" });
    const plan = planBreakdownRefresh([t], [existing(t), idle], 5);
    expect(plan.generate).toEqual([]);
    expect(plan.retag).toEqual([]);
    expect(plan.reactivate).toEqual([]);
    expect(plan.deactivate).toEqual([]); // inactive rows never re-deactivate
  });

  it("caps generation and counts the overflow (next run picks it up)", () => {
    const many = ["a", "b", "c", "d"].map((id) => target({ creative_id: id }));
    const plan = planBreakdownRefresh(many, [], 2);
    expect(plan.generate).toHaveLength(2);
    expect(plan.skippedCap).toBe(2);
  });
});

describe("parseBreakdown — structural validation", () => {
  it("accepts a fully-formed teardown", () => {
    expect(parseBreakdown(validBreakdown)).toEqual(validBreakdown);
  });

  it("rejects missing sections, empty beats, and empty vary_next", () => {
    expect(parseBreakdown(null)).toBeNull();
    expect(parseBreakdown({})).toBeNull();
    expect(parseBreakdown({ ...validBreakdown, hook: { device: "x" } })).toBeNull();
    expect(parseBreakdown({ ...validBreakdown, beats: [] })).toBeNull();
    expect(parseBreakdown({ ...validBreakdown, beats: [{ beat: "x" }] })).toBeNull();
    expect(parseBreakdown({ ...validBreakdown, vary_next: [] })).toBeNull();
    expect(parseBreakdown({ ...validBreakdown, replicable_pattern: "  " })).toBeNull();
  });
});

describe("breakdownsPromptBlock — what downstream agents see", () => {
  const row = (source: "performance" | "editorial"): WinnerBreakdown => ({
    creative_id: "cr1",
    org_id: "org1",
    source,
    status: "active",
    breakdown: validBreakdown,
    dimensions: dims,
    input_hash: "h",
    script_version: 3,
    why_it_won: source === "performance" ? "Hit" : null,
    cpt_cents: source === "performance" ? 800 : null,
    results: source === "performance" ? 50 : null,
    target_cents: source === "performance" ? 3000 : null,
    generated_at: "2026-07-14T00:00:00Z",
  });

  it("cites [golden:<id>] with the CPT evidence for performance winners", () => {
    const line = breakdownLine(row("performance"));
    expect(line).toContain("[golden:cr1]");
    expect(line).toContain("CPT $8.00 vs $30.00 target (50 trials)");
    expect(line).toContain("Replicable pattern:");
    expect(line).toContain("Vary next:");
  });

  it("cites [winner:<id>] with the editorial disclaimer for staff picks", () => {
    const line = breakdownLine(row("editorial"));
    expect(line).toContain("[winner:cr1]");
    expect(line).toContain("EDITORIAL pick by staff");
    expect(line).not.toContain("CPT $");
  });

  it("renders the empty note and surfaces read errors", () => {
    expect(breakdownsPromptBlock({ breakdowns: [], error: null })).toBe(EMPTY_BREAKDOWNS_NOTE);
    expect(breakdownsPromptBlock({ breakdowns: [], error: "boom" })).toContain("unavailable: boom");
    expect(breakdownsPromptBlock({ breakdowns: [row("performance")], error: null })).toContain("WINNER BREAKDOWNS");
  });
});

describe("buildBreakdownPrompt — the analyst's inputs (seam test)", () => {
  it("includes the full script + transcript and the performance evidence", () => {
    const { system, userContent } = buildBreakdownPrompt(target(), "Outlier, a sports-data app");
    expect(system).toContain("Outlier, a sports-data app");
    expect(userContent).toContain("SCRIPT (full):\nfull script text");
    expect(userContent).toContain("WINNING DELIVERY");
    expect(userContent).toContain("CPT $8.00 vs $30.00 target, 50 trials");
    expect(userContent).toContain(`family ${dims.family}`);
  });

  it("marks editorial targets and tolerates missing script/transcript", () => {
    const t = target({ source: "editorial", why_it_won: null, cpt_cents: null, results: null, target_cents: null, script: null, script_version: null });
    const { userContent } = buildBreakdownPrompt(t, "Outlier");
    expect(userContent).toContain("Editorial pick by staff");
    expect(userContent).toContain("(no written script on file)");
  });

  it("caps oversized inputs at the configured char cap", () => {
    const long = "x".repeat(20000);
    const { userContent } = buildBreakdownPrompt(target({ script: long }), "Outlier");
    // default BREAKDOWN_INPUT_CHAR_CAP = 8000
    const scriptSection = userContent.split("SCRIPT (full):\n")[1].split("\n\n")[0];
    expect(scriptSection.length).toBeLessThanOrEqual(8000);
  });
});
