// Parsing helpers for the paid team's weekly report sheet, shared by the import
// route (/api/metrics/import) and its tests. Kept out of the route file so they
// can be unit-tested without Next's route-export constraints.

export type RawRow = Record<string, string | number | null | undefined>;

// Loose header -> canonical creative_metrics column. Compared after lowercasing
// + stripping all non-alphanumerics, so "Ad Name", "ad_name", "AD-NAME" all
// collapse together. The sheet's exact headers can drift without breaking import.
export const HEADER_MAP: Record<string, string> = {
  adname: "ad_name", ad: "ad_name", name: "ad_name", namingconvention: "ad_name", creative: "ad_name",
  flight: "flight_label", flightlabel: "flight_label", week: "flight_label", label: "flight_label",
  flightstart: "flight_start", start: "flight_start", startdate: "flight_start", date: "flight_start",
  spend: "spend", cost: "spend", amountspent: "spend", spendusd: "spend",
  conversions: "conversions", conv: "conversions", results: "conversions", firstdeposits: "conversions",
  registrations: "conversions", deposits: "conversions", purchases: "conversions",
  cpa: "cpa", cpt: "cpa", flightcpa: "cpa", costperacquisition: "cpa", costperconversion: "cpa",
  ctr: "ctr", clickthroughrate: "ctr", clickthrough: "ctr",
  baucpa: "bau_cpa", benchmark: "bau_cpa", benchmarkcpa: "bau_cpa",
  verdict: "verdict", decision: "verdict", status: "verdict", call: "verdict",
  reason: "reason", notes: "reason", note: "reason",
  cpm: "cpm", cpi: "cpi", cps: "cps", icvr: "icvr", scvr: "scvr", aov: "aov", roas: "roas",
};

export function canon(header: string): string | null {
  return HEADER_MAP[header.toLowerCase().replace(/[^a-z0-9]/g, "")] ?? null;
}

export const NUMERIC_COLS = new Set([
  "spend", "conversions", "cpa", "bau_cpa", "cpm", "cpi", "cps", "icvr", "scvr", "aov", "roas",
]);

// "$1,234.50" -> 1234.5, "" -> null. Currency/thousands/percent signs stripped.
export function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// CTR: a "%"-marked or >1 value is a percentage -> ratio (0-1); else already a
// ratio. creative_metrics.ctr is stored as a ratio, so the report's "1.8%" or
// "1.8" both become 0.018.
export function toCtr(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  const pct = typeof v === "string" && v.includes("%");
  const n = toNum(v);
  if (n == null) return null;
  return pct || n > 1 ? n / 100 : n;
}

// Minimal RFC4180 CSV: quoted fields, doubled quotes, CRLF/LF. First non-empty
// row is the header; returns one object per data row keyed by raw header text.
export function parseCsv(text: string): RawRow[] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip CR */ }
    else field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length < 2) return [];
  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const o: RawRow = {};
    headers.forEach((h, idx) => { o[h] = r[idx] ?? ""; });
    return o;
  });
}
