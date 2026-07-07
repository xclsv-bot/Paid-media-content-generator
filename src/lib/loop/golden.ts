import type { SupabaseClient } from "@supabase/supabase-js";

// Golden Set — proven winning creative with the full script snapshot, the
// reusable examples downstream prompts ground on. Rows are written ONLY by
// apply_golden_refresh() (auto-populate, via /api/winners/refresh) and by
// staff curation (PATCH /api/golden/:id). See 0018_golden_examples.sql for
// the completeness constraints and the pin/remove state machine.

// How many auto rows the refresh keeps (best score first). Pinned rows are
// curator state and don't count against this.
export function goldenMax(): number {
  const n = Number(process.env.GOLDEN_MAX);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 10;
}

// What the refresh route collects per qualifying winner before joining scripts.
export type GoldenQualifier = {
  creative_id: string;
  client_org: string;
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
  client_org: string;
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
  score: number;
  cpt_cents: number;
  results: number;
  target_cents: number;
  captured_at: string;
};

// The consumable golden set, best-first, pinned included, tombstones excluded.
// Every prompt/UI consumer must read through here (or replicate the
// status filter) — a 'removed' row is a curator veto, never an example.
export async function getGoldenExamples(
  supabase: SupabaseClient,
  limit: number,
): Promise<{ examples: GoldenExample[]; error: string | null }> {
  const { data, error } = await supabase
    .from("golden_examples")
    .select(
      "creative_id, client_org, script, script_version, why_it_won, dimensions, source, status, score, cpt_cents, results, target_cents, captured_at",
    )
    .neq("status", "removed")
    .order("score", { ascending: false })
    .limit(limit);
  if (error) return { examples: [], error: error.message };
  return { examples: (data ?? []) as unknown as GoldenExample[], error: null };
}
