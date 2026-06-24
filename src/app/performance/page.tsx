import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  defaultTargetCents,
  rollupBy,
  type CreativePerf,
  type Rollup,
} from "@/lib/meta/perf";

export const dynamic = "force-dynamic";

type Dim = {
  id: string;
  archetype: string | null;
  sport: string | null;
  cpt_target_cents: number | null;
  concept_families: { name: string } | { name: string }[] | null;
};

function familyName(d: Dim): string | null {
  const f = d.concept_families;
  if (!f) return null;
  return Array.isArray(f) ? f[0]?.name ?? null : f.name;
}

export default async function PerformancePage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const [{ data: perfRows }, { data: dimRows }] = await Promise.all([
    supabase
      .from("creative_performance")
      .select("creative_id, spend, impressions, clicks, results, ctr, cpt, last_updated"),
    supabase
      .from("creatives")
      .select("id, archetype, sport, cpt_target_cents, concept_families(name)"),
  ]);

  const dims = new Map<string, Dim>();
  for (const d of (dimRows ?? []) as unknown as Dim[]) dims.set(d.id, d);

  const fallback = defaultTargetCents();
  const targetForRow = (creativeId: string) =>
    dims.get(creativeId)?.cpt_target_cents ?? fallback;

  const perf = (perfRows ?? []) as unknown as CreativePerf[];
  const withDim = (pick: (d: Dim | undefined) => string | null) =>
    perf.map((p) => ({ ...p, dimension: pick(dims.get(p.creative_id)) }));

  const byFamily = rollupBy(withDim((d) => (d ? familyName(d) : null)), targetForRow);
  const byArchetype = rollupBy(withDim((d) => d?.archetype ?? null), targetForRow);
  const bySport = rollupBy(withDim((d) => d?.sport ?? null), targetForRow);

  const totalSpend = perf.reduce((s, p) => s + Number(p.spend || 0), 0);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/ideas" className="text-sm text-white/50 hover:underline">
            ← Ideas
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-white/50">
            ${totalSpend.toLocaleString(undefined, { maximumFractionDigits: 0 })} total spend
            {fallback != null && ` · CPT target $${(fallback / 100).toFixed(2)}`}
          </p>
        </div>
        {isStaff(user) && (
          <Link
            href="/import"
            className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black"
          >
            Import Meta CSV
          </Link>
        )}
      </header>

      {totalSpend === 0 && (
        <p className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          No performance data yet.{" "}
          {isStaff(user) ? "Import a Meta Ads Manager export to populate this." : ""}
        </p>
      )}

      <RollupTable title="By concept family" rows={byFamily} />
      <RollupTable title="By archetype" rows={byArchetype} />
      <RollupTable title="By sport" rows={bySport} />
    </main>
  );
}

function RollupTable({ title, rows }: { title: string; rows: Rollup[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-lg font-medium">{title}</h2>
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
                <td className="px-3 py-2 text-right">
                  ${r.spend.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </td>
                <td className="px-3 py-2 text-right text-white/70">
                  {r.ctr == null ? "—" : `${(r.ctr * 100).toFixed(2)}%`}
                </td>
                <td className="px-3 py-2 text-right text-white/70">{r.results}</td>
                <td className="px-3 py-2 text-right">
                  {r.cpt == null ? "—" : `$${r.cpt.toFixed(2)}`}
                </td>
                <td className="px-3 py-2 text-right text-white/70">
                  {r.judged === 0 ? "—" : `${r.hits}/${r.judged}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
