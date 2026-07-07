import { type Rollup } from "@/lib/metrics/perf";
import { MATURE_DAYS, minTrials, provenHitRate } from "@/lib/loop/config";

// Thresholds live with the rest of the loop config (src/lib/loop/config.ts);
// re-exported here so existing call sites keep one import. A cohort is judged
// once its 21-day measurement window has closed (Performance Standard §4.3);
// we use the first day a creative recorded spend as its "set live" date
// (see docs/PHASE3_ATTRIBUTION.md).
export { MATURE_DAYS, minTrials, provenHitRate };

// Mature = first spend was at least MATURE_DAYS ago.
export function isMature(firstDate: string | null, now: Date): boolean {
  if (!firstDate) return false;
  const first = new Date(`${firstDate}T00:00:00Z`).getTime();
  if (Number.isNaN(first)) return false;
  return (now.getTime() - first) / 86_400_000 >= MATURE_DAYS;
}

export function hitRate(r: Rollup): number | null {
  return r.judged > 0 ? r.hits / r.judged : null;
}

export type SlotStatus = "Proven" | "Validating" | "Untested";

// A family's portfolio status from its matured rollup: Proven once ≥2 judged
// creatives clear the hit-rate bar; Validating if it has matured data but hasn't;
// Untested if nothing has matured yet.
export function slotStatus(r?: Rollup): SlotStatus {
  if (!r || r.judged === 0) return "Untested";
  return r.judged >= 2 && r.hits / r.judged >= provenHitRate() ? "Proven" : "Validating";
}

// Rank a dimension's rollups best-first: highest hit-rate, then lowest CPT.
export function rankScore(rows: Rollup[]): Rollup[] {
  return [...rows].sort((a, b) => {
    const ah = hitRate(a) ?? -1;
    const bh = hitRate(b) ?? -1;
    if (bh !== ah) return bh - ah;
    return (a.cpt ?? Infinity) - (b.cpt ?? Infinity);
  });
}
