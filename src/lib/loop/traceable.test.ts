import { describe, expect, it } from "vitest";
import { traceableRecs } from "@/lib/loop/generate";
import { normalizeRecs, learningsPromptBlock, type Learning } from "@/lib/loop/learnings";
import type { RecSource } from "@/lib/loop/scoreboard";

const src = (id: string, metric: string): RecSource => ({ id, label: id, metric, prompt: `[${id}]` });

describe("traceableRecs — the cold-reader gate", () => {
  // Candidate IDs are the SELF-DESCRIBING refs the prompt asks the model to
  // cite (`golden:<creative_id>`), not bare ids — the validation key, the
  // citation convention, and the stored source must all agree.
  const golden: RecSource[] = [
    src("golden:cr_win_1", "CPT $18.00 vs $30.00 target, 42 trials"),
    src("golden:cr_win_2", "CPT $22.00 vs $30.00 target, 31 trials"),
  ];

  it("keeps a rec that cites a real candidate ref and stamps its metric", () => {
    const { recs, dropped } = traceableRecs(
      [{ directive: "Variant the contrarian-hook winner", sources: ["golden:cr_win_1"] }],
      golden,
    );
    expect(dropped).toBe(0);
    expect(recs).toEqual([
      { directive: "Variant the contrarian-hook winner", sources: ["golden:cr_win_1"], metric: "CPT $18.00 vs $30.00 target, 42 trials" },
    ]);
  });

  it("drops a rec that cites nothing — untraceable", () => {
    const { recs, dropped } = traceableRecs([{ directive: "Make better ads", sources: [] }], golden);
    expect(recs).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("drops a rec that cites the bare id without its kind prefix", () => {
    // Regression guard: the prompt asks for `golden:<id>`; a bare `cr_win_1`
    // is NOT a valid ref and must not silently pass.
    const { recs, dropped } = traceableRecs(
      [{ directive: "Variant winner", sources: ["cr_win_1"] }],
      golden,
    );
    expect(recs).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("strips hallucinated refs, keeping only real ones", () => {
    const { recs } = traceableRecs(
      [{ directive: "Lean into proof stats", sources: ["golden:cr_win_2", "golden:cr_ghost"] }],
      golden,
    );
    expect(recs[0].sources).toEqual(["golden:cr_win_2"]);
  });

  it("drops a rec whose only cited ref is hallucinated", () => {
    const { recs, dropped } = traceableRecs(
      [{ directive: "Ungrounded advice", sources: ["golden:cr_ghost"] }],
      golden,
    );
    expect(recs).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("dedupes and joins metrics when a rec cites several rows", () => {
    const { recs } = traceableRecs(
      [{ directive: "Both winners share a spot-read hook", sources: ["golden:cr_win_1", "golden:cr_win_1", "golden:cr_win_2"] }],
      golden,
    );
    expect(recs[0].sources).toEqual(["golden:cr_win_1", "golden:cr_win_2"]);
    expect(recs[0].metric).toContain("42 trials");
    expect(recs[0].metric).toContain("31 trials");
  });

  it("cold reader retrieves every backing row from a rec's refs alone", () => {
    const { recs } = traceableRecs(
      [
        { directive: "Variant winner 1", sources: ["golden:cr_win_1"] },
        { directive: "Variant winner 2", sources: ["golden:cr_win_2"] },
      ],
      golden,
    );
    const known = new Set(golden.map((g) => g.id));
    for (const r of recs) {
      expect(r.sources.length).toBeGreaterThan(0);
      for (const id of r.sources) {
        expect(known.has(id)).toBe(true);
        // self-describing: the kind tells the reader which store to query
        expect(id).toMatch(/^(golden|loser|rejection|explore|validating):/);
      }
    }
  });
});

describe("normalizeRecs — legacy string[] rows still render", () => {
  it("wraps bare strings as untraceable recs", () => {
    expect(normalizeRecs(["old advice"])).toEqual([{ directive: "old advice", sources: [], metric: "" }]);
  });
  it("passes through Rec objects and drops empty directives", () => {
    expect(normalizeRecs([{ directive: "", sources: ["x"], metric: "m" }])).toEqual([]);
  });
});

describe("learningsPromptBlock keeps source IDs in the prompt", () => {
  it("emits the backing IDs so downstream agents can trace each directive", () => {
    const l: Learning = {
      id: "l1",
      narrative: "Contrarian hooks are winning.",
      do_more: [{ directive: "Variant the spot-read winner", sources: ["golden:cr_win_1"], metric: "CPT $18.00, 42 trials" }],
      do_less: null,
      explore: [{ directive: "Fill the Props slot", sources: ["explore:Props"], metric: "unfilled explore slot" }],
      watchouts: null,
      created_at: "2026-07-10",
    };
    const block = learningsPromptBlock(l);
    expect(block).toContain("golden:cr_win_1");
    expect(block).toContain("explore:Props");
    expect(block).toContain("CPT $18.00, 42 trials");
  });
});
