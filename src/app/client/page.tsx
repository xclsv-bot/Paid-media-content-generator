import Link from "next/link";
import { requireClientView, loadClientContent, loadThisWeek, loadComments, usd } from "@/lib/client/data";
import ContentCard from "@/components/client/ContentCard";

export const dynamic = "force-dynamic";

export default async function ClientHome() {
  const { user, supabase } = await requireClientView();
  const items = await loadClientContent(supabase);
  const week = await loadThisWeek(supabase, items);
  const comments = await loadComments(
    supabase,
    week.delivered.map((d) => d.id),
  );

  // Headline signal across everything delivered so far.
  const judged = items.filter((i) => i.hit !== null);
  const onTarget = judged.filter((i) => i.hit).length;
  const withVideo = items.filter((i) => i.videos.length > 0).length;
  const bestCpt = judged
    .map((i) => (i.perf?.cpt != null ? Number(i.perf.cpt) : null))
    .filter((n): n is number => n != null)
    .sort((a, b) => a - b)[0];

  const range = week.cycle
    ? `${fmt(week.cycle.startsOn)} – ${fmt(week.cycle.endsOn)}`
    : null;

  return (
    <main className="mx-auto max-w-6xl p-6 pb-24">
      <header className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-wide text-white/40">Outlier · Content</div>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-gray-50">
          Welcome{user.name ? `, ${user.name.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-1 text-sm text-white/50">
          Your creative for the week, everything delivered to date, and how it&apos;s performing.
        </p>
      </header>

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Delivered to date" value={withVideo.toLocaleString()} />
        <Stat label="On CPT target" value={judged.length ? `${onTarget}/${judged.length}` : "—"} accent />
        <Stat label="Best CPT" value={bestCpt != null ? usd(bestCpt) : "—"} accent />
        <Stat label="This week" value={week.delivered.length.toLocaleString()} />
      </div>

      <section className="mb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-gray-100">
            This week{week.cycle ? ` · ${week.cycle.label}` : ""}
          </h2>
          {range && <span className="text-[13px] text-white/45">{range}</span>}
        </div>
        {week.delivered.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/45">
            {week.cycle ? "No creative delivered for this week yet — it'll appear here as it ships." : "No active cycle yet."}
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {week.delivered.map((it) => (
              <ContentCard key={it.id} item={it} currentUserId={user.id} comments={comments[it.id] ?? []} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        <NavCard href="/client/library" title="Content library" desc="Every cut delivered, searchable and filterable." />
        <NavCard href="/client/ideas" title="Ideas" desc="The concepts behind the work and where each stands." />
        <NavCard href="/client/insights" title="Insights" desc="What's performing — by concept, angle, and format." />
      </div>
    </main>
  );
}

function fmt(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold ${accent ? "text-emerald-300" : "text-gray-50"}`}>{value}</div>
    </div>
  );
}

function NavCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20 hover:bg-white/[0.05]"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-100">{title}</h3>
        <span className="text-white/30 transition group-hover:translate-x-0.5 group-hover:text-white/60">→</span>
      </div>
      <p className="mt-1 text-[13px] text-white/50">{desc}</p>
    </Link>
  );
}
