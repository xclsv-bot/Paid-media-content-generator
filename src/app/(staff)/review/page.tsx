import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedStream } from "@/lib/storage";
import type { ReviewComment } from "@/components/ReviewCard";
import ReviewBoard, { type ReviewItem } from "@/components/ReviewBoard";

export const dynamic = "force-dynamic";

function famName(f: unknown): string | null {
  if (!f) return null;
  const v = Array.isArray(f) ? f[0] : f;
  return (v as { name?: string })?.name ?? null;
}

export default async function ReviewPage() {
  const user = await requireStaff();

  const supabase = await createClient();

  // Creatives visible to this user (RLS scopes clients to their org).
  const { data: creativesData } = await supabase
    .from("creatives")
    .select("id, hook_line, concept_families(name)")
    .order("sheet_id", { ascending: true });
  const creatives = (creativesData ?? []) as unknown as Array<{
    id: string;
    hook_line: string | null;
    concept_families: unknown;
  }>;
  const ids = creatives.map((c) => c.id);

  if (ids.length === 0) {
    return <Empty />;
  }

  const [{ data: assets }, { data: approvals }, { data: comments }] = await Promise.all([
    supabase
      .from("video_assets")
      .select("id, creative_id, file_name, version_label, storage_path, uploaded_at")
      .in("creative_id", ids)
      .order("uploaded_at", { ascending: false }),
    supabase.from("approvals").select("creative_id, state").in("creative_id", ids),
    supabase
      .from("comments")
      .select("id, creative_id, body, created_at, author_id")
      .in("creative_id", ids)
      .order("created_at", { ascending: true }),
  ]);

  // Group + sign videos.
  const videosByCreative = new Map<string, { id: string; fileName: string; versionLabel: string; streamUrl: string | null }[]>();
  for (const a of assets ?? []) {
    const list = videosByCreative.get(a.creative_id) ?? [];
    list.push({
      id: a.id,
      fileName: a.file_name,
      versionLabel: a.version_label,
      streamUrl: await createSignedStream(a.storage_path).catch(() => null),
    });
    videosByCreative.set(a.creative_id, list);
  }
  const stateByCreative = new Map<string, string>();
  (approvals ?? []).forEach((a: { creative_id: string; state: string }) => stateByCreative.set(a.creative_id, a.state));
  const commentsByCreative = new Map<string, ReviewComment[]>();
  (comments ?? []).forEach((c: ReviewComment & { creative_id: string }) => {
    const list = commentsByCreative.get(c.creative_id) ?? [];
    list.push({ id: c.id, body: c.body, created_at: c.created_at, author_id: c.author_id });
    commentsByCreative.set(c.creative_id, list);
  });

  // Only show delivered work (has at least one video) that still needs a
  // decision — approving moves the piece out of this queue (it stays on its
  // concept page and in the client library).
  const delivered = creatives.filter((c) => videosByCreative.has(c.id));
  const approvedCount = delivered.filter((c) => stateByCreative.get(c.id) === "Approved").length;
  const items: ReviewItem[] = delivered
    .filter((c) => stateByCreative.get(c.id) !== "Approved")
    .map((c) => ({
      id: c.id,
      family: famName(c.concept_families),
      hook: c.hook_line,
      videos: (videosByCreative.get(c.id) ?? []).map((v) => ({ ...v, canDelete: true })),
      state: stateByCreative.get(c.id) ?? "Pending",
      comments: commentsByCreative.get(c.id) ?? [],
    }));

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-sm text-white/50">
          Delivered work waiting on a decision — watch, approve, and leave notes.
          {approvedCount > 0 && ` ${approvedCount} approved piece${approvedCount === 1 ? "" : "s"} moved out of this queue.`}
        </p>
      </header>

      {items.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
          {approvedCount > 0
            ? "All caught up — everything delivered has been approved."
            : "No delivered work to review yet."}
        </p>
      ) : (
        <ReviewBoard items={items} currentUserId={user.id} />
      )}
    </main>
  );
}

function Empty() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Review</h1>
        <p className="text-sm text-white/50">Delivered work — watch, approve, and leave notes.</p>
      </header>
      <p className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
        No delivered work to review yet.
      </p>
    </main>
  );
}
