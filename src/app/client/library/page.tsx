import { requireClientView, loadClientContent, loadComments } from "@/lib/client/data";
import LibraryBrowser from "@/components/client/LibraryBrowser";

export const dynamic = "force-dynamic";

// The client's content library — Google-Drive-like: everything with a delivered
// cut, filterable by concept / angle / format / sport, searchable, downloadable.
export default async function ClientLibrary() {
  const { user, supabase } = await requireClientView();
  const all = await loadClientContent(supabase);
  const items = all.filter((i) => i.videos.length > 0); // stored content = has a cut
  const comments = await loadComments(
    supabase,
    items.map((i) => i.id),
  );

  return (
    <main className="mx-auto max-w-6xl p-6 pb-24">
      <header className="mb-5">
        <div className="font-mono text-[11px] uppercase tracking-wide text-white/40">Outlier · Content</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-gray-50">Content library</h1>
        <p className="mt-1 text-sm text-white/50">
          Every cut delivered to date, in one place. Filter, search, preview, and download.
        </p>
      </header>

      {items.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/45">
          No delivered content yet — cuts will appear here as they ship.
        </p>
      ) : (
        <LibraryBrowser items={items} commentsByItem={comments} currentUserId={user.id} />
      )}
    </main>
  );
}
