import type { SupabaseClient } from "@supabase/supabase-js";
import { badMax, loserCptMultiplier, loserMatureDays, loserMinResults } from "@/lib/loop/config";

// Bad-Example store — the negative half of the example set: proven losers
// (triple-gated in apply_bad_refresh: mature + volume + CPT over target by the
// multiplier) and reviewer compliance rejections (reason mandatory). Rows are
// self-contained snapshots (script + dimensions + reason), so reads need no
// joins. See 0019_bad_examples.sql. Thresholds live in src/lib/loop/config.ts
// and are re-exported here so call sites keep one import.
export { badMax, loserCptMultiplier, loserMatureDays, loserMinResults };

export type BadExample = {
  id: string;
  kind: "proven_loser" | "review_rejection";
  creative_id: string;
  client_org: string;
  script: string;
  script_version: number | null;
  reason: string;
  dimensions: {
    family: string | null;
    hook_line: string | null;
    hook_angle: string | null;
    archetype: string | null;
    sport: string | null;
    format: string | null;
  };
  cpt_cents: number | null;
  target_cents: number | null;
  results: number | null;
  captured_at: string;
};

// Explicit sentinel consumers must surface when the store has no rows —
// silence would read as "nothing ever lost", when the store may simply not
// have matured data or any reviewed scripts yet.
export const EMPTY_BAD_NOTE =
  "(bad-example store is empty — no creative has matured into a proven loser " +
  "and no script has been rejected on compliance yet)";

// The consumable bad set: proven losers first (worst CPT ratio first), then
// the most recent compliance rejections. Returns { examples: [] } on an empty
// store; a query failure is surfaced as `error` so callers can distinguish
// "empty" from "couldn't read".
export async function getBadExamples(
  supabase: SupabaseClient,
  limit: number,
): Promise<{ examples: BadExample[]; error: string | null }> {
  const cols =
    "id, kind, creative_id, client_org, script, script_version, reason, dimensions, cpt_cents, target_cents, results, captured_at";
  const [loserRes, rejRes] = await Promise.all([
    // The refresh prunes proven losers to BAD_MAX, so this reads the whole set.
    supabase.from("bad_examples").select(cols).eq("kind", "proven_loser").limit(limit),
    supabase
      .from("bad_examples")
      .select(cols)
      .eq("kind", "review_rejection")
      .order("captured_at", { ascending: false })
      .limit(limit),
  ]);
  const error = loserRes.error ?? rejRes.error;
  if (error) return { examples: [], error: error.message };
  const losers = ((loserRes.data ?? []) as unknown as BadExample[]).sort(
    (a, b) => ratio(b) - ratio(a),
  );
  const rejections = (rejRes.data ?? []) as unknown as BadExample[];
  return { examples: [...losers, ...rejections], error: null };
}

function ratio(r: BadExample): number {
  if (r.cpt_cents == null || !r.target_cents) return 0;
  return r.cpt_cents / r.target_cents;
}

// The shared one-line prompt rendering of a bad example (dims come from the
// row's own snapshot — no live joins).
export function badExampleLine(b: BadExample): string {
  const d = b.dimensions ?? ({} as BadExample["dimensions"]);
  const head = `• "${d.hook_line ?? "?"}" — ${d.family ?? "?"} / ${d.hook_angle ?? "?"} / ${d.archetype ?? "?"} / ${d.sport ?? "?"}`;
  if (b.kind === "proven_loser") {
    const cpt = b.cpt_cents != null ? `$${(b.cpt_cents / 100).toFixed(2)}` : "—";
    const tgt = b.target_cents != null ? `$${(b.target_cents / 100).toFixed(2)}` : "—";
    return `${head} · CPT ${cpt} vs target ${tgt} (${b.results ?? "?"} trials) — ${b.reason}`;
  }
  return `${head} — rejected: ${b.reason}`;
}
