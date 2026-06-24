import Papa from "papaparse";

// A normalized daily insight parsed from a Meta Ads Manager CSV export.
export type ParsedInsight = {
  adName: string;
  adId: string | null;
  date: string; // YYYY-MM-DD
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  results: number | null;
  costPerResult: number | null;
};

export type ParseResult = {
  insights: ParsedInsight[];
  detected: Record<string, string | null>;
  skipped: number;
  errors: string[];
};

// Header aliases — Meta renames these between export flavors, so match loosely.
const ALIASES: Record<string, string[]> = {
  adName: ["ad name", "ad_name"],
  adId: ["ad id", "ad_id"],
  date: ["day", "reporting starts", "date"],
  spend: ["amount spent (usd)", "amount spent", "spend"],
  impressions: ["impressions"],
  clicks: ["link clicks", "clicks (all)", "clicks", "link click"],
  ctr: ["ctr (all)", "ctr (link click-through rate)", "ctr"],
  results: ["results"],
  costPerResult: ["cost per result", "cost per results"],
};

function pickColumn(
  headers: string[],
  aliases: string[],
  override?: string,
): string | null {
  if (override) {
    const hit = headers.find((h) => h.trim().toLowerCase() === override.trim().toLowerCase());
    if (hit) return hit;
  }
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const a of aliases) {
    const idx = lower.indexOf(a);
    if (idx !== -1) return headers[idx];
  }
  return null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,%\s]/g, "");
  if (s === "" || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function ratioFromPercent(n: number | null): number | null {
  return n === null ? null : n / 100;
}

function toDate(v: unknown): string | null {
  if (!v) return null;
  const s = String(v).trim();
  // Already ISO-ish
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // M/D/YYYY or MM/DD/YYYY
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const [, m, d, y] = us;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export type ParseOptions = {
  resultsColumn?: string; // override which column = trials/results
  costColumn?: string; // override the cost-per-result column
};

export function parseMetaCsv(csvText: string, opts: ParseOptions = {}): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const errors: string[] = parsed.errors.map((e) => `${e.type}: ${e.message} (row ${e.row})`);
  const rows = parsed.data ?? [];
  if (rows.length === 0) {
    return { insights: [], detected: {}, skipped: 0, errors: [...errors, "No data rows found."] };
  }

  const headers = Object.keys(rows[0]);
  const cols = {
    adName: pickColumn(headers, ALIASES.adName),
    adId: pickColumn(headers, ALIASES.adId),
    date: pickColumn(headers, ALIASES.date),
    spend: pickColumn(headers, ALIASES.spend),
    impressions: pickColumn(headers, ALIASES.impressions),
    clicks: pickColumn(headers, ALIASES.clicks),
    ctr: pickColumn(headers, ALIASES.ctr),
    results: pickColumn(headers, ALIASES.results, opts.resultsColumn),
    costPerResult: pickColumn(headers, ALIASES.costPerResult, opts.costColumn),
  };

  if (!cols.adName) errors.push("Could not find an 'Ad name' column.");
  if (!cols.date) errors.push("Could not find a date column ('Day' / 'Reporting starts').");

  const insights: ParsedInsight[] = [];
  let skipped = 0;

  for (const row of rows) {
    const adName = cols.adName ? (row[cols.adName] || "").trim() : "";
    const date = cols.date ? toDate(row[cols.date]) : null;
    if (!adName || !date) {
      skipped++;
      continue;
    }
    insights.push({
      adName,
      adId: cols.adId ? (row[cols.adId] || "").trim() || null : null,
      date,
      spend: cols.spend ? toNumber(row[cols.spend]) : null,
      impressions: cols.impressions ? toNumber(row[cols.impressions]) : null,
      clicks: cols.clicks ? toNumber(row[cols.clicks]) : null,
      // Meta reports CTR as a percentage (2.67 = 2.67%); store as a ratio.
      ctr: cols.ctr ? ratioFromPercent(toNumber(row[cols.ctr])) : null,
      results: cols.results ? toNumber(row[cols.results]) : null,
      costPerResult: cols.costPerResult ? toNumber(row[cols.costPerResult]) : null,
    });
  }

  return { insights, detected: cols, skipped, errors };
}
