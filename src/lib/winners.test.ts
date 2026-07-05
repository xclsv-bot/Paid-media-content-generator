import { describe, it, expect } from "vitest";
import { evaluateWinner, rankWinners } from "./winners";

const base = { creativeId: "c1", ctr: 0.02 };
// default gates: min 10 trials, min $100 spend. Target passed in cents.

describe("evaluateWinner", () => {
  it("qualifies a Hit with enough volume", () => {
    const v = evaluateWinner({ ...base, spend: 500, results: 50, cpt: 8 }, 1000); // target $10
    expect(v.qualifies).toBe(true);
    expect(v.score).not.toBeNull();
  });

  it("rejects when CPT is over target (not a Hit)", () => {
    const v = evaluateWinner({ ...base, spend: 500, results: 50, cpt: 12 }, 1000);
    expect(v.qualifies).toBe(false);
    expect(v.score).toBeNull();
  });

  it("rejects a small-sample 'winner' below the trials bar", () => {
    // Stellar $2 CPT but only 3 trials — noise, must not be cached.
    const v = evaluateWinner({ ...base, spend: 200, results: 3, cpt: 2 }, 1000);
    expect(v.qualifies).toBe(false);
    expect(v.reason).toMatch(/trials/);
  });

  it("rejects when spend is below the minimum", () => {
    const v = evaluateWinner({ ...base, spend: 30, results: 20, cpt: 1.5 }, 1000);
    expect(v.qualifies).toBe(false);
    expect(v.reason).toMatch(/spend/);
  });

  it("is not a winner without a target or without conversions", () => {
    expect(evaluateWinner({ ...base, spend: 500, results: 50, cpt: 8 }, null).qualifies).toBe(false);
    expect(evaluateWinner({ ...base, spend: 500, results: 0, cpt: null }, 1000).qualifies).toBe(false);
  });

  it("scores more efficient and higher-volume winners above weaker ones", () => {
    const strong = evaluateWinner({ ...base, spend: 2000, results: 200, cpt: 5 }, 1000); // 2x under, big volume
    const weak = evaluateWinner({ ...base, spend: 200, results: 12, cpt: 9.5 }, 1000); // barely under, low volume
    expect(strong.score!).toBeGreaterThan(weak.score!);
  });
});

describe("rankWinners", () => {
  it("orders by score descending", () => {
    const ranked = rankWinners([{ score: 3 }, { score: 10 }, { score: 7 }]);
    expect(ranked.map((r) => r.score)).toEqual([10, 7, 3]);
  });
});
