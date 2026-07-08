// Performance math, in one place so the per-creative panel and the rollups agree.
// Sourced from the team's weekly report (creative_metrics), keyed by ad name.

// Global default CPA/CPT target (dollars); per-creative override wins.
// The client's Performance Standard target is $30.00 (revisable monthly) — set
// CPA_TARGET (or legacy META_CPT_TARGET) to change it without a code change.
const CONTRACT_TARGET_CENTS = 3000;
export function defaultTargetCents(): number | null {
  const raw = process.env.CPA_TARGET ?? process.env.META_CPT_TARGET;
  if (!raw) return CONTRACT_TARGET_CENTS;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : CONTRACT_TARGET_CENTS;
}

export type CreativePerf = {
  creative_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number; // conversions
  ctr: number | null;
  cpt: number | null; // dollars — cost per conversion (CPA)
  last_updated: string | null;
};

// Hit? = CPA/CPT <= target. Null if we have no value or no target to judge against.
export function isHit(cptDollars: number | null, targetCents: number | null): boolean | null {
  if (cptDollars === null || targetCents === null) return null;
  return cptDollars <= targetCents / 100;
}

export type Rollup = {
  key: string;
  count: number;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  ctr: number | null; // ratio of sums
  cpt: number | null; // ratio of sums — sum(spend)/sum(results), NOT avg of cpts
  hits: number; // creatives meeting target
  judged: number; // creatives we could judge (had cpt + target)
};

// Group per-creative performance rows by a dimension and aggregate correctly.
export function rollupBy(
  rows: Array<CreativePerf & { dimension: string | null }>,
  targetForRow: (creativeId: string) => number | null,
): Rollup[] {
  const groups = new Map<string, Rollup>();
  const ctrSum = new Map<string, number>();
  const ctrWeight = new Map<string, number>();
  const ctrPlainSum = new Map<string, number>();
  const ctrPlainN = new Map<string, number>();

  for (const r of rows) {
    const key = r.dimension ?? "—";
    const g =
      groups.get(key) ??
      { key, count: 0, spend: 0, impressions: 0, clicks: 0, results: 0, ctr: null, cpt: null, hits: 0, judged: 0 };

    g.count += 1;
    g.spend += r.spend || 0;
    g.impressions += r.impressions || 0;
    g.clicks += r.clicks || 0;
    g.results += r.results || 0;
    if (r.ctr != null) {
      ctrPlainSum.set(key, (ctrPlainSum.get(key) ?? 0) + r.ctr);
      ctrPlainN.set(key, (ctrPlainN.get(key) ?? 0) + 1);
      if ((r.spend || 0) > 0) {
        ctrWeight.set(key, (ctrWeight.get(key) ?? 0) + (r.spend || 0));
        ctrSum.set(key, (ctrSum.get(key) ?? 0) + r.ctr * (r.spend || 0));
      }
    }

    const hit = isHit(r.cpt, targetForRow(r.creative_id));
    if (hit !== null) {
      g.judged += 1;
      if (hit) g.hits += 1;
    }
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    // The weekly report carries CTR directly (no impressions/clicks columns),
    // so aggregate the reported CTRs spend-weighted; fall back to clicks/
    // impressions only if a source ever provides them.
    const w = ctrWeight.get(g.key) ?? 0;
    const n = ctrPlainN.get(g.key) ?? 0;
    g.ctr =
      w > 0
        ? (ctrSum.get(g.key) ?? 0) / w
        : n > 0
          ? (ctrPlainSum.get(g.key) ?? 0) / n // zero-spend rows: plain mean
          : g.impressions > 0
            ? g.clicks / g.impressions
            : null;
    g.cpt = g.results > 0 ? g.spend / g.results : null;
  }

  return [...groups.values()].sort((a, b) => b.spend - a.spend);
}
