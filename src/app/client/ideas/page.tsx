import Link from "next/link";
import { requireClientView, loadClientContent, usd } from "@/lib/client/data";
import type { ContentItem } from "@/lib/client/data";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, string> = {
  Winner: "bg-emerald-500/15 text-emerald-300",
  Testing: "bg-sky-500/15 text-sky-300",
  Parked: "bg-amber-500/15 text-amber-300",
  Backlog: "bg-white/10 text-white/55",
};

// The idea catalog behind the work — grouped by concept, read-only. We surface
// ideas that have shipped or are in-market (Testing/Winner/Parked or has a cut);
// raw untested backlog stays internal.
export default async function ClientIdeas() {
  const { supabase } = await requireClientView();
  const all = await loadClientContent(supabase);
  const shown = all.filter((i) => i.ideaStatus !== "Backlog" || i.videos.length > 0 || i.isProven);

  const byFamily = new Map<string, ContentItem[]>();
  for (const it of shown) {
    const key = it.familyName ?? "Uncategorized";
    (byFamily.get(key) ?? byFamily.set(key, []).get(key)!).push(it);
  }
  const families = [...byFamily.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <main className="mx-auto max-w-5xl p-6 pb-24">
      <header className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-wide text-white/40">Outlier · Content</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-gray-50">Ideas</h1>
        <p className="mt-1 text-sm text-white/50">
          The concepts we&apos;re running, grouped by theme — and where each stands.
        </p>
      </header>

      {families.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/45">
          No ideas in market yet.
        </p>
      ) : (
        <div className="space-y-7">
          {families.map(([fam, list]) => (
            <section key={fam}>
              <div className="mb-2.5 flex items-baseline gap-2.5">
                <h2 className="text-lg font-semibold text-gray-100">{fam}</h2>
                <span className="text-[12px] text-white/40">{list.length} {list.length === 1 ? "idea" : "ideas"}</span>
              </div>
              <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                {list.map((it) => (
                  <Link
                    key={it.id}
                    href={`/creatives/${it.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
                  >
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[it.ideaStatus] ?? STATUS_PILL.Backlog}`}>
                      {it.ideaStatus}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-gray-100">{it.hookLine}</span>
                    {it.facets.angle && (
                      <span className="hidden shrink-0 text-[12px] text-white/40 sm:inline">{it.facets.angle}</span>
                    )}
                    {it.hit !== null && (
                      <span className={`shrink-0 text-[12px] font-medium ${it.hit ? "text-emerald-300" : "text-red-300"}`}>
                        {it.perf?.cpt != null ? usd(Number(it.perf.cpt)) : ""} {it.hit ? "✓" : ""}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
