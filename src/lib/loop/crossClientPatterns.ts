import type { SupabaseClient } from "@supabase/supabase-js";

export type CrossClientPattern = {
  id: string;
  title: string;
  pattern_type: string;
  generalized_summary: string;
  why_it_works: string | null;
  applicable_archetype: string | null;
  applicable_vertical: string | null;
};

// Published, staff-authored patterns abstracted from ANY client's learnings.
// No org filter by design: a published row is, by construction, safe for
// every org including the one it originated from — the abstraction step
// (src/app/api/cross-client-patterns) is what makes it shareable, not who's
// asking. source_org_id/authored_by are never selected here, so there is no
// code path by which this prompt block could leak provenance.
export async function latestCrossClientPatterns(
  supabase: SupabaseClient,
  limit = 8,
): Promise<CrossClientPattern[]> {
  const { data } = await supabase
    .from("cross_client_patterns")
    .select("id, title, pattern_type, generalized_summary, why_it_works, applicable_archetype, applicable_vertical")
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as CrossClientPattern[]) ?? [];
}

// Formats published patterns as a prompt block for Ideate. Explicitly
// explore-only — never let this read as proven CPT performance for this
// account, and never let it be conflated with the account's own learnings.
export function crossClientPatternsPromptBlock(patterns: CrossClientPattern[]): string {
  if (!patterns.length) return "";
  const lines = patterns
    .map((p) => {
      const tags = [p.pattern_type, p.applicable_archetype, p.applicable_vertical].filter(Boolean).join(" / ");
      return `• "${p.title}"${tags ? ` (${tags})` : ""} — ${p.generalized_summary}${p.why_it_works ? ` Why: ${p.why_it_works}` : ""}`;
    })
    .join("\n");
  return [
    "CROSS-CLIENT PATTERNS (staff-abstracted, generalized patterns observed on OTHER paid-social accounts we run — client-neutral by construction, no dollar figures or client-specific scripts. Like organic signal, this is a HYPOTHESIS SOURCE, not this account's CPT-gated performance data — never let it override or get confused with the live performance signals above):",
    lines,
  ].join("\n");
}
