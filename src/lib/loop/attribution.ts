import { type Rollup } from "@/lib/meta/perf";

// A cohort is judged once its 21-day measurement window has closed (the contract
// Performance Standard §4.3). We use the first day a creative recorded spend as
// its "set live" date (see docs/PHASE3_ATTRIBUTION.md).
export const MATURE_DAYS = 21;

// A creative only counts toward learnings once enough trials sit behind it, so a
// lucky 2-conversion result doesn't masquerade as a signal. Configurable.
export function minTrials(): number {
  const n = Number(process.env.LOOP_MIN_TRIALS);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

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

// Hit-rate a family must clear (with enough judged creatives) to count as proven.
export function provenHitRate(): number {
  const n = Number(process.env.LOOP_PROVEN_HIT_RATE);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.5;
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
