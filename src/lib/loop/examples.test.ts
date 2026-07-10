import { describe, expect, it } from "vitest";
import {
  findNearDuplicate,
  findDuplicateHook,
  findDuplicateScript,
  hookSimilarity,
  nearDuplicateThreshold,
  type GoldenExample,
} from "@/lib/loop/golden";
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


// The goal's acceptance check, as a unit test: seed one golden hook, then a
// deliberate near-copy (must be caught) and a same-family-different-hook variant
// (must pass). findDuplicateHook is the enforcement gate the concept-persist
// boundary (/api/concepts) uses.
describe("findDuplicateHook (enforcement gate)", () => {
  const goldenSet = [
    golden({ family: "Parlay", hook_angle: "Stop guessing", hook_line: "Stop guessing your parlays — see the injury data first" }),
  ];

  it("catches a deliberate near-copy of a golden hook", () => {
    const nearCopy = "Stop guessing on your parlays — see the injury data";
    expect(findDuplicateHook(nearCopy, goldenSet)).not.toBeNull();
  });

  it("admits a same-family variant with a genuinely different hook", () => {
    const variant = "The one injury note your sportsbook quietly hides from you";
    expect(findDuplicateHook(variant, goldenSet)).toBeNull();
  });

  it("returns null for an empty hook or empty golden set", () => {
    expect(findDuplicateHook("", goldenSet)).toBeNull();
    expect(findDuplicateHook("anything at all here", [])).toBeNull();
  });

  it("respects the threshold argument", () => {
    // A loosely-related hook sits between: caught at a low threshold, admitted at the default.
    const loose = "Stop losing your parlays to bad data";
    expect(findDuplicateHook(loose, goldenSet, 0.35)).not.toBeNull();
    expect(findDuplicateHook(loose, goldenSet, nearDuplicateThreshold())).toBeNull();
  });
});

describe("hookSimilarity", () => {
  it("scores a near-copy high and an unrelated hook low", () => {
    const a = "Stop guessing your parlays — see the injury data first";
    expect(hookSimilarity(a, "Stop guessing on your parlays, see the injury data")).toBeGreaterThan(0.8);
    expect(hookSimilarity(a, "Meet the creators behind the community")).toBeLessThan(0.2);
  });
  it("ignores case, punctuation, and function words", () => {
    expect(hookSimilarity("See the DATA!!!", "see data")).toBe(1);
  });
});


describe("findDuplicateScript (output gate before persist)", () => {
  const goldenScript =
    "The concept: teach one research move before a parlay — pull the injury report and cut any leg with a questionable tag. Tone: confident, data-first. Two rules: never call it a lock; close with See the data first.";
  const goldenSet = [{ ...golden({ family: "Parlay", hook_line: "See the data first" }), script: goldenScript }];

  it("catches a generated body that restates a golden script nearly verbatim", () => {
    const nearCopy =
      "The concept: teach one research move before a parlay — pull the injury report and cut a leg with a questionable tag. Tone: confident and data-first. Two rules: never call it a lock, and close with See the data first.";
    expect(findDuplicateScript(nearCopy, goldenSet)).not.toBeNull();
  });

  it("admits a distinct brief that uses the pattern in its own words", () => {
    const distinct =
      "The concept: show how a bettor rebuilds one slip after spotting a coach's press-conference hint about resting a starter. Tone: like a sharp friend, not a guru. Two rules: keep it about smarter homework; sign off with Do the homework.";
    expect(findDuplicateScript(distinct, goldenSet)).toBeNull();
  });
});
