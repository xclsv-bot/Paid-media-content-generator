import { describe, expect, it } from "vitest";
import { computeFamilySlots } from "@/lib/loop/slots";

const NOW = new Date("2026-07-01T12:00:00Z");
const MATURE = "2026-05-01"; // > 21 days before NOW
const FRESH = "2026-06-25"; // < 21 days before NOW

function perf(id: string, first: string | null, results: number, cpt: number | null) {
  return {
    creative_id: id,
    spend: cpt != null ? cpt * results : 0,
    impressions: 0,
    clicks: 0,
    results,
    ctr: null,
    cpt,
    last_updated: null,
    first_date: first,
  };
}

// Target $30 everywhere (3000 cents).
const dims = new Map(
  [
    ["w1", "Parlay"], ["w2", "Parlay"],
    ["v1", "Big Win"],
    ["imm", "Demystify"], ["thin", "Demystify"],
  ].map(([id, family]) => [id, { family, targetCents: 3000 }]),
);

describe("computeFamilySlots", () => {
  const families = ["Parlay", "Big Win", "Demystify", "Wildcard"];
  const rows = [
    perf("w1", MATURE, 40, 20), // hit
    perf("w2", MATURE, 30, 25), // hit -> Parlay: 2 judged, 2 hits => Proven
    perf("v1", MATURE, 25, 90), // miss -> Big Win: 1 judged => Validating
    perf("imm", FRESH, 100, 10), // immature -> excluded
    perf("thin", MATURE, 5, 10), // under trial floor (20) -> excluded
  ];
  const slots = computeFamilySlots(families, rows, dims, NOW);
  const byName = new Map(slots.map((s) => [s.family, s]));

  it("marks a family Proven once >=2 judged creatives clear the hit-rate bar", () => {
    expect(byName.get("Parlay")).toMatchObject({ status: "Proven", judged: 2, hits: 2 });
  });

  it("marks a family with matured data below the bar as Validating", () => {
    expect(byName.get("Big Win")).toMatchObject({ status: "Validating", judged: 1, hits: 0 });
  });

  it("ignores immature and under-volumed cohorts — their families stay Untested", () => {
    expect(byName.get("Demystify")).toMatchObject({ status: "Untested", judged: 0 });
  });

  it("gives every family a slot, including ones with no performance at all", () => {
    expect(byName.get("Wildcard")).toMatchObject({ status: "Untested", judged: 0, hits: 0 });
    expect(slots).toHaveLength(4);
  });

  it("orders Proven -> Validating -> Untested, alphabetical within a group", () => {
    expect(slots.map((s) => s.family)).toEqual(["Parlay", "Big Win", "Demystify", "Wildcard"]);
  });

  it("computes the cohort CPT as ratio-of-sums", () => {
    // Parlay: spend 20*40 + 25*30 = 1550 over 70 trials => ~22.14
    expect(byName.get("Parlay")!.cpt).toBeCloseTo(1550 / 70, 5);
  });
});
