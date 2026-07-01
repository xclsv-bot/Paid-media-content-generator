import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  defaultTargetCents,
  rollupBy,
  type CreativePerf,
  type Rollup,
} from "@/lib/meta/perf";
import { isMature, minTrials, rankScore, hitRate, MATURE_DAYS } from "@/lib/loop/attribution";
import { latestLearnings, type Learning } from "@/lib/loop/learnings";
import LearningsPanel from "@/components/LearningsPanel";

export const dynamic = "force-dynamic";

type Dim = {
  id: string;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  feature_pillar: string | null;
  format: string | null;
  cpt_target_cents: number | null;
  concept_families: { name: string } | { name: string }[] | null;
};
type PerfRow = CreativePerf & { first_date: string | null };

function familyName(d: Dim): string | null {
  const f = d.concept_families;
  if (!f) return null;
  return Array.isArray(f) ? f[0]?.name ?? null : f.name;
}

const DIMENSIONS: { label: string; pick: (d: Dim | undefined) => string | null }[] = [
  { label: "Concept family", pick: (d) => (d ? familyName(d) : null) },
  { label: "Hook angle", pick: (d) => d?.hook_angle ?? null },
  { label: "Audience", pick: (d) => d?.archetype ?? null },
  { label: "Sport", pick: (d) => d?.sport ?? null },
  { label: "Feature", pick: (d) => d?.feature_pillar ?? null },
  { label: "Format", pick: (d) => d?.format ?? null },
];

