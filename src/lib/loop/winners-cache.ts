import type { SupabaseClient } from "@supabase/supabase-js";

// The single runtime read path for "who is a proven winner". Every consumer
// (Ideate, the learnings scoreboard, future recommenders) goes through the
// Winners Cache — never an inline Hit/CPT filter over creative_performance,
// which lacks the volume gates in src/lib/winners.ts and can crown a
// 1-trial fluke. Only POST /api/winners/refresh computes winners.

export type CachedWinner = {
  creative_id: string;
  score: number;
  cpt_cents: number | null;
  results: number;
  target_cents: number | null;
  sport: string | null;
  hook_angle: string | null;
  archetype: string | null;
  captured_at: string;
  creatives: { hook_line: string | null } | { hook_line: string | null }[] | null;
  concept_families: { name: string } | { name: string }[] | null;
};

// Explicit sentinel every consumer must surface when the cache has no rows
// (fresh install, or nothing has cleared the proven bar yet) — silence would
// read as "no winners exist" when the cache may simply not have run.
export const EMPTY_CACHE_NOTE =
  "(winners cache is empty — no creative has cleared the proven-winner bar " +
  "(Hit + volume gates) yet; the daily /api/winners/refresh populates it)";

function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

// Best-first cached winners FOR ONE ORG, with display labels joined from the
// source rows. orgId must filter explicitly - service-role callers bypass RLS.
// Returns { winners: [] } on an empty cache; a query failure is surfaced as
// `error` so callers can distinguish "empty" from "couldn't read".
export async function getCachedWinners(
  supabase: SupabaseClient,
  orgId: string,
  limit: number,
): Promise<{ winners: CachedWinner[]; error: string | null }> {
  const { data, error } = await supabase
    .from("content_cache")
    .select(
      "creative_id, score, cpt_cents, results, target_cents, sport, hook_angle, archetype, captured_at, creatives(hook_line), concept_families(name)",
    )
    .eq("org_id", orgId)
    .order("score", { ascending: false })
    .limit(limit);
  if (error) return { winners: [], error: error.message };
  return { winners: (data ?? []) as unknown as CachedWinner[], error: null };
}

// The shared one-line prompt rendering of a cached winner.
export function winnerLine(w: CachedWinner): string {
  const hook = one(w.creatives)?.hook_line ?? "?";
  const family = one(w.concept_families)?.name ?? "?";
  const cpt = w.cpt_cents != null ? `$${(w.cpt_cents / 100).toFixed(2)}` : "—";
  return `• "${hook}" — ${family} / ${w.hook_angle ?? "?"} / ${w.archetype ?? "?"} / ${w.sport ?? "?"} · CPT ${cpt} (${w.results} trials)`;
}
