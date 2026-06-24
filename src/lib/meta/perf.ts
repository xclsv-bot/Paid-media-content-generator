// Performance math, in one place so the per-creative panel and the rollups agree.

// Global default CPT target (dollars) from env; per-creative override wins.
export function defaultTargetCents(): number | null {
  const raw = process.env.META_CPT_TARGET;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export type CreativePerf = {
  creative_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  results: number;
  ctr: number | null;
  cpt: number | null; // dollars
  last_updated: string | null;
};

// Hit? = CPT <= target. Null if we have no CPT or no target to judge against.
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

    const hit = isHit(r.cpt, targetForRow(r.creative_id));
    if (hit !== null) {
      g.judged += 1;
      if (hit) g.hits += 1;
    }
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    g.ctr = g.impressions > 0 ? g.clicks / g.impressions : null;
    g.cpt = g.results > 0 ? g.spend / g.results : null;
  }

  return [...groups.values()].sort((a, b) => b.spend - a.spend);
}
