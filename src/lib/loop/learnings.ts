import type { SupabaseClient } from "@supabase/supabase-js";

// A single traceable recommendation. `sources` are the exact backing-row IDs a
// cold reader retrieves to verify the rec — golden/loser creative_ids for
// do_more/do_less/watchouts, or the family name of an unfilled explore slot.
// `metric` is the authoritative figure attached from those rows at write time
// (never the model's own number). A rec with an empty `sources` is untraceable
// and is dropped before it is ever stored — see src/lib/loop/generate.ts.
export type Rec = {
  directive: string;
  sources: string[];
  metric: string;
};

export type Learning = {
  id: string;
  narrative: string;
  do_more: Rec[] | null;
  do_less: Rec[] | null;
  explore: Rec[] | null;
  watchouts: Rec[] | null;
  created_at: string;
};

// Legacy learnings rows (pre-traceability) stored do_more/do_less/watchouts as
// bare string[]. Normalize either shape to Rec[] so old snapshots still render
// (as untraceable recs with no sources) instead of throwing.
export function normalizeRecs(v: unknown): Rec[] {
  if (!Array.isArray(v)) return [];
  return v.map((item) => {
    if (typeof item === "string") return { directive: item, sources: [], metric: "" };
    const o = (item ?? {}) as Partial<Rec>;
    return {
      directive: typeof o.directive === "string" ? o.directive : "",
      sources: Array.isArray(o.sources) ? o.sources.filter((s): s is string => typeof s === "string") : [],
      metric: typeof o.metric === "string" ? o.metric : "",
    };
  }).filter((r) => r.directive.trim().length > 0);
}

// The most recent learnings snapshot for an org, or null (also null if the
// table doesn't exist yet — callers treat "no learnings" as a no-op, so this
// never throws). Must filter by org_id explicitly — callers on the
// service-role (admin) client bypass RLS entirely, so this is the only thing
// stopping one org's learnings from leaking into another's.
//
// Selects "*" rather than an explicit column list on purpose: migrations here
// deploy manually and separately from code, so a build that names a not-yet-
// added column (e.g. `explore` before 0027 runs) would error the query and make
// EVERY learning silently vanish. "*" returns whatever columns exist; a newer
// field is simply absent (normalizeRecs → []) until its migration lands.
export async function latestLearnings(supabase: SupabaseClient, orgId: string): Promise<Learning | null> {
  const { data } = await supabase
    .from("learnings")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    id: d.id as string,
    narrative: (d.narrative as string) ?? "",
    do_more: normalizeRecs(d.do_more),
    do_less: normalizeRecs(d.do_less),
    explore: normalizeRecs(d.explore),
    watchouts: normalizeRecs(d.watchouts),
    created_at: d.created_at as string,
  };
}

// One rendered recommendation line: the directive, its authoritative metric,
// and the backing-row IDs a reader traces it to. The IDs are the whole point —
// they stay in the prompt block so downstream agents (and any cold reader) can
// retrieve the exact winner/loser/slot behind each directive.
function recLine(r: Rec): string {
  const cite = r.sources.length ? ` [source: ${r.sources.join(", ")}]` : "";
  const metric = r.metric ? ` (${r.metric})` : "";
  return `- ${r.directive}${metric}${cite}`;
}

// Formats the latest learnings as a prompt block for the reviewer + Ideate.
// Deliberately OMITS `narrative`: it is free prose that cites no rows, so
// feeding it to downstream agents would reintroduce exactly the untraceable
// advice the traceable recs replaced. The narrative stays human-facing (the
// Performance page renders it); every line an agent grounds on carries a source
// ref back to a golden/loser/rejection creative_id or an explore/validating slot.
export function learningsPromptBlock(l: Learning | null): string {
  if (!l) return "";
  const list = (arr: Rec[] | null) => (arr && arr.length ? arr.map(recLine).join("\n") : "");
  return [
    "CURRENT LEARNINGS (what's winning right now — weight these heavily; each directive cites the backing creative_id(s) or explore slot):",
    l.do_more?.length ? `Do more:\n${list(l.do_more)}` : "",
    l.do_less?.length ? `Do less:\n${list(l.do_less)}` : "",
    l.explore?.length ? `Explore (unfilled slots):\n${list(l.explore)}` : "",
    l.watchouts?.length ? `Watch out:\n${list(l.watchouts)}` : "",
  ].filter(Boolean).join("\n\n");
}
