import Link from "next/link";
import { requireClientView, loadClientContent, usd, num } from "@/lib/client/data";
import type { ContentItem } from "@/lib/client/data";
import { rollupBy, defaultTargetCents, type CreativePerf, type Rollup } from "@/lib/metrics/perf";

export const dynamic = "force-dynamic";

// The client's read on performance: one headline (portfolio CPT vs the $30
// target), the KPI row, then where the wins are coming from — by concept and by
// angle — plus a leaderboard of individual pieces. CPT everywhere is ratio-of-
// sums, matching the contract's Performance Standard.
export default async function ClientInsights() {
  const { supabase } = await requireClientView();
  const items = await loadClientContent(supabase);
  const targetCents = defaultTargetCents();
  const targetDollars = targetCents != null ? targetCents / 100 : null;

  // Only items with spend feed the numbers.
  const live = items.filter((i) => i.perf && Number(i.perf.spend) > 0);
  const targetFor = (id: string) => items.find((i) => i.id === id)?.targetCents ?? targetCents;

  const rows = (dim: (i: ContentItem) => string | null) =>
    live.map((i) => ({ ...(i.perf as CreativePerf), dimension: dim(i) }));

  const overall = rollupBy(rows(() => "all"), targetFor)[0] ?? null;
  const byFamily = rollupBy(rows((i) => i.familyName), targetFor).filter((r) => r.results > 0);
  const byTheme = rollupBy(rows((i) => i.facets.theme), targetFor).filter((r) => r.results > 0);
  const byAngle = rollupBy(rows((i) => i.facets.angle), targetFor).filter((r) => r.results > 0);

  const totalResults = overall?.results ?? 0;
  const onTarget = overall?.hits ?? 0;
  const judged = overall?.judged ?? 0;
  const leaders = [...live]
    .filter((i) => i.perf?.cpt != null)
    .sort((a, b) => Number(a.perf!.cpt) - Number(b.perf!.cpt))
    .slice(0, 10);

  return (
    <main className="mx-auto max-w-5xl p-6 pb-24">
      <header className="mb-6">
        <div className="font-mono text-[11px] uppercase tracking-wide text-white/40">Outlier · Content</div>
        <h1 className="mt-1 text-[26px] font-semibold tracking-tight text-gray-50">Insights</h1>
        <p className="mt-1 text-sm text-white/50">
          Cost per trial (CPT) is spend ÷ trials, measured against the {targetDollars != null ? usd(targetDollars) : "target"} target.
        </p>
      </header>

      {live.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/45">
          No performance data yet — insights populate once creatives are live and spending.
        </p>
      ) : (
        <>
          {/* Hero + KPI row */}
          <div className="mb-8 grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">Portfolio CPT</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={`text-5xl font-semibold ${hitColor(overall?.cpt ?? null, targetDollars)}`}>
                  {overall?.cpt != null ? usd(overall.cpt) : "—"}
                </span>
                {targetDollars != null && <span className="text-sm text-white/40">/ {usd(targetDollars)}</span>}
              </div>
              {overall?.cpt != null && (
                <CptMeter cpt={Number(overall.cpt)} target={targetDollars} className="mt-4" />
              )}
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Stat label="Trials" value={num(totalResults)} />
              <Stat label="On target" value={judged ? `${onTarget}/${judged}` : "—"} accent />
              <Stat label="Best CPT" value={leaders[0]?.perf?.cpt != null ? usd(Number(leaders[0].perf!.cpt)) : "—"} accent />
            </div>
          </div>

          {/* By concept */}
          <RollupTable title="By concept" rows={byFamily} target={targetDollars} />
          {/* By theme (from the naming convention) */}
          <RollupTable title="By theme" rows={byTheme} target={targetDollars} />
          {/* By angle */}
          <RollupTable title="By angle" rows={byAngle} target={targetDollars} />

          {/* Leaderboard */}
          <section>
            <h2 className="mb-2.5 text-lg font-semibold text-gray-100">Top performing content</h2>
            <div className="divide-y divide-white/[0.06] overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
              {leaders.map((it, idx) => (
                <Link
                  key={it.id}
                  href={`/creatives/${it.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.04]"
                >
                  <span className="w-5 shrink-0 text-center font-mono text-[12px] text-white/35">{idx + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-gray-100">{it.hookLine}</span>
                    {it.adName && (
                      <span className="block truncate font-mono text-[11px] text-white/45" title={it.adName}>
                        {it.adName}
                      </span>
                    )}
                    <span className="text-[11.5px] text-white/40">
                      {it.familyName ?? "—"}
                      {it.facets.angle ? ` · ${it.facets.angle}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] text-white/45">{num(it.perf?.results)} trials</span>
                  <span className={`w-16 shrink-0 text-right text-[14px] font-semibold tabular-nums ${hitColor(it.perf?.cpt ?? null, targetDollars)}`}>
                    {it.perf?.cpt != null ? usd(Number(it.perf.cpt)) : "—"}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

function hitColor(cpt: number | null, target: number | null): string {
  if (cpt == null || target == null) return "text-gray-50";
  return cpt <= target ? "text-emerald-300" : "text-red-300";
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold ${accent ? "text-emerald-300" : "text-gray-50"}`}>{value}</div>
    </div>
  );
}

// Horizontal meter: CPT along a track scaled so the target sits at the midpoint.
// Fill (and the value) read green at/under target, red over. Target marked by a
// hairline tick. Unfilled track is a lighter step of the same surface.
function CptMeter({ cpt, target, className = "" }: { cpt: number; target: number | null; className?: string }) {
  if (target == null) return null;
  const max = target * 2; // target at 50%
  const pct = Math.min(100, (cpt / max) * 100);
  const good = cpt <= target;
  return (
    <div className={className}>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${good ? "bg-emerald-400/80" : "bg-red-400/80"}`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/50" />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] uppercase tracking-wide text-white/35">
        <span>$0</span>
        <span>target</span>
        <span>{usd(max)}</span>
      </div>
    </div>
  );
}

function RollupTable({ title, rows, target }: { title: string; rows: Rollup[]; target: number | null }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-2.5 text-lg font-semibold text-gray-100">{title}</h2>
      <div className="space-y-2">
        {rows.map((r) => {
          const good = r.cpt != null && target != null && r.cpt <= target;
          return (
            <div key={r.key} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[14px] font-medium text-gray-100">{r.key}</span>
                <span className="flex shrink-0 items-baseline gap-3 text-[12px] text-white/45">
                  <span>{num(r.results)} trials</span>
                  {r.judged > 0 && <span>{r.hits}/{r.judged} on target</span>}
                  <span className={`text-[15px] font-semibold tabular-nums ${good ? "text-emerald-300" : r.cpt != null && target != null ? "text-red-300" : "text-gray-50"}`}>
                    {r.cpt != null ? usd(r.cpt) : "—"}
                  </span>
                </span>
              </div>
              {r.cpt != null && <CptMeter cpt={Number(r.cpt)} target={target} className="mt-3" />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
