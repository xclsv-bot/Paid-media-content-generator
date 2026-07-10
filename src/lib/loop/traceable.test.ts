import { describe, expect, it } from "vitest";
import { traceableRecs, buildLearningsPrompt, applyModelResponse, summarizeLearnings } from "@/lib/loop/generate";
import { normalizeRecs, learningsPromptBlock, type Learning } from "@/lib/loop/learnings";
import type { LearningInputs, RecSource } from "@/lib/loop/scoreboard";

const src = (id: string, metric: string): RecSource => ({ id, label: id, metric, prompt: `[${id}]` });

// A realistic candidate set whose ids use the same `<kind>:<key>` convention
// scoreboard.ts emits and the prompt asks the model to cite.
function sampleInputs(overrides: Partial<LearningInputs> = {}): LearningInputs {
  return {
    maturedCount: 5,
    targetDollars: "$30.00",
    scoreboardText: "Family:\n  Parlay: 60% hit (3/5), CPT $24.00, 120 trials",
    golden: [src("golden:cr_win_1", "CPT $18.00 vs $30.00 target, 42 trials")],
    losers: [src("loser:cr_lose_1", "CPT $55.00 vs $30.00 target, 30 trials")],
    rejections: [src("rejection:cr_rej_1", "compliance rejection")],
    explore: [src("explore:Props", "unfilled explore slot")],
    validating: [src("validating:Demystify", "Validating: 1/2 hit, CPT $28.00")],
    ...overrides,
  };
}

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

  it("omits the untraceable narrative prose from the agent-facing block", () => {
    const l: Learning = {
      id: "l1",
      narrative: "Contrarian hooks are winning across the board.",
      do_more: [{ directive: "Variant the spot-read winner", sources: ["golden:cr_win_1"], metric: "CPT $18.00" }],
      do_less: null,
      explore: null,
      watchouts: null,
      created_at: "2026-07-10",
    };
    const block = learningsPromptBlock(l);
    // Narrative is human-facing only; nothing without a source ref reaches agents.
    expect(block).not.toContain("Contrarian hooks are winning");
    expect(block).toContain("golden:cr_win_1");
  });
});

describe("prompt ⇄ validator seam — the regression this bug taught us", () => {
  const inputs = sampleInputs();
  const REF_KINDS = [
    "golden:cr_win_1",
    "loser:cr_lose_1",
    "explore:Props",
    "rejection:cr_rej_1",
    "validating:Demystify",
  ];

  it("the prompt exposes exactly the refs the validator will accept", () => {
    const { userContent } = buildLearningsPrompt(inputs, "Acme");
    // Every candidate ref the model is told to cite must appear verbatim in the
    // prompt — this is the contract that silently broke when the prompt said
    // `golden:x` but the validator keyed on bare `x`.
    for (const ref of REF_KINDS) expect(userContent).toContain(ref);
  });

  it("a model that cites those exact refs survives validation intact", () => {
    const parsed = {
      do_more: [{ directive: "Variant the winner", sources: ["golden:cr_win_1"] }],
      do_less: [{ directive: "Stop the loser", sources: ["loser:cr_lose_1"] }],
      explore: [{ directive: "Fill the Props slot", sources: ["explore:Props"] }],
      watchouts: [
        { directive: "Never repeat this rejection", sources: ["rejection:cr_rej_1"] },
        { directive: "Watch the Demystify sample", sources: ["validating:Demystify"] },
      ],
    };
    const applied = applyModelResponse(parsed, inputs);
    expect(applied.dropped).toBe(0);
    expect(applied.do_more).toHaveLength(1);
    expect(applied.do_less).toHaveLength(1);
    expect(applied.explore).toHaveLength(1);
    expect(applied.watchouts).toHaveLength(2);
    // watchouts pool both rejection and validating refs
    expect(applied.watchouts.map((r) => r.sources[0])).toEqual(["rejection:cr_rej_1", "validating:Demystify"]);
  });

  it("tolerates a non-object model payload without throwing", () => {
    for (const bad of [null, undefined, "oops", 42, []]) {
      const applied = applyModelResponse(bad, inputs);
      expect(applied).toEqual({ do_more: [], do_less: [], explore: [], watchouts: [], dropped: 0 });
    }
  });

  it("flags every category that has no backing data", () => {
    const empty = sampleInputs({ golden: [], losers: [], explore: [], rejections: [], validating: [] });
    const { flags } = buildLearningsPrompt(empty, "Acme");
    expect(flags).toHaveLength(4);
    expect(flags.join(" ")).toMatch(/do_more/);
    expect(flags.join(" ")).toMatch(/watchouts/);
  });
});

describe("summarizeLearnings — the empty-output floor", () => {
  it("flags allDropped when candidates existed but nothing survived", () => {
    const inputs = sampleInputs();
    const applied = applyModelResponse({ do_more: [], do_less: [], explore: [], watchouts: [] }, inputs);
    const summary = summarizeLearnings(inputs, applied, []);
    expect(summary.allDropped).toBe(true);
    expect(summary.counts).toEqual({ do_more: 0, do_less: 0, explore: 0, watchouts: 0 });
  });

  it("does not flag allDropped when at least one rec survived", () => {
    const inputs = sampleInputs();
    const applied = applyModelResponse(
      { do_more: [{ directive: "Variant", sources: ["golden:cr_win_1"] }], do_less: [], explore: [], watchouts: [] },
      inputs,
    );
    expect(summarizeLearnings(inputs, applied, []).allDropped).toBe(false);
  });

  it("does not flag allDropped when there were no candidates to begin with", () => {
    const empty = sampleInputs({ golden: [], losers: [], explore: [], rejections: [], validating: [] });
    const applied = applyModelResponse({ do_more: [], do_less: [], explore: [], watchouts: [] }, empty);
    expect(summarizeLearnings(empty, applied, ["do_more (…)"]).allDropped).toBe(false);
  });
});
