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

// Diversity guard: does a proposed concept near-duplicate an existing golden
// example? Match = same family + hook angle + format (trimmed, case-folded;
// a null/empty value never matches). Returns the matching example's hook line
// so the UI can say WHAT it duplicates — the concept is flagged, not dropped.
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
