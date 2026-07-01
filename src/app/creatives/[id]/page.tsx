import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, isStaff, isCreator } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedStream } from "@/lib/storage";
import { defaultTargetCents, isHit, type CreativePerf } from "@/lib/meta/perf";
import VideoUploader from "@/components/VideoUploader";
import DeliverableStatusControl from "@/components/DeliverableStatusControl";
import VideoAssetCard from "@/components/VideoAssetCard";
import ScriptPanel, { type Script } from "@/components/ScriptPanel";
import ReferencesPanel, { type Reference } from "@/components/ReferencesPanel";

export const dynamic = "force-dynamic";

const IDEA_STYLE: Record<string, string> = {
  Winner: "bg-emerald-500/20 text-emerald-300",
  Testing: "bg-sky-500/20 text-sky-300",
  Backlog: "bg-white/10 text-white/60",
  Parked: "bg-amber-500/20 text-amber-300",
};

export default async function CreativePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const staff = isStaff(user);
  const creator = isCreator(user);
  const supabase = await createClient();

  const { data: creative } = await supabase
    .from("creatives")
    .select(
      "id, sheet_id, content_summary, hook_line, hook_angle, archetype, feature_pillar, sport, format, variant_differentiator, cta, status, idea_status, is_proven, compliance_note, script_doc_url, cpt_target_cents, concept_families(name, compliance_note)",
    )
    .eq("id", id)
    .single();

  if (!creative) notFound();

  const [{ data: assets }, { data: perf }, { data: scripts }, { data: refs }] =
    await Promise.all([
      supabase
        .from("video_assets")
        .select("id, file_name, version_label, storage_path, uploaded_at")
        .eq("creative_id", id)
        .order("uploaded_at", { ascending: false }),
      supabase
        .from("creative_performance")
        .select("creative_id, spend, impressions, clicks, results, ctr, cpt, last_updated")
        .eq("creative_id", id)
        .single(),
      supabase
        .from("scripts")
        .select("id, body, source, status, version, model, created_at")
        .eq("concept_id", id)
        .order("version", { ascending: false }),
      supabase
        .from("concept_references")
        .select("id, kind, url, storage_path, label")
        .eq("concept_id", id)
        .order("created_at", { ascending: true }),
    ]);

  const videos = await Promise.all(
    (assets ?? []).map(async (a) => ({
      id: a.id,
      fileName: a.file_name,
      versionLabel: a.version_label,
      streamUrl: await createSignedStream(a.storage_path).catch(() => null),
    })),
  );

  // For an assigned creator, load their deliverable for this concept so they can
  // advance its production status from the brief. RLS (deliverables_creator_read)
  // already restricts this to deliverables assigned to them.
  let myDeliverable: { id: string; production_status: string | null } | null = null;
  if (creator) {
    const { data: dels } = await supabase
      .from("deliverables")
      .select("id, production_status, created_at")
      .eq("concept_id", id)
      .order("created_at", { ascending: false })
      .limit(1);
    myDeliverable = dels?.[0] ?? null;
  }

  const famRaw = (creative as unknown as {
    concept_families: { name: string; compliance_note: string | null } | { name: string; compliance_note: string | null }[] | null;
  }).concept_families;
  const family = Array.isArray(famRaw) ? famRaw[0] ?? null : famRaw;
  const compliance = creative.compliance_note || family?.compliance_note;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <Link href="/ideas" className="text-sm text-white/50 hover:underline">
        ← Ideas
      </Link>

      <header className="mt-3 mb-6">
        <p className="text-xs uppercase tracking-wide text-white/40">
          {family?.name} · #{creative.sheet_id}
          {creative.is_proven && <span className="ml-1 text-emerald-400">✓ proven</span>}
        </p>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-2xl font-semibold">{creative.hook_line}</h1>
          <span className={`rounded-full px-2 py-0.5 text-xs ${IDEA_STYLE[creative.idea_status] ?? ""}`}>
            {creative.idea_status}
          </span>
        </div>
        <p className="mt-1 text-white/60">{creative.content_summary}</p>
      </header>

      {compliance && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          ⚠ Compliance: {compliance}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: the brief */}
        <div className="space-y-6 lg:col-span-2">
          <section className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Field label="Archetype" value={creative.archetype} />
            <Field label="Hook angle" value={creative.hook_angle} />
            <Field label="Feature / pillar" value={creative.feature_pillar} />
            <Field label="Sport" value={creative.sport} />
            <Field label="Format" value={creative.format} />
            <Field label="CTA" value={creative.cta} />
            <Field label="Concept status" value={creative.status} />
            <Field label="Variant" value={creative.variant_differentiator} />
          </section>

          <ScriptPanel
            conceptId={creative.id}
            scripts={(scripts as unknown as Script[]) ?? []}
            scriptDocUrl={creative.script_doc_url}
            canEdit={staff}
          />

          <ReferencesPanel
            conceptId={creative.id}
            references={(refs as unknown as Reference[]) ?? []}
            canEdit={staff}
          />
        </div>

        {/* Right: deliverable / videos */}
        <div className="space-y-4">
          <h2 className="text-lg font-medium">Videos</h2>
          {videos.length === 0 && <p className="text-sm text-white/40">No videos uploaded yet.</p>}
          {videos.map((v) => (
            <VideoAssetCard
              key={v.id}
              id={v.id}
              fileName={v.fileName}
              versionLabel={v.versionLabel}
              streamUrl={v.streamUrl}
            />
          ))}
          {creator && myDeliverable && (
            <DeliverableStatusControl
              deliverableId={myDeliverable.id}
              status={myDeliverable.production_status}
            />
          )}
          {(staff || creator) && <VideoUploader creativeId={creative.id} />}
        </div>
      </div>

      <div className="mt-8">
        <PerformancePanel
          perf={(perf as unknown as CreativePerf) ?? null}
          targetCents={creative.cpt_target_cents ?? defaultTargetCents()}
        />
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-0.5">{value}</div>
    </div>
  );
}

function PerformancePanel({
  perf,
  targetCents,
}: {
  perf: CreativePerf | null;
  targetCents: number | null;
}) {
  const hasData = perf && Number(perf.spend) > 0;
  const cpt = perf?.cpt != null ? Number(perf.cpt) : null;
  const hit = isHit(cpt, targetCents);
  const usd = (n: number | null | undefined) =>
    n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  const num = (n: number | null | undefined) =>
    n == null ? "—" : Number(n).toLocaleString();

  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-medium">Performance</h2>
        {hit !== null && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${hit ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
            {hit ? "Hit ✓" : "Miss"}
          </span>
        )}
        {perf?.last_updated && (
          <span className="text-xs text-white/40">updated {new Date(perf.last_updated).toLocaleString()}</span>
        )}
      </div>
      {!hasData ? (
        <p className="text-sm text-white/40">No performance data yet — import a Meta export from the Performance page.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="Spend" value={usd(perf!.spend)} />
          <Metric label="Impressions" value={num(perf!.impressions)} />
          <Metric label="Clicks" value={num(perf!.clicks)} />
          <Metric label="CTR" value={perf!.ctr == null ? "—" : `${(Number(perf!.ctr) * 100).toFixed(2)}%`} />
          <Metric label="Results" value={num(perf!.results)} />
          <Metric label="CPT" value={usd(cpt)} />
        </div>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="text-xs text-white/40">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}
