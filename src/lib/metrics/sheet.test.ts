import { describe, it, expect } from "vitest";
import { canon, parseCsv, toCtr, toNum } from "./sheet";

describe("canon (header normalization)", () => {
  it("maps header variants to canonical columns", () => {
    expect(canon("Ad Name")).toBe("ad_name");
    expect(canon("ad_name")).toBe("ad_name");
    expect(canon("Naming Convention")).toBe("ad_name");
    expect(canon("Flight CPA")).toBe("cpa");
    expect(canon("CTR")).toBe("ctr");
    expect(canon("First Deposits")).toBe("conversions");
    expect(canon("Decision")).toBe("verdict");
    expect(canon("Week")).toBe("flight_label");
  });

  it("returns null for unknown headers", () => {
    expect(canon("Random Column")).toBeNull();
    expect(canon("")).toBeNull();
  });
});

describe("toNum", () => {
  it("strips currency, thousands, and percent signs", () => {
    expect(toNum("$1,234.50")).toBe(1234.5);
    expect(toNum("12%")).toBe(12);
    expect(toNum(42)).toBe(42);
  });
  it("returns null for blanks and non-numbers", () => {
    expect(toNum("")).toBeNull();
    expect(toNum(null)).toBeNull();
    expect(toNum("n/a")).toBeNull();
  });
});

describe("toCtr", () => {
  it("converts a percentage to a ratio", () => {
    expect(toCtr("1.8%")).toBeCloseTo(0.018);
    expect(toCtr("1.8")).toBeCloseTo(0.018); // >1 assumed percent
  });
  it("leaves an existing ratio alone", () => {
    expect(toCtr("0.018")).toBeCloseTo(0.018);
    expect(toCtr(0.02)).toBeCloseTo(0.02);
  });
  it("is null for blanks", () => {
    expect(toCtr("")).toBeNull();
    expect(toCtr(null)).toBeNull();
  });
});

describe("parseCsv", () => {
  it("parses a header + rows into keyed objects", () => {
    const rows = parseCsv("Ad Name,Spend,CPA,Decision\nXCLSV_MLB_A,100,8.50,Graduated\nXCLSV_NBA_B,50,22,Killed\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ "Ad Name": "XCLSV_MLB_A", Spend: "100", CPA: "8.50", Decision: "Graduated" });
    expect(rows[1].Decision).toBe("Killed");
  });

  it("handles quoted fields with commas and doubled quotes", () => {
    const rows = parseCsv('Ad Name,Reason\nAd_1,"Killed, over budget"\nAd_2,"He said ""stop"""\n');
    expect(rows[0].Reason).toBe("Killed, over budget");
    expect(rows[1].Reason).toBe('He said "stop"');
  });

  it("tolerates CRLF line endings and trailing blank lines", () => {
    const rows = parseCsv("Ad Name,Spend\r\nAd_1,100\r\n\r\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ "Ad Name": "Ad_1", Spend: "100" });
  });

  it("returns [] when there is no data row", () => {
    expect(parseCsv("Ad Name,Spend\n")).toEqual([]);
    expect(parseCsv("")).toEqual([]);
  });
});
