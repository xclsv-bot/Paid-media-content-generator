import { evaluateWinner } from "@/lib/winners";
import { isMature } from "@/lib/loop/attribution";
import { loserCptMultiplier, loserMinResults } from "@/lib/loop/config";

// The verdict vocabulary — Graduated / Keep testing / Killed — is the client's
// own language for creative testing, so it must read identically everywhere:
// the /performance report, the quick-entry on a creative, the sheet import,
// and the loop. This module is the single source of truth for the values, the
// display maps, parsing report strings, and DERIVING a verdict from the same
// gate SHAPE the loop uses (evaluateWinner + the proven-loser gates).
//
// deriveVerdict is a per-ROW display estimate: it grades one (ad_name,
// flight_label) row against the target it is handed. The loop's stores are
// authoritative and grade differently — on creative_performance, which SUMs a
// creative's flights, against each creative's own cpt_target_cents. So a
// /performance pill can legitimately differ from a creative's store membership
// (three small flights that each read "keep testing" but sum to a cached
// winner). That is acceptable because an 'auto' verdict NEVER drives the loop:
// refreshAll honors only explicit user/report overrides and derives everything
// else from performance itself. A human/report verdict is a decision; 'auto' is
// a hint.

export const VERDICTS = ["GRADUATE", "KEEP_TESTING", "KILL"] as const;
export type Verdict = (typeof VERDICTS)[number];

// Who decided: derived by the app, set by staff in the UI, or arrived with the
// paid team's report. Auto never overwrites user/report (see /api/metrics).
export type VerdictSource = "auto" | "user" | "report";

export const VERDICT_LABEL: Record<Verdict, string> = {
  GRADUATE: "Graduated",
  KEEP_TESTING: "Keep testing",
  KILL: "Killed",
};
export const VERDICT_PILL: Record<Verdict, string> = {
  GRADUATE: "bg-emerald-500/15 text-emerald-300",
  KEEP_TESTING: "bg-amber-500/15 text-amber-300",
  KILL: "bg-red-500/15 text-red-300",
};
export const VERDICT_BAR: Record<Verdict, string> = {
  GRADUATE: "bg-emerald-400/80",
  KEEP_TESTING: "bg-amber-400/80",
  KILL: "bg-red-400/70",
};

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

// Report sheets say "Graduated" / "keep testing" / "Killed" (or the raw enum);
// map whatever a sheet says to the canonical value, null when unrecognizable.
export function parseVerdictLabel(raw: string | null | undefined): Verdict | null {
  if (!raw) return null;
  const v = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (v === "GRADUATE" || v === "GRADUATED" || v === "GRAD" || v === "WINNER") return "GRADUATE";
  if (v === "KEEP_TESTING" || v === "KEEP" || v === "TESTING" || v === "ITERATE") return "KEEP_TESTING";
  if (v === "KILL" || v === "KILLED" || v === "STOP" || v === "STOPPED" || v === "LOSER") return "KILL";
  return null;
}

export type VerdictPerf = {
  spend: number; // dollars
  results: number; // conversions/trials
  cpt: number | null; // dollars (CPA)
  ctr: number | null;
  firstDate: string | null; // first flight date — maturity anchor
};

// The derived verdict, from the loop's own gates:
//   KILL          — proven loser: mature + volume-gated + CPT ≥ multiplier × target
//   GRADUATE      — proven winner: Hit + volume gates (evaluateWinner)
//   KEEP_TESTING  — everything in between (including "no data yet")
// Gate parity with src/lib/loop/refresh.ts is load-bearing: a creative this
// function calls KILL is exactly one the refresh would put in the loser store.
export function deriveVerdict(
  perf: VerdictPerf,
  targetCents: number | null,
  now: Date = new Date(),
): Verdict {
  if (
    perf.cpt != null &&
    targetCents != null &&
    perf.firstDate != null &&
    isMature(perf.firstDate, now) &&
    perf.results >= loserMinResults() &&
    Math.round(perf.cpt * 100) >= Math.ceil(targetCents * loserCptMultiplier())
  ) {
    return "KILL";
  }
  const winner = evaluateWinner(
    { creativeId: "", spend: perf.spend, results: perf.results, cpt: perf.cpt, ctr: perf.ctr },
    targetCents,
  );
  return winner.qualifies ? "GRADUATE" : "KEEP_TESTING";
}
