import { describe, expect, it } from "vitest";
import { findNearDuplicate, type GoldenExample } from "@/lib/loop/golden";
import { badExampleLine, type BadExample } from "@/lib/loop/bad";

function golden(dims: Partial<GoldenExample["dimensions"]>): GoldenExample {
  return {
    creative_id: "c-1",
    org_id: "99999999-9999-9999-9999-999999999992",
    script: "s",
    script_version: 1,
    why_it_won: "w",
    dimensions: {
      family: null,
      hook_line: "The winning hook",
      hook_angle: null,
      archetype: null,
      sport: null,
      format: null,
      ...dims,
    },
    source: "auto",
    status: "active",
    transcript: null,
    score: 1,
    cpt_cents: 2000,
    results: 40,
    target_cents: 3000,
    captured_at: "2026-07-01T00:00:00Z",
  };
}

describe("findNearDuplicate", () => {
  const examples = [golden({ family: "Parlay", hook_angle: "Stop guessing", format: "9:16" })];

  it("flags a same family+angle+format concept and names the golden hook", () => {
    expect(
      findNearDuplicate({ family: "Parlay", angle: "Stop guessing", format: "9:16" }, examples),
    ).toBe("The winning hook");
  });

  it("is tolerant to case and whitespace", () => {
    expect(
      findNearDuplicate({ family: "  parlay ", angle: "STOP GUESSING", format: "9:16" }, examples),
    ).toBe("The winning hook");
  });

  it("matches when either side omits format", () => {
    expect(findNearDuplicate({ family: "Parlay", angle: "Stop guessing" }, examples)).toBe(
      "The winning hook",
    );
    expect(
      findNearDuplicate(
        { family: "Parlay", angle: "Stop guessing", format: "16:9" },
        [golden({ family: "Parlay", hook_angle: "Stop guessing", format: null })],
      ),
    ).toBe("The winning hook");
  });

  it("does not match a different angle, family, or format", () => {
    expect(findNearDuplicate({ family: "Parlay", angle: "Other angle" }, examples)).toBeNull();
    expect(findNearDuplicate({ family: "Big Win", angle: "Stop guessing" }, examples)).toBeNull();
    expect(
      findNearDuplicate({ family: "Parlay", angle: "Stop guessing", format: "16:9" }, examples),
    ).toBeNull();
  });

  it("never matches on missing/empty concept family or angle", () => {
    expect(findNearDuplicate({ family: null, angle: "Stop guessing" }, examples)).toBeNull();
    expect(findNearDuplicate({ family: "Parlay", angle: "  " }, examples)).toBeNull();
    expect(
      findNearDuplicate({ family: "", angle: "" }, [golden({ family: "", hook_angle: "" })]),
    ).toBeNull();
  });
});

describe("badExampleLine", () => {
  const base = {
    id: "b-1",
    creative_id: "c-1",
    org_id: "99999999-9999-9999-9999-999999999992",
    script: "s",
    script_version: 1,
    dimensions: {
      family: "Parlay",
      hook_line: "The losing hook",
      hook_angle: "Angle",
      archetype: "Qualifier",
      sport: "NFL",
      format: "9:16",
    },
    captured_at: "2026-07-01T00:00:00Z",
  };

  it("renders a proven loser with its performance snapshot and reason", () => {
    const line = badExampleLine({
      ...base,
      kind: "proven_loser",
      reason: "CPT 3x target",
      cpt_cents: 9000,
      target_cents: 3000,
      results: 40,
    } as BadExample);
    expect(line).toContain('"The losing hook"');
    expect(line).toContain("CPT $90.00 vs target $30.00");
    expect(line).toContain("40 trials");
    expect(line).toContain("CPT 3x target");
  });

  it("renders a rejection with its compliance reason", () => {
    const line = badExampleLine({
      ...base,
      kind: "review_rejection",
      reason: "Compliance: names a competitor app",
      cpt_cents: null,
      target_cents: null,
      results: null,
    } as BadExample);
    expect(line).toContain("rejected: Compliance: names a competitor app");
    expect(line).not.toContain("CPT");
  });

  it("renders a manual kill with the paid team's reason", () => {
    const line = badExampleLine({
      ...base,
      kind: "manual_kill",
      reason: "Killed by the paid team: CPA $25.00 vs $10.00 target over 8 conversions",
      cpt_cents: 2500,
      target_cents: 1000,
      results: 8,
    } as BadExample);
    expect(line).toContain('"The losing hook"');
    expect(line).toContain("Killed by the paid team");
    expect(line).not.toContain("rejected:");
  });
});
