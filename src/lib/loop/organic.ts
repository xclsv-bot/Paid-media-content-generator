import type { SupabaseClient } from "@supabase/supabase-js";

export type OrganicSignal = {
  id: string;
  platform: string;
  format: string | null;
  hook_summary: string;
  content_notes: string | null;
  sport: string | null;
  concept_families: { name: string } | { name: string }[] | null;
  hook_angles: { name: string } | { name: string }[] | null;
};

// Staff-approved organic-content signals, most recent first. Pending/rejected
// rows never reach here — unverified signal never silently steers Ideate.
export async function latestOrganicSignals(
  supabase: SupabaseClient,
  limit = 10,
): Promise<OrganicSignal[]> {
  const { data } = await supabase
    .from("organic_signals")
    .select(
      "id, platform, format, hook_summary, content_notes, sport, concept_families(name), hook_angles(name)",
    )
    .eq("review_status", "approved")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as unknown as OrganicSignal[]) ?? [];
}

function famName(v: { name: string } | { name: string }[] | null): string | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0]?.name ?? null : v.name;
}

// Formats approved organic signals as a prompt block for Ideate. Explicitly
// labeled explore-only — never let this read as proven CPT performance.
export function organicSignalsPromptBlock(signals: OrganicSignal[]): string {
  if (!signals.length) return "";
  const lines = signals
    .map((s) => {
      const fam = famName(s.concept_families);
      const angle = famName(s.hook_angles);
      const tag = [s.platform, s.format].filter(Boolean).join("/");
      const context = [
        fam ? `resembles family: ${fam}` : "",
        angle ? `angle: ${angle}` : "",
      ]
        .filter(Boolean)
        .join(", ");
      return `• [${tag}] "${s.hook_summary}"${s.content_notes ? ` — ${s.content_notes}` : ""}${context ? ` (${context})` : ""}`;
    })
    .join("\n");
  return [
    "ORGANIC CONTENT SIGNAL (staff-reviewed, but EXPLORE-ONLY — trending hooks/formats observed organically on social, outside paid spend. This is NOT performance data and has no CPT attached. Use it only to widen the pool of new angles to hypothesize about; never treat it as proven, and never let it override or get confused with the CPT-gated performance data above — that is the only real win signal):",
    lines,
  ].join("\n");
}
