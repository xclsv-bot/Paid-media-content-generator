import type { SupabaseClient } from "@supabase/supabase-js";

// Golden Set — proven winning creative with the full script snapshot, the
// reusable examples downstream prompts ground on. Rows are written ONLY by
// apply_golden_refresh() (auto-populate, via /api/winners/refresh) and by
// staff curation (PATCH /api/golden/:id). See 0018_golden_examples.sql for
// the completeness constraints and the pin/remove state machine.

// The cap lives with the rest of the loop thresholds in src/lib/loop/config.ts;
// re-exported here so call sites keep one import. Pinned rows are curator
// state and don't count against it.
import { goldenMax } from "@/lib/loop/config";
export { goldenMax };

// What the refresh route collects per qualifying winner before joining scripts.
export type GoldenQualifier = {
  creative_id: string;
  org_id: string;
  score: number;
  reason: string; // deterministic why-it-won from evaluateWinner
  cpt_cents: number;
  results: number;
  target_cents: number;
  family: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  format: string | null;
};

export type GoldenExample = {
  creative_id: string;
  org_id: string;
  script: string;
  script_version: number | null;
  why_it_won: string;
  dimensions: {
    family: string | null;
    hook_line: string | null;
    hook_angle: string | null;
    archetype: string | null;
    sport: string | null;
    format: string | null;
  };
  source: "auto" | "curated";
  status: "active" | "pinned" | "removed";
  transcript: string | null;
  score: number;
  cpt_cents: number;
  results: number;
  target_cents: number;
  captured_at: string;
};

// Diversity guard (advisory): does a proposed concept share a golden example's
// family + hook angle + format? This is a CATEGORICAL match (trimmed, case-
// folded; a null/empty value never matches) used to FLAG concepts in Ideate.
// It is deliberately coarse — it cannot tell a genuine same-family/angle variant
// (fresh hook) from a near-copy, so it is a hint, not an enforcement gate. The
// enforcement gate is text-based: findDuplicateHook (below).
export function findNearDuplicate(
  concept: { family?: string | null; angle?: string | null; format?: string | null },
  examples: GoldenExample[],
): string | null {
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const cf = norm(concept.family);
  const ca = norm(concept.angle);
  const cfmt = norm(concept.format);
  if (!cf || !ca) return null;
  for (const e of examples) {
    const d = e.dimensions ?? {};
    if (
      norm(d.family) === cf &&
      norm(d.hook_angle) === ca &&
      // format matches when either side doesn't specify one
      (!cfmt || !norm(d.format) || norm(d.format) === cfmt)
    ) {
      return d.hook_line ?? e.creative_id;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text-based near-duplication — the ENFORCEMENT gate.
//
// The categorical guard above can't distinguish "same family, fresh hook"
// (which we WANT) from "restated the winner" (which we must block). This one
// compares the actual hook text, so a same-family/angle variant with a genuinely
// different hook passes while a near-copy of a golden hook is caught.
//
// THRESHOLD (flagged, tunable): NEAR_DUPLICATE_THRESHOLD = 0.8 on a word-level
// Sørensen–Dice coefficient. 0.8 means "≥~80% of the significant words overlap".
// Rationale: a near-copy typically changes 0–2 words of a ~6–10 word hook (Dice
// ~0.85–1.0), while a real variant shares only incidental words (Dice < ~0.4).
// It is a judgement call — raise it to be more permissive, lower it to be
// stricter. Env-overridable via NEAR_DUPLICATE_THRESHOLD.
export function nearDuplicateThreshold(): number {
  const n = Number(process.env.NEAR_DUPLICATE_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.8;
}

// Normalize to significant word tokens: lowercase, drop punctuation, and drop a
// short list of function words so "stop guessing on your parlays" and "stop
// guessing your parlays" read as the same idea.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "for", "with",
  "your", "you", "our", "is", "are", "it", "this", "that", "at", "by",
]);
function tokens(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w && !STOPWORDS.has(w)),
  );
}

// Sørensen–Dice over the two token sets: 2·|A∩B| / (|A|+|B|), in [0,1].
export function hookSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

// Does `hookLine` restate any golden example's hook at/above the threshold?
// Returns the matching golden hook (so callers can say WHAT it duplicates), else
// null. This is the gate the concept-persist boundary enforces.
export function findDuplicateHook(
  hookLine: string | null | undefined,
  examples: GoldenExample[],
  threshold: number = nearDuplicateThreshold(),
): string | null {
  if (!hookLine || !hookLine.trim()) return null;
  for (const e of examples) {
    const goldenHook = e.dimensions?.hook_line;
    if (goldenHook && hookSimilarity(hookLine, goldenHook) >= threshold) {
      return goldenHook;
    }
  }
  return null;
}

// Does a generated script BODY restate any golden example's script at/above the
// threshold? The golden scripts are injected into the generation prompt, so the
// writer can echo them; this is the output gate the script-persist boundary
// (/api/concepts/:id/scripts/generate) enforces before saving. Returns the
// duplicated golden hook line for the error message, else null. Same word-Dice
// threshold as hooks — a near-verbatim restatement scores high; a brief that
// uses the pattern in its own words scores low.
export function findDuplicateScript(
  body: string | null | undefined,
  examples: GoldenExample[],
  threshold: number = nearDuplicateThreshold(),
): string | null {
  if (!body || !body.trim()) return null;
  for (const e of examples) {
    if (e.script && hookSimilarity(body, e.script) >= threshold) {
      return e.dimensions?.hook_line ?? e.creative_id;
    }
  }
  return null;
}

// The consumable golden set FOR ONE ORG, best-first, pinned included,
// tombstones excluded. orgId filters explicitly - service-role callers bypass
// RLS, and one client's scripts must never ground another's prompts.
// Every prompt/UI consumer must read through here (or replicate the
// status filter) — a 'removed' row is a curator veto, never an example.
export async function getGoldenExamples(
  supabase: SupabaseClient,
  orgId: string,
  limit: number,
): Promise<{ examples: GoldenExample[]; error: string | null }> {
  const { data, error } = await supabase
    .from("golden_examples")
    .select(
      "creative_id, org_id, script, script_version, why_it_won, dimensions, source, status, score, cpt_cents, results, target_cents, transcript, captured_at",
    )
    .eq("org_id", orgId)
    .neq("status", "removed")
    .order("score", { ascending: false })
    .limit(limit);
  if (error) return { examples: [], error: error.message };
  return { examples: (data ?? []) as unknown as GoldenExample[], error: null };
}
