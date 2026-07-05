// Winners Cache — the decision for whether a creative is a "strong performer"
// worth caching for reuse, plus a rank score.
//
// Builds directly on the existing performance verdict (Hit = CPT <= target,
// src/lib/meta/perf.ts). For sportsbook clients `results` = trials (first
// deposits/registrations), so CPT is cost-per-trial. A raw Hit isn't enough to
// call something "proven": a creative that got 1 trial at $5 shows a stellar $5
// CPT purely by small-sample luck. So a strong performer must ALSO clear a
// minimum-volume bar before we trust its CPT and cache it.

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

// Tunable gates (env overrides; defaults are sportsbook-sane). Exposed so the
// route and tests share one source of truth.
export function minResults(): number {
  return envInt("WINNER_MIN_RESULTS", 10); // trials needed to trust the CPT
}
export function minSpendCents(): number {
  return envInt("WINNER_MIN_SPEND_CENTS", 5000); // $50 minimum spend
}

export type PerfInput = {
  creativeId: string;
  spend: number; // dollars
  results: number; // trials
  cpt: number | null; // dollars (ratio-of-sums)
  ctr: number | null;
};

export type WinnerVerdict = {
  qualifies: boolean;
  reason: string; // human-readable why / why-not
  score: number | null; // rank key (higher = better); null unless qualifies
};

// A strong performer is a Hit (CPT <= target) that also cleared the volume bar.
// Score rewards BOTH how far under target it is and how much volume proved it,
// so a winner over 200 trials outranks an equally-efficient one over 10.
export function evaluateWinner(
  perf: PerfInput,
  targetCents: number | null,
): WinnerVerdict {
  if (targetCents == null) {
    return { qualifies: false, reason: "no CPT target set", score: null };
  }
  if (perf.cpt == null || !Number.isFinite(perf.cpt) || perf.cpt <= 0 || perf.results <= 0) {
    return { qualifies: false, reason: "no usable CPT / conversions yet", score: null };
  }
  const targetDollars = targetCents / 100;
  if (perf.cpt > targetDollars) {
    return {
      qualifies: false,
      reason: `CPT $${perf.cpt.toFixed(2)} over target $${targetDollars.toFixed(2)}`,
      score: null,
    };
  }
  if (perf.results < minResults()) {
    return {
      qualifies: false,
      reason: `only ${perf.results} trials (need ${minResults()})`,
      score: null,
    };
  }
  if (Math.round(perf.spend * 100) < minSpendCents()) {
    return {
      qualifies: false,
      reason: `only $${perf.spend.toFixed(0)} spend (need $${(minSpendCents() / 100).toFixed(0)})`,
      score: null,
    };
  }
  const efficiency = targetDollars / perf.cpt; // >= 1 when at/under target
  const score = efficiency * Math.sqrt(perf.results); // efficiency x volume
  return {
    qualifies: true,
    reason: `Hit: CPT $${perf.cpt.toFixed(2)} <= $${targetDollars.toFixed(2)} over ${perf.results} trials`,
    score,
  };
}

// Rank a set of already-qualifying winners, best first.
export function rankWinners<T extends { score: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
