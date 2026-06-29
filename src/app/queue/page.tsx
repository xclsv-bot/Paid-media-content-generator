import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedStream } from "@/lib/storage";
import VideoUploader from "@/components/VideoUploader";
import VideoAssetCard from "@/components/VideoAssetCard";
import DeliverableStatusSelect from "@/components/DeliverableStatusSelect";

export const dynamic = "force-dynamic";

function famName(f: unknown): string | null {
  if (!f) return null;
  const v = Array.isArray(f) ? f[0] : f;
  return (v as { name?: string })?.name ?? null;
}
function one<T>(v: T | T[] | null): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default async function QueuePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("deliverables")
    .select(
      "id, concept_id, due_date, production_status, creatives(hook_line, hook_angle, content_summary, concept_families(name)), cycles(label, status, ends_on)",
    )
    .eq("assignee_id", user.id)
    .order("due_date", { ascending: true });

  const rows = (data ?? []) as unknown as Array<{
    id: string;
    concept_id: string;
    due_date: string | null;
    production_status: string;
    creatives: { hook_line: string | null; hook_angle: string | null; content_summary: string | null; concept_families: unknown } | { hook_line: string | null; hook_angle: string | null; content_summary: string | null; concept_families: unknown }[] | null;
    cycles: { label: string; status: string; ends_on: string } | { label: string; status: string; ends_on: string }[] | null;
  }>;

  // Existing videos per concept (for playback), signed inline.
  const conceptIds = rows.map((r) => r.concept_id);
  const videosByConcept = new Map<string, { id: string; fileName: string; versionLabel: string; streamUrl: string | null }[]>();
  if (conceptIds.length) {
    const { data: assets } = await supabase
      .from("video_assets")
      .select("id, creative_id, file_name, version_label, storage_path, uploaded_at")
      .in("creative_id", conceptIds)
      .order("uploaded_at", { ascending: false });
    for (const a of assets ?? []) {
      const list = videosByConcept.get(a.creative_id) ?? [];
      list.push({
        id: a.id,
        fileName: a.file_name,
        versionLabel: a.version_label,
        streamUrl: await createSignedStream(a.storage_path).catch(() => null),
      });
      videosByConcept.set(a.creative_id, list);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">My Queue</h1>
        <p className="text-sm text-white/50">
          The concepts assigned to you — read the brief, upload your cut, update status.
        </p>
      </header>

      {rows.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
          Nothing assigned to you yet.
        </p>
      )}

      <div className="space-y-4">
        {rows.map((r) => {
          const c = one(r.creatives);
          const cycle = one(r.cycles);
          const videos = videosByConcept.get(r.concept_id) ?? [];
          return (
            <section key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs uppercase tracking-wide text-white/40">
                    {cycle?.label}{r.due_date ? ` · due ${r.due_date}` : ""}
                  </div>
                  <h2 className="mt-0.5 truncate text-lg font-medium">{c?.hook_line}</h2>
                  <p className="text-sm text-white/50">
                    {famName(c?.concept_families)}{c?.hook_angle ? ` · ${c.hook_angle}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <DeliverableStatusSelect id={r.id} value={r.production_status} />
                  <Link href={`/creatives/${r.concept_id}`} className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">
                    Open brief
                  </Link>
                </div>
              </div>

              {videos.length > 0 && (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {videos.map((v) => (
                    <VideoAssetCard key={v.id} id={v.id} fileName={v.fileName} versionLabel={v.versionLabel} streamUrl={v.streamUrl} />
                  ))}
                </div>
              )}

              <div className="mt-4">
                <VideoUploader creativeId={r.concept_id} />
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
