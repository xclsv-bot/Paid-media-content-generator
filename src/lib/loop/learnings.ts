import type { SupabaseClient } from "@supabase/supabase-js";

export type Learning = {
  id: string;
  narrative: string;
  do_more: string[] | null;
  do_less: string[] | null;
  watchouts: string[] | null;
  created_at: string;
};

// The most recent learnings snapshot for an org, or null (also null if the
// table doesn't exist yet — callers treat "no learnings" as a no-op, so this
// never throws). Must filter by org_id explicitly — callers on the
// service-role (admin) client bypass RLS entirely, so this is the only thing
// stopping one org's learnings from leaking into another's.
export async function latestLearnings(supabase: SupabaseClient, orgId: string): Promise<Learning | null> {
  const { data } = await supabase
    .from("learnings")
    .select("id, narrative, do_more, do_less, watchouts, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Learning) ?? null;
}

// Formats the latest learnings as a prompt block for the reviewer + Ideate.
export function learningsPromptBlock(l: Learning | null): string {
  if (!l) return "";
  const list = (arr: string[] | null) => (arr && arr.length ? arr.map((x) => `- ${x}`).join("\n") : "");
  return [
    "CURRENT LEARNINGS (what's winning right now — weight these heavily):",
    l.narrative,
    l.do_more?.length ? `Do more:\n${list(l.do_more)}` : "",
    l.do_less?.length ? `Do less:\n${list(l.do_less)}` : "",
    l.watchouts?.length ? `Watch out:\n${list(l.watchouts)}` : "",
  ].filter(Boolean).join("\n\n");
}