export default async function PerformancePage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const [{ data: perfRows }, { data: dimRows }] = await Promise.all([
    supabase
      .from("creative_performance")
      .select("creative_id, spend, impressions, clicks, results, ctr, cpt, last_updated, first_date"),
    supabase
      .from("creatives")
      .select("id, hook_angle, archetype, sport, feature_pillar, format, cpt_target_cents, concept_families(name)"),
  ]);

  const dims = new Map<string, Dim>();
  for (const d of (dimRows ?? []) as unknown as Dim[]) dims.set(d.id, d);

  const fallback = defaultTargetCents();
  const targetForRow = (creativeId: string) => dims.get(creativeId)?.cpt_target_cents ?? fallback;

  const perf = (perfRows ?? []) as unknown as PerfRow[];
  const totalSpend = perf.reduce((s, p) => s + Number(p.spend || 0), 0);

  // Gated learnings set: mature cohorts with enough trials behind them.
  const now = new Date();
  const bar = minTrials();
  const matured = perf.filter((p) => isMature(p.first_date, now) && Number(p.results ?? 0) >= bar);

  const scoreboard = (rows: PerfRow[]) =>
    DIMENSIONS.map((dd) => ({
      label: dd.label,
      rows: rankScore(rollupBy(rows.map((p) => ({ ...p, dimension: dd.pick(dims.get(p.creative_id)) })), targetForRow)),
    }));
  const scored = scoreboard(matured);

  // Ungated full view (all creatives with any data) — kept for transparency.
  const withDim = (pick: (d: Dim | undefined) => string | null) =>
    perf.map((p) => ({ ...p, dimension: pick(dims.get(p.creative_id)) }));
  const byFamily = rollupBy(withDim((d) => (d ? familyName(d) : null)), targetForRow);
  const byArchetype = rollupBy(withDim((d) => d?.archetype ?? null), targetForRow);
  const bySport = rollupBy(withDim((d) => d?.sport ?? null), targetForRow);

  const learning = await latestLearnings(supabase);
  const targetDollars = fallback != null ? `$${(fallback / 100).toFixed(2)}` : null;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/ideas" className="text-sm text-white/50 hover:underline">← Ideas</Link>
          <h1 className="mt-1 text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-white/50">
            ${totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} total spend
            {targetDollars && ` · CPT target ${targetDollars}`}
          </p>
        </div>
        {isStaff(user) && (
          <Link href="/import" className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black">Meta performance</Link>
        )}
      </header>

      {totalSpend === 0 && (
        <p className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          No performance data yet. {isStaff(user) ? "Connect Meta or import a CSV to populate this." : ""}
        </p>
      )}

      <LearningsPanel learning={learning as Learning | null} canGenerate={isStaff(user)} />

      {/* ── Learnings scoreboard (gated) ─────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-1 flex items-baseline gap-2">
          <h2 className="text-lg font-medium">Learnings scoreboard</h2>
          <span className="font-mono text-xs text-white/40">what&apos;s winning, by dimension</span>
        </div>
        <p className="mb-4 text-xs text-white/45">
          Only mature cohorts count — ≥ {MATURE_DAYS} days since first spend and ≥ {bar} trials behind the
          creative. Ranked by hit rate (share at/under {targetDollars ?? "target"}), then CPT.
        </p>
        {matured.length === 0 ? (
          <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
            Nothing has matured yet — creatives appear here once they&apos;ve had ≥ {MATURE_DAYS} days live and ≥ {bar} trials.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {scored.map((s) => (
              <ScoreTable key={s.label} title={s.label} rows={s.rows} targetCents={fallback} />
            ))}
          </div>
        )}
      </section>

      {/* ── Ungated full view ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-1 text-lg font-medium">All creatives</h2>
        <p className="mb-4 text-xs text-white/45">Every creative with data — no maturity or volume gate.</p>
        <RollupTable title="By concept family" rows={byFamily} />
        <RollupTable title="By archetype" rows={byArchetype} />
        <RollupTable title="By sport" rows={bySport} />
      </section>
    </main>
  );
}

// Ranked, gated scoreboard for one dimension.
function ScoreTable({ title, rows, targetCents }: { title: string; rows: Rollup[]; targetCents: number | null }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 text-sm font-medium">{title}</div>
      <table className="w-full text-left text-sm">
        <thead className="text-white/50">
          <tr>
            <th className="px-3 py-1.5 font-normal">Value</th>
            <th className="px-3 py-1.5 text-right font-normal">n</th>
            <th className="px-3 py-1.5 text-right font-normal">Trials</th>
            <th className="px-3 py-1.5 text-right font-normal">CPT</th>
            <th className="px-3 py-1.5 text-right font-normal">Hit rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const hr = hitRate(r);
            const good = targetCents != null && r.cpt != null && r.cpt <= targetCents / 100;
            return (
              <tr key={r.key} className="border-t border-white/5">
                <td className="px-3 py-1.5">{r.key}</td>
                <td className="px-3 py-1.5 text-right text-white/60">{r.count}</td>
                <td className="px-3 py-1.5 text-right text-white/60">{r.results}</td>
                <td className={`px-3 py-1.5 text-right ${good ? "text-emerald-300" : r.cpt != null ? "text-red-300" : "text-white/50"}`}>
                  {r.cpt == null ? "—" : `$${r.cpt.toFixed(2)}`}
                </td>
                <td className="px-3 py-1.5 text-right text-white/70">
                  {hr == null ? "—" : `${Math.round(hr * 100)}% (${r.hits}/${r.judged})`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RollupTable({ title, rows }: { title: string; rows: Rollup[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-8">
      <h3 className="mb-2 text-sm font-medium text-white/70">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th className="px-3 py-2">{title.replace("By ", "")}</th>
              <th className="px-3 py-2 text-right">Creatives</th>
              <th className="px-3 py-2 text-right">Spend</th>
              <th className="px-3 py-2 text-right">CTR</th>
              <th className="px-3 py-2 text-right">Results</th>
              <th className="px-3 py-2 text-right">CPT</th>
              <th className="px-3 py-2 text-right">Hit rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-white/5">
                <td className="px-3 py-2">{r.key}</td>
                <td className="px-3 py-2 text-right text-white/70">{r.count}</td>
                <td className="px-3 py-2 text-right">${r.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                <td className="px-3 py-2 text-right text-white/70">{r.ctr == null ? "—" : `${(r.ctr * 100).toFixed(2)}%`}</td>
                <td className="px-3 py-2 text-right text-white/70">{r.results}</td>
                <td className="px-3 py-2 text-right">{r.cpt == null ? "—" : `$${r.cpt.toFixed(2)}`}</td>
                <td className="px-3 py-2 text-right text-white/70">{r.judged === 0 ? "—" : `${r.hits}/${r.judged}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
