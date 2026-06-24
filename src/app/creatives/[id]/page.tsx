import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedStream } from "@/lib/storage";
import VideoUploader from "@/components/VideoUploader";
import VideoAssetCard from "@/components/VideoAssetCard";

export const dynamic = "force-dynamic";

export default async function CreativePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data: creative } = await supabase
    .from("creatives")
    .select(
      "id, sheet_id, content_summary, hook_line, hook_angle, archetype, feature_pillar, sport, format, variant_differentiator, cta, status, is_proven, compliance_note, concept_families(name, compliance_note)",
    )
    .eq("id", id)
    .single();

  if (!creative) notFound();

  const { data: assets } = await supabase
    .from("video_assets")
    .select("id, file_name, version_label, storage_path, uploaded_at")
    .eq("creative_id", id)
    .order("uploaded_at", { ascending: false });

  // Mint inline streaming URLs server-side for playback (signed, time-limited).
  const videos = await Promise.all(
    (assets ?? []).map(async (a) => ({
      id: a.id,
      fileName: a.file_name,
      versionLabel: a.version_label,
      streamUrl: await createSignedStream(a.storage_path).catch(() => null),
    })),
  );

  // Supabase types the joined relation as an array; normalize to a single row.
  const famRaw = (creative as unknown as {
    concept_families: { name: string; compliance_note: string | null } | { name: string; compliance_note: string | null }[] | null;
  }).concept_families;
  const family = Array.isArray(famRaw) ? famRaw[0] ?? null : famRaw;
  const compliance = creative.compliance_note || family?.compliance_note;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href="/library" className="text-sm text-white/50 hover:underline">
        ← Back to slate
      </Link>

      <header className="mt-3 mb-6">
        <p className="text-xs uppercase tracking-wide text-white/40">
          {family?.name} · #{creative.sheet_id}
          {creative.is_proven && <span className="ml-1 text-emerald-400">✓ proven</span>}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{creative.hook_line}</h1>
        <p className="mt-1 text-white/60">{creative.content_summary}</p>
      </header>

      {compliance && (
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          ⚠ Compliance: {compliance}
        </div>
      )}

      <section className="mb-8 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <Field label="Archetype" value={creative.archetype} />
        <Field label="Hook angle" value={creative.hook_angle} />
        <Field label="Feature / pillar" value={creative.feature_pillar} />
        <Field label="Sport" value={creative.sport} />
        <Field label="Format" value={creative.format} />
        <Field label="CTA" value={creative.cta} />
        <Field label="Status" value={creative.status} />
        <Field label="Variant" value={creative.variant_differentiator} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Videos</h2>
        {videos.length === 0 && (
          <p className="text-sm text-white/40">No videos uploaded yet.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {videos.map((v) => (
            <VideoAssetCard
              key={v.id}
              id={v.id}
              fileName={v.fileName}
              versionLabel={v.versionLabel}
              streamUrl={v.streamUrl}
            />
          ))}
        </div>

        {isStaff(user) && (
          <div className="mt-6">
            <VideoUploader creativeId={creative.id} />
          </div>
        )}
      </section>
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
