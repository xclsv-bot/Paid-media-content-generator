import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { defaultTargetCents, isHit } from "@/lib/metrics/perf";
import IdeasList, { type IdeaRow } from "@/components/IdeasList";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  sheet_id: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  idea_status: string;
  is_proven: boolean;
  cpt_target_cents: number | null;
  concept_families: { name: string } | { name: string }[] | null;
};

function fam(f: Row["concept_families"]): string | null {
  if (!f) return null;
  return Array.isArray(f) ? f[0]?.name ?? null : f.name;
}

export default async function IdeasPage() {
  const user = await getCurrentUser();
  if (user?.role === "creator") redirect("/queue");

  const supabase = await createClient();
  const [{ data }, { data: perf }, { data: vids }] = await Promise.all([
    supabase
      .from("creatives")
      .select(
        "id, sheet_id, hook_line, hook_angle, archetype, sport, idea_status, is_proven, cpt_target_cents, concept_families(name)",
      )
      // Ideate-created concepts have no sheet_id — surface them first (newest
      // first), then the original slate in its 01..40 order.
      .order("sheet_id", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false }),
    supabase.from("creative_performance").select("creative_id, cpt, spend"),
    supabase.from("video_assets").select("creative_id"),
  ]);

  const cptByConcept = new Map<string, number | null>();
  (perf ?? []).forEach((p: { creative_id: string; cpt: number | null; spend: number | null }) => {
    if (p.spend && Number(p.spend) > 0 && p.cpt != null) cptByConcept.set(p.creative_id, Number(p.cpt));
  });
  const withVideo = new Set<string>();
  (vids ?? []).forEach((v: { creative_id: string }) => withVideo.add(v.creative_id));

  const rows: IdeaRow[] = ((data ?? []) as unknown as Row[]).map((r) => {
    const cpt = cptByConcept.get(r.id) ?? null;
    const hit = cpt == null ? null : isHit(cpt, r.cpt_target_cents ?? defaultTargetCents());
    return {
      id: r.id,
      sheet_id: r.sheet_id,
      family: fam(r.concept_families),
      hook_line: r.hook_line,
      hook_angle: r.hook_angle,
      archetype: r.archetype,
      sport: r.sport,
      idea_status: r.idea_status,
      is_proven: r.is_proven,
      cpt,
      hit,
      has_video: withVideo.has(r.id),
    };
  });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[27px] font-semibold tracking-tight">Ideas</h1>
          <p className="mt-1.5 max-w-xl text-sm text-white/55">
            The concept bank for Outlier. Every card is one test — open it to see the hypothesis and the brief.
          </p>
        </div>
        <Link
          href="/concepts/new"
          className="rounded-[10px] bg-emerald-400 px-4 py-2.5 text-[13.5px] font-semibold text-black hover:bg-emerald-300"
        >
          + New concept
        </Link>
      </header>
      <IdeasList rows={rows} />
    </main>
  );
}
