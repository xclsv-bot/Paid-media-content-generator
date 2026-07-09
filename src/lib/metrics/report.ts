// Parse a pasted block of the team's weekly report (copied straight out of the
// sheet — TSV — or exported CSV) into creative_metrics rows. The ad NAME is the
// join key to concepts, so the parser's job is to be forgiving about column
// naming/format while never inventing an ad name.

export type ReportVerdict = "GRADUATE" | "ITERATE" | "KEEP_TESTING" | "KILL";

export type ReportRow = {
  ad_name: string;
  flight_label: string;
  flight_start: string | null;
  spend: number | null;
  conversions: number | null;
  cpa: number | null;
  ctr: number | null; // ratio, 0–1
  bau_cpa: number | null;
  verdict: ReportVerdict | null;
  reason: string | null;
  cpm: number | null;
  cpi: number | null;
  cps: number | null;
  icvr: number | null; // ratio, 0–1
  scvr: number | null; // ratio, 0–1
  aov: number | null;
  roas: number | null;
};

export type ParseResult = { rows: ReportRow[]; warnings: string[] };

type Field = keyof ReportRow;

// normalized header → field. Normalization strips everything but a-z0-9.
const HEADER_ALIASES: Record<string, Field> = {
  adname: "ad_name", ad: "ad_name", name: "ad_name", creative: "ad_name", creativename: "ad_name",
  flight: "flight_label", flightlabel: "flight_label", week: "flight_label", weeklabel: "flight_label",
  flightstart: "flight_start", start: "flight_start", startdate: "flight_start", date: "flight_start",
  spend: "spend", amountspent: "spend", cost: "spend", flightspend: "spend",
  conversions: "conversions", trials: "conversions", results: "conversions", purchases: "conversions", conv: "conversions",
  cpa: "cpa", cpt: "cpa", flightcpa: "cpa", costpertrial: "cpa", costperconversion: "cpa",
  ctr: "ctr",
  baucpa: "bau_cpa", bau: "bau_cpa", benchmark: "bau_cpa", benchmarkcpa: "bau_cpa",
  verdict: "verdict", decision: "verdict", grade: "verdict",
  reason: "reason", notes: "reason", note: "reason", why: "reason",
  cpm: "cpm", cpi: "cpi", cps: "cps",
  icvr: "icvr", scvr: "scvr",
  aov: "aov", roas: "roas",
};

const RATIO_FIELDS = new Set<Field>(["ctr", "icvr", "scvr"]);
export const REPORT_VERDICTS: ReadonlySet<string> = new Set(["GRADUATE", "ITERATE", "KEEP_TESTING", "KILL"]);
export const NUMBER_FIELDS = new Set<Field>([
  "spend", "conversions", "cpa", "ctr", "bau_cpa", "cpm", "cpi", "cps", "icvr", "scvr", "aov", "roas",
]);

function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Minimal CSV splitter that respects double quotes; TSV needs no quoting.
function splitLine(line: string, delim: string): string[] {
  if (delim === "\t") return line.split("\t");
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseNumber(raw: string, field: Field): number | null {
  const hasPercent = raw.includes("%");
  const cleaned = raw.replace(/[$,%\s]/g, "").replace(/,/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "—") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  if (RATIO_FIELDS.has(field)) {
    // "1.9%" → 0.019; a bare 1.9 in a ratio column is a percentage too — a
    // real 190% CTR/CVR doesn't happen, a 1.9% one does.
    if (hasPercent || n > 1) return n / 100;
    return n;
  }
  return n;
}

export function parseVerdict(raw: string): ReportVerdict | null {
  const v = raw.toUpperCase().replace(/[^A-Z]+/g, "_").replace(/^_|_$/g, "");
  if (v.startsWith("GRAD") || v.startsWith("PROMOTE")) return "GRADUATE";
  if (v.startsWith("ITER")) return "ITERATE"; // 1.5–2x BAU: new hook/edit, don't promote as-is
  if (v.startsWith("KEEP")) return "KEEP_TESTING";
  if (v.startsWith("KILL") || v.startsWith("STOP")) return "KILL"; // report says STOP_TEST
  return null;
}

function parseDate(raw: string): string | null {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

export function parseReport(text: string, defaultFlightLabel: string): ParseResult {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { rows: [], warnings: ["Nothing to parse."] };

  const delim = lines[0].includes("\t") ? "\t" : ",";
  const headerCells = splitLine(lines[0], delim).map(normHeader);
  const fieldAt: (Field | null)[] = headerCells.map((h) => HEADER_ALIASES[h] ?? null);

  if (!fieldAt.includes("ad_name")) {
    return {
      rows: [],
      warnings: [
        "No ad-name column found. Include the header row — a column named “Ad name” (or Ad / Creative) is required.",
      ],
    };
  }
  const ignored = headerCells.filter((h, i) => h !== "" && fieldAt[i] === null);
  if (ignored.length > 0) warnings.push(`Ignored unrecognized column(s): ${[...new Set(ignored)].join(", ")}.`);

  const byKey = new Map<string, ReportRow>();
  let skipped = 0;

  for (let li = 1; li < lines.length; li++) {
    const cells = splitLine(lines[li], delim);
    const row: ReportRow = {
      ad_name: "", flight_label: defaultFlightLabel, flight_start: null,
      spend: null, conversions: null, cpa: null, ctr: null, bau_cpa: null,
      verdict: null, reason: null, cpm: null, cpi: null, cps: null,
      icvr: null, scvr: null, aov: null, roas: null,
    };
    for (let ci = 0; ci < cells.length && ci < fieldAt.length; ci++) {
      const field = fieldAt[ci];
      const raw = cells[ci].trim();
      if (!field || raw === "") continue;
      if (field === "ad_name") row.ad_name = raw;
      else if (field === "flight_label") row.flight_label = raw;
      else if (field === "flight_start") row.flight_start = parseDate(raw);
      else if (field === "verdict") {
        row.verdict = parseVerdict(raw);
        if (row.verdict === null) warnings.push(`Row ${li + 1}: unrecognized verdict “${raw}” — left blank.`);
      } else if (field === "reason") row.reason = raw;
      else if (NUMBER_FIELDS.has(field)) {
        (row as Record<string, unknown>)[field] = parseNumber(raw, field);
      }
    }
    if (!row.ad_name) { skipped++; continue; }
    if (row.conversions != null) row.conversions = Math.round(row.conversions);
    const key = `${row.ad_name}\u0000${row.flight_label}`;
    if (byKey.has(key)) warnings.push(`Duplicate row for “${row.ad_name}” (${row.flight_label}) — the later one wins.`);
    byKey.set(key, row);
  }
  if (skipped > 0) warnings.push(`Skipped ${skipped} row(s) with no ad name.`);

  return { rows: [...byKey.values()], warnings };
}
