import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaff, type AppUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedStream } from "@/lib/storage";
import { defaultTargetCents, isHit, type CreativePerf } from "@/lib/meta/perf";
import { categorize, type Facets } from "@/lib/client/categorize";
import type { ReviewComment } from "@/components/ReviewCard";

// Guard the client area: clients see it; staff may preview it; creators are sent
// to their queue; the unauthenticated go to login. Returns the resolved user +
// an RLS-scoped supabase client so pages don't re-resolve either.
export async function requireClientView(): Promise<{ user: AppUser; supabase: SupabaseClient }> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "creator") redirect("/queue");
  const supabase = await createClient();
  return { user, supabase };
}

// Comments for a set of creatives, grouped by creative id.
export async function loadComments(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Record<string, ReviewComment[]>> {
  if (ids.length === 0) return {};
  const { data } = await supabase
    .from("comments")
    .select("id, creative_id, body, created_at, author_id")
    .in("creative_id", ids)
    .order("created_at", { ascending: true });
  const out: Record<string, ReviewComment[]> = {};
  (data ?? []).forEach((c: ReviewComment & { creative_id: string }) => {
    (out[c.creative_id] ??= []).push({ id: c.id, body: c.body, created_at: c.created_at, author_id: c.author_id });
  });
  return out;
}

// staff import kept for callers that need the check inline.
export { isStaff };

// A single content item as the client sees it: the creative + its facets, the
// delivered video(s), the performance rollup, and the approval state. No costs,
// no internal financials, no scripts, no ideate — RLS already withholds those.
export type ContentItem = {
  id: string;
  sheetId: string | null;
  adName: string | null;
  hookLine: string | null;
  summary: string | null;
  ideaStatus: string;
  isProven: boolean;
  familyName: string | null;
  facets: Facets;
  targetCents: number | null;
  perf: CreativePerf | null;
  hit: boolean | null;
  approval: string;
  videos: { id: string; fileName: string; versionLabel: string; uploadedAt: string; streamUrl: string | null }[];
};

export type ThisWeek = {
  cycle: { id: string; label: string; startsOn: string; endsOn: string; status: string } | null;
  delivered: ContentItem[];
};

type CreativeRow = {
  id: string;
  sheet_id: string | null;
  hook_line: string | null;
  content_summary: string | null;
  idea_status: string;
  is_proven: boolean;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  format: string | null;
  ad_name: string | null;
  cpt_target_cents: number | null;
  concept_families: { name: string } | { name: string }[] | null;
};

function famName(f: CreativeRow["concept_families"]): string | null {
  if (!f) return null;
  const v = Array.isArray(f) ? f[0] : f;
  return v?.name ?? null;
}

// Load every content item the signed-in client can see (RLS scopes to their org).
export async function loadClientContent(supabase: SupabaseClient): Promise<ContentItem[]> {
  const { data: creativesData } = await supabase
    .from("creatives")
    .select(
      "id, sheet_id, hook_line, content_summary, idea_status, is_proven, hook_angle, archetype, sport, format, ad_name, cpt_target_cents, concept_families(name)",
    )
    .order("sheet_id", { ascending: true });
  const creatives = (creativesData ?? []) as unknown as CreativeRow[];
  if (creatives.length === 0) return [];
  const ids = creatives.map((c) => c.id);

  const [{ data: assets }, { data: perfRows }, { data: approvals }] = await Promise.all([
    supabase
      .from("video_assets")
      .select("id, creative_id, file_name, version_label, storage_path, uploaded_at")
      .in("creative_id", ids)
      .order("uploaded_at", { ascending: false }),
    supabase
      .from("creative_performance")
      .select("creative_id, spend, impressions, clicks, results, ctr, cpt, last_updated")
      .in("creative_id", ids),
    supabase.from("approvals").select("creative_id, state").in("creative_id", ids),
  ]);

  // Sign each asset's stream URL, grouped by creative.
  const videosByCreative = new Map<string, ContentItem["videos"]>();
  for (const a of assets ?? []) {
    const list = videosByCreative.get(a.creative_id) ?? [];
    list.push({
      id: a.id,
      fileName: a.file_name,
      versionLabel: a.version_label,
      uploadedAt: a.uploaded_at,
      streamUrl: await createSignedStream(a.storage_path).catch(() => null),
    });
    videosByCreative.set(a.creative_id, list);
  }
  const perfByCreative = new Map<string, CreativePerf>();
  (perfRows as unknown as CreativePerf[] | null)?.forEach((p) => perfByCreative.set(p.creative_id, p));
  const approvalByCreative = new Map<string, string>();
  (approvals ?? []).forEach((a: { creative_id: string; state: string }) =>
    approvalByCreative.set(a.creative_id, a.state),
  );

  const fallbackTarget = defaultTargetCents();
  return creatives.map((c) => {
    const perfRaw = perfByCreative.get(c.id) ?? null;
    const perf = perfRaw && Number(perfRaw.spend) > 0 ? perfRaw : null;
    const targetCents = c.cpt_target_cents ?? fallbackTarget;
    const cpt = perf?.cpt != null ? Number(perf.cpt) : null;
    return {
      id: c.id,
      sheetId: c.sheet_id,
      adName: c.ad_name,
      hookLine: c.hook_line,
      summary: c.content_summary,
      ideaStatus: c.idea_status,
      isProven: c.is_proven,
      familyName: famName(c.concept_families),
      facets: categorize({
        concept_family: famName(c.concept_families),
        hook_angle: c.hook_angle,
        archetype: c.archetype,
        sport: c.sport,
        format: c.format,
        ad_name: c.ad_name,
      }),
      targetCents,
      perf,
      hit: isHit(cpt, targetCents),
      approval: approvalByCreative.get(c.id) ?? "Pending",
      videos: videosByCreative.get(c.id) ?? [],
    };
  });
}

// The current week's delivered content: the latest Active (or most recent) cycle
// for the client's org and its Delivered deliverables (RLS returns only Delivered).
export async function loadThisWeek(supabase: SupabaseClient, items: ContentItem[]): Promise<ThisWeek> {
  const { data: cycles } = await supabase
    .from("cycles")
    .select("id, label, starts_on, ends_on, status")
    .order("starts_on", { ascending: false })
    .limit(12);
  const list = (cycles ?? []) as Array<{ id: string; label: string; starts_on: string; ends_on: string; status: string }>;
  const current = list.find((c) => c.status === "Active") ?? list[0] ?? null;
  if (!current) return { cycle: null, delivered: [] };

  const { data: deliverables } = await supabase
    .from("deliverables")
    .select("concept_id, production_status")
    .eq("cycle_id", current.id);
  const deliveredIds = new Set(
    (deliverables ?? [])
      .filter((d: { production_status: string }) => d.production_status === "Delivered")
      .map((d: { concept_id: string }) => d.concept_id),
  );
  const byId = new Map(items.map((it) => [it.id, it]));
  const delivered = [...deliveredIds]
    .map((id) => byId.get(id))
    .filter((it): it is ContentItem => !!it);

  return {
    cycle: {
      id: current.id,
      label: current.label,
      startsOn: current.starts_on,
      endsOn: current.ends_on,
      status: current.status,
    },
    delivered,
  };
}

// Re-exported for server pages that already import formatters from here.
export { usd, num } from "@/lib/client/format";
