import { describe, it, expect } from "vitest";
import { parseMetaCsv } from "./csv";

describe("parseMetaCsv", () => {
  it("normalizes $/comma/% values, CTR percent->ratio, and US + ISO dates", () => {
    const csv = [
      "Ad name,Day,Amount spent (USD),Impressions,Link clicks,CTR (all),Results,Cost per result",
      'Ad A,10/17/2025,"$1,234.50","12,000",320,2.67,40,"$30.86"',
      "Ad B,2025-10-18,500,1000,10,1.5,5,100",
    ].join("\n");
    const r = parseMetaCsv(csv);

    expect(r.insights).toHaveLength(2);
    const a = r.insights[0];
    expect(a.adName).toBe("Ad A");
    expect(a.date).toBe("2025-10-17"); // M/D/YYYY -> ISO
    expect(a.spend).toBe(1234.5); // strips $ and thousands comma
    expect(a.impressions).toBe(12000);
    expect(a.clicks).toBe(320);
    expect(a.ctr).toBeCloseTo(0.0267, 6); // 2.67% -> 0.0267
    expect(a.results).toBe(40);
    expect(a.costPerResult).toBe(30.86);
    expect(r.insights[1].date).toBe("2025-10-18"); // already ISO
  });

  it("skips rows missing ad name or date and counts them", () => {
    const csv = [
      "Ad name,Day,Amount spent",
      ",10/01/2025,100", // no ad name
      "Ad C,,100", // no date
      "Ad D,10/02/2025,100",
    ].join("\n");
    const r = parseMetaCsv(csv);

    expect(r.insights).toHaveLength(1);
    expect(r.insights[0].adName).toBe("Ad D");
    expect(r.skipped).toBe(2);
  });

  it("detects header aliases (Amount spent vs Amount spent (USD), Reporting starts)", () => {
    const csv = ["Ad name,Reporting starts,Amount spent", "Ad E,10/03/2025,250"].join("\n");
    const r = parseMetaCsv(csv);

    expect(r.insights[0].spend).toBe(250);
    expect(r.detected.spend).toBe("Amount spent");
    expect(r.detected.date).toBe("Reporting starts");
  });

  it("honors the resultsColumn override for a custom trial event", () => {
    const csv = ["Ad name,Day,Trials", "Ad F,10/04/2025,7"].join("\n");
    const r = parseMetaCsv(csv, { resultsColumn: "Trials" });

    expect(r.insights[0].results).toBe(7);
  });
});
