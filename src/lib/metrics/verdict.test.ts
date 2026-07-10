import { describe, it, expect } from "vitest";
import { deriveVerdict, parseVerdictLabel, isVerdict, type VerdictPerf } from "./verdict";
import { evaluateWinner } from "@/lib/winners";
import { isMature } from "@/lib/loop/attribution";
import { loserCptMultiplier, loserMinResults } from "@/lib/loop/config";

// Fixed clock so maturity is deterministic. Default gates: winner needs 10
// results + $50 spend; loser needs mature (21d) + 20 results + CPT ≥ 1.5×target.
const NOW = new Date("2026-07-08T12:00:00Z");
const MATURE = "2026-06-01"; // 37 days before NOW
const FRESH = "2026-07-01"; // 7 days before NOW

const perf = (over: Partial<VerdictPerf>): VerdictPerf => ({
  spend: 500,
  results: 50,
  cpt: null,
  ctr: 0.02,
  firstDate: MATURE,
  ...over,
});

describe("deriveVerdict", () => {
  it("GRADUATEs a gated winner", () => {
    expect(deriveVerdict(perf({ cpt: 8 }), 1000, NOW)).toBe("GRADUATE");
  });

  it("KILLs a mature, volume-gated creative well over target", () => {
    expect(deriveVerdict(perf({ cpt: 20 }), 1000, NOW)).toBe("KILL");
  });

  it("KEEP_TESTING for an over-target creative that has not matured", () => {
    expect(deriveVerdict(perf({ cpt: 20, firstDate: FRESH }), 1000, NOW)).toBe("KEEP_TESTING");
  });

  it("KEEP_TESTING for an under-volume 'winner' (small-sample luck)", () => {
    expect(deriveVerdict(perf({ cpt: 2, results: 3 }), 1000, NOW)).toBe("KEEP_TESTING");
  });

  it("KEEP_TESTING when over target but under the loser multiplier", () => {
    // $12 CPT vs $10 target: a Miss, but not 1.5x over — still testing.
    expect(deriveVerdict(perf({ cpt: 12 }), 1000, NOW)).toBe("KEEP_TESTING");
  });

  it("KEEP_TESTING with no data or no target", () => {
    expect(deriveVerdict(perf({ cpt: null, results: 0 }), 1000, NOW)).toBe("KEEP_TESTING");
    expect(deriveVerdict(perf({ cpt: 8 }), null, NOW)).toBe("KEEP_TESTING");
  });

  // Gate parity is the whole point of deriveVerdict: sweep a CPT range and
  // check the verdict agrees with the loop's own gate implementations
  // (evaluateWinner for GRADUATE, the refresh's loser gate for KILL).
  it("agrees with the loop gates across a CPT sweep", () => {
    const target = 1000;
    for (let cptCents = 100; cptCents <= 3000; cptCents += 50) {
      const p = perf({ cpt: cptCents / 100 });
      const v = deriveVerdict(p, target, NOW);
      const winner = evaluateWinner(
        { creativeId: "x", spend: p.spend, results: p.results, cpt: p.cpt, ctr: p.ctr },
        target,
      ).qualifies;
      const loser =
        isMature(p.firstDate, NOW) &&
        p.results >= loserMinResults() &&
        cptCents >= Math.ceil(target * loserCptMultiplier());
      expect(v === "GRADUATE").toBe(winner);
      expect(v === "KILL").toBe(loser);
    }
  });
});

describe("parseVerdictLabel", () => {
  it("maps report language to canonical verdicts", () => {
    expect(parseVerdictLabel("Graduated")).toBe("GRADUATE");
    expect(parseVerdictLabel("GRADUATE")).toBe("GRADUATE");
    expect(parseVerdictLabel("keep testing")).toBe("KEEP_TESTING");
    expect(parseVerdictLabel("Keep-Testing")).toBe("KEEP_TESTING");
    expect(parseVerdictLabel("Killed")).toBe("KILL");
    expect(parseVerdictLabel("kill")).toBe("KILL");
  });

  it("returns null for unknown or empty strings", () => {
    expect(parseVerdictLabel("")).toBeNull();
    expect(parseVerdictLabel(null)).toBeNull();
    expect(parseVerdictLabel("promoted")).toBeNull();
  });
});

describe("isVerdict", () => {
  it("accepts only canonical values", () => {
    expect(isVerdict("GRADUATE")).toBe(true);
    expect(isVerdict("Graduated")).toBe(false);
    expect(isVerdict(null)).toBe(false);
  });
});
