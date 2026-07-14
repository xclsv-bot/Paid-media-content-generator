// Loop configuration — every tunable threshold in the learning loop, in one
// place. All values are env-overridable with sane sportsbook defaults; the
// domain modules (winners, attribution, golden, bad) re-export their getters
// from here, so call sites keep their imports and the values keep one home.
//
// | env                    | default | gate it controls                          |
// |------------------------|---------|-------------------------------------------|
// | WINNER_MIN_RESULTS     | 10      | trials before a Hit's CPT is trusted       |
// | WINNER_MIN_SPEND_CENTS | 5000    | spend before a Hit's CPT is trusted        |
// | LOOP_MIN_TRIALS        | 20      | trials before a cohort counts in learnings |
// | LOOP_PROVEN_HIT_RATE   | 0.5     | hit-rate for a family to count as proven   |
// | GOLDEN_MAX             | 10      | auto golden examples kept (best first)     |
// | BAD_MAX                | 10      | proven losers kept (worst first)           |
// | LOSER_MATURE_DAYS      | 21      | maturity window before a loser verdict     |
// | LOSER_MIN_RESULTS      | =LOOP_MIN_TRIALS | trials before a loser verdict     |
// | LOSER_CPT_MULTIPLIER   | 1.5     | CPT must be ≥ this × target to be a loser  |
// | BREAKDOWNS_MAX         | 6       | winner breakdowns fed to a prompt          |
// | BREAKDOWN_MAX_PER_RUN  | 5       | breakdown model calls per refresh run      |
// | BREAKDOWN_INPUT_CHAR_CAP | 8000  | script/transcript chars sent per teardown  |

// The contract measurement window (Performance Standard §4.3): a cohort is
// judged once its 21-day window has closed. Not env-tunable — it's contractual.
export const MATURE_DAYS = 21;

function envInt(name: string, fallback: number, min = 1): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? Math.round(n) : fallback;
}
function envNum(name: string, fallback: number, min: number, max = Infinity): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

// --- Winners Cache gates (src/lib/winners.ts) ---
export function minResults(): number {
  return envInt("WINNER_MIN_RESULTS", 10);
}
export function minSpendCents(): number {
  return envInt("WINNER_MIN_SPEND_CENTS", 5000);
}

// --- Learnings / attribution gates (src/lib/loop/attribution.ts) ---
export function minTrials(): number {
  return envInt("LOOP_MIN_TRIALS", 20);
}
export function provenHitRate(): number {
  return envNum("LOOP_PROVEN_HIT_RATE", 0.5, Number.MIN_VALUE, 1);
}

// --- Golden Set (src/lib/loop/golden.ts) ---
export function goldenMax(): number {
  return envInt("GOLDEN_MAX", 10);
}

// --- Bad-Example gates (src/lib/loop/bad.ts). The VALUES are product calls
// (defaults match existing loop config, pending sign-off with the client). ---
export function loserMatureDays(): number {
  return envInt("LOSER_MATURE_DAYS", MATURE_DAYS, 0);
}
export function loserMinResults(): number {
  return envInt("LOSER_MIN_RESULTS", minTrials());
}
export function loserCptMultiplier(): number {
  return envNum("LOSER_CPT_MULTIPLIER", 1.5, 1);
}
export function badMax(): number {
  return envInt("BAD_MAX", 10);
}

// --- Winner breakdowns (src/lib/loop/breakdowns.ts) ---
export function breakdownsMax(): number {
  return envInt("BREAKDOWNS_MAX", 6);
}
export function breakdownMaxPerRun(): number {
  return envInt("BREAKDOWN_MAX_PER_RUN", 5, 0);
}
export function breakdownInputCharCap(): number {
  return envInt("BREAKDOWN_INPUT_CHAR_CAP", 8000, 500);
}
