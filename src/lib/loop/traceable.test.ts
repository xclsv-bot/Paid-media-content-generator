import { describe, expect, it } from "vitest";
import { traceableRecs } from "@/lib/loop/generate";
import { normalizeRecs, learningsPromptBlock, type Learning } from "@/lib/loop/learnings";
import type { RecSource } from "@/lib/loop/scoreboard";

const src = (id: string, metric: string): RecSource => ({ id, label: id, metric, prompt: `[${id}]` });

describe("traceableRecs — the cold-reader gate", () => {
  const golden: RecSource[] = [
    src("cr_win_1", "CPT $18.00 vs $30.00 target, 42 trials"),
    src("cr_win_2", "CPT $22.00 vs $30.00 target, 31 trials"),
  ];

  it("keeps a rec that cites a real candidate ID and stamps its metric", () => {
    const { recs, dropped } = traceableRecs(
      [{ directive: "Variant the contrarian-hook winner", sources: ["cr_win_1"] }],
      golden,
    );
    expect(dropped).toBe(0);
    expect(recs).toEqual([
      { directive: "Variant the contrarian-hook winner", sources: ["cr_win_1"], metric: "CPT $18.00 vs $30.00 target, 42 trials" },
    ]);
  });

  it("drops a rec that cites nothing — untraceable", () => {
    const { recs, dropped } = traceableRecs([{ directive: "Make better ads", sources: [] }], golden);
    expect(recs).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("strips hallucinated IDs, keeping only real ones", () => {
    const { recs } = traceableRecs(
      [{ directive: "Lean into proof stats", sources: ["cr_win_2", "cr_does_not_exist"] }],
      golden,
    );
    expect(recs[0].sources).toEqual(["cr_win_2"]);
  });

  it("drops a rec whose only cited ID is hallucinated", () => {
    const { recs, dropped } = traceableRecs(
      [{ directive: "Ungrounded advice", sources: ["cr_ghost"] }],
      golden,
    );
    expect(recs).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it("dedupes and joins metrics when a rec cites several rows", () => {
    const { recs } = traceableRecs(
      [{ directive: "Both winners share a spot-read hook", sources: ["cr_win_1", "cr_win_1", "cr_win_2"] }],
      golden,
    );
    expect(recs[0].sources).toEqual(["cr_win_1", "cr_win_2"]);
    expect(recs[0].metric).toContain("42 trials");
    expect(recs[0].metric).toContain("31 trials");
  });

  it("cold reader retrieves every backing row from a rec's IDs alone", () => {
    const { recs } = traceableRecs(
      [
        { directive: "Variant winner 1", sources: ["cr_win_1"] },
        { directive: "Variant winner 2", sources: ["cr_win_2"] },
      ],
      golden,
    );
    const known = new Set(golden.map((g) => g.id));
    for (const r of recs) {
      expect(r.sources.length).toBeGreaterThan(0);
      for (const id of r.sources) expect(known.has(id)).toBe(true);
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
      do_more: [{ directive: "Variant the spot-read winner", sources: ["cr_win_1"], metric: "CPT $18.00, 42 trials" }],
      do_less: null,
      explore: [{ directive: "Fill the Props slot", sources: ["Props"], metric: "unfilled explore slot" }],
      watchouts: null,
      created_at: "2026-07-10",
    };
    const block = learningsPromptBlock(l);
    expect(block).toContain("cr_win_1");
    expect(block).toContain("Props");
    expect(block).toContain("CPT $18.00, 42 trials");
  });
});
