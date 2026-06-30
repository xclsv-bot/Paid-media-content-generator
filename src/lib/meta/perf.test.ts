import { describe, it, expect } from "vitest";
import { isHit, rollupBy, type CreativePerf } from "./perf";

describe("isHit", () => {
  it("is null when cpt or target is missing", () => {
    expect(isHit(null, 1000)).toBeNull();
    expect(isHit(5, null)).toBeNull();
  });

  it("is true at the target boundary and false above it", () => {
    expect(isHit(10, 1000)).toBe(true); // 1000 cents = $10, cpt $10 -> hit (boundary)
    expect(isHit(9.99, 1000)).toBe(true);
    expect(isHit(10.01, 1000)).toBe(false);
  });
});

describe("rollupBy", () => {
  // c1 cpt $10, c2 cpt $20 with DIFFERENT weights so ratio-of-sums != avg-of-ratios.
  const rows: Array<CreativePerf & { dimension: string | null }> = [
    { creative_id: "c1", dimension: "Parlay", spend: 100, impressions: 1000, clicks: 50, results: 10, ctr: null, cpt: 10, last_updated: null },
    { creative_id: "c2", dimension: "Parlay", spend: 100, impressions: 3000, clicks: 30, results: 5, ctr: null, cpt: 20, last_updated: null },
  ];

  it("computes ratio-of-sums, not the average of per-creative ratios", () => {
    const [g] = rollupBy(rows, () => null);
    // CPT ratio-of-sums = (100+100)/(10+5) = 13.33; avg-of-ratios would be (10+20)/2 = 15.
    expect(g.cpt).toBeCloseTo(13.3333, 3);
    // CTR ratio-of-sums = (50+30)/(1000+3000) = 0.02; avg-of-ratios would be (0.05+0.01)/2 = 0.03.
    expect(g.ctr).toBeCloseTo(0.02, 6);
  });

  it("yields null cpt/ctr when the denominators are zero", () => {
    const z: Array<CreativePerf & { dimension: string | null }> = [
      { creative_id: "c3", dimension: "X", spend: 50, impressions: 0, clicks: 0, results: 0, ctr: null, cpt: null, last_updated: null },
    ];
    const [g] = rollupBy(z, () => null);
    expect(g.cpt).toBeNull();
    expect(g.ctr).toBeNull();
  });

  it("counts hits/judged against the per-creative target (cents)", () => {
    const [g] = rollupBy(rows, () => 1500); // target $15
    expect(g.judged).toBe(2); // both had cpt + target
    expect(g.hits).toBe(1); // c1 ($10) hits, c2 ($20) misses
  });
});
