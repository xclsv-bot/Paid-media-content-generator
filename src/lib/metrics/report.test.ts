import { describe, expect, it } from "vitest";
import { parseReport } from "./report";

const DEFAULT = "Week of Jul 6";

describe("parseReport", () => {
  it("parses a TSV paste with money, percent, and verdict columns", () => {
    const text = [
      "Ad Name\tSpend\tConversions\tFlight CPA\tCTR\tBAU CPA\tVerdict\tReason",
      "XCLSV _ XCLSV _ WNBA _ Video _ NoFace _ Winning _ 0710\t$1,234.56\t42\t$29.39\t1.9%\t$31.00\tGraduate\tbeat BAU",
      "XCLSV _ XCLSV _ MLB _ Video _ Face _ Process _ 0710\t$500\t10\t$50.00\t0.8%\t$31.00\tKill\tCPA 60% over",
    ].join("\n");

    const { rows, warnings } = parseReport(text, DEFAULT);
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      ad_name: "XCLSV _ XCLSV _ WNBA _ Video _ NoFace _ Winning _ 0710",
      flight_label: DEFAULT,
      spend: 1234.56,
      conversions: 42,
      cpa: 29.39,
      ctr: 0.019,
      bau_cpa: 31,
      verdict: "GRADUATE",
      reason: "beat BAU",
    });
    expect(rows[1].verdict).toBe("KILL");
  });

  it("parses CSV with quoted fields and keep-testing verdicts", () => {
    const text = [
      'Ad name,Spend,Verdict,Reason',
      '"Name One",100,"Keep Testing","holding, needs volume"',
    ].join("\n");
    const { rows } = parseReport(text, DEFAULT);
    expect(rows[0]).toMatchObject({
      ad_name: "Name One",
      spend: 100,
      verdict: "KEEP_TESTING",
      reason: "holding, needs volume",
    });
  });

  it("treats bare >1 values in ratio columns as percentages", () => {
    const text = "Ad name\tCTR\ticvr\nA\t1.9\t12";
    const { rows } = parseReport(text, DEFAULT);
    expect(rows[0].ctr).toBeCloseTo(0.019);
    expect(rows[0].icvr).toBeCloseTo(0.12);
  });

  it("keeps <1 ratio values as ratios", () => {
    const text = "Ad name\tCTR\nA\t0.02";
    const { rows } = parseReport(text, DEFAULT);
    expect(rows[0].ctr).toBeCloseTo(0.02);
  });

  it("requires an ad-name column", () => {
    const { rows, warnings } = parseReport("Spend\tCTR\n5\t1%", DEFAULT);
    expect(rows).toEqual([]);
    expect(warnings[0]).toMatch(/ad-name column/i);
  });

  it("skips rows with no ad name and dedupes repeats (last wins)", () => {
    const text = [
      "Ad name\tSpend",
      "\t100",
      "A\t1",
      "A\t2",
    ].join("\n");
    const { rows, warnings } = parseReport(text, DEFAULT);
    expect(rows).toHaveLength(1);
    expect(rows[0].spend).toBe(2);
    expect(warnings.join(" ")).toMatch(/Skipped 1 row/);
    expect(warnings.join(" ")).toMatch(/Duplicate row/);
  });

  it("respects a per-row flight/week column and parses dates", () => {
    const text = "Ad name\tWeek\tFlight start\nA\tWeek of Jun 29\t2026-06-29";
    const { rows } = parseReport(text, DEFAULT);
    expect(rows[0].flight_label).toBe("Week of Jun 29");
    expect(rows[0].flight_start).toBe("2026-06-29");
  });

  it("warns on unknown verdicts and unrecognized columns without dropping the row", () => {
    const text = "Ad name\tVerdict\tMystery\nA\tmaybe\t9";
    const { rows, warnings } = parseReport(text, DEFAULT);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBeNull();
    expect(warnings.join(" ")).toMatch(/unrecognized verdict/i);
    expect(warnings.join(" ")).toMatch(/mystery/i);
  });
});

describe("parseVerdict vocabulary (real report)", () => {
  it("maps the graduation report's verdicts", () => {
    const text = [
      "Ad name\tVerdict",
      "A\tITERATE",
      "B\tSTOP_TEST",
      "C\tKEEP_TESTING",
      "D\tPromote",
    ].join("\n");
    const { rows } = parseReport(text, "Week of Jul 6");
    expect(rows.map((r) => r.verdict)).toEqual(["ITERATE", "KILL", "KEEP_TESTING", "GRADUATE"]);
  });
});
