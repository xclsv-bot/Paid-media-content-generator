import { MATURE_DAYS, minTrials } from "@/lib/loop/attribution";

// Bad-Example thresholds — the three loser gates. A creative is a proven loser
// only when it is mature AND volume-gated AND its CPT is over target by the
// multiplier. The VALUES here are product calls (defaults chosen to match the
// existing loop config, pending sign-off); the gates themselves are
// re-enforced inside apply_bad_refresh(), which receives these as arguments —
// never hardcoded in SQL.

// Maturity window: same 21-day measurement window the learnings loop uses.
export function loserMatureDays(): number {
  const n = Number(process.env.LOSER_MATURE_DAYS);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : MATURE_DAYS;
}

// Volume floor: trials needed before a bad CPT is proof, not noise. Defaults
// to the loop's learnings gate (LOOP_MIN_TRIALS, 20).
export function loserMinResults(): number {
  const n = Number(process.env.LOSER_MIN_RESULTS);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : minTrials();
}

// "Well over target": CPT must be at least this multiple of the target.
// 1.5 = 150% of target — a near-miss is not a proven loser.
export function loserCptMultiplier(): number {
  const n = Number(process.env.LOSER_CPT_MULTIPLIER);
  return Number.isFinite(n) && n >= 1 ? n : 1.5;
}

// How many proven losers the refresh keeps (worst first).
export function badMax(): number {
  const n = Number(process.env.BAD_MAX);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 10;
}
