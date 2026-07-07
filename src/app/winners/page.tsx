import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import WinnersRefresh from "@/components/WinnersRefresh";

export const dynamic = "force-dynamic";

type Row = {
  creative_id: string;
  org_id: string;
  score: number;
  cpt_cents: number | null;
  results: number;
  spend_cents: number;
  sport: string | null;
  hook_angle: string | null;
  archetype: string | null;
  captured_at: string;
  creatives: { hook_line: string | null; sheet_id: string | null } | { hook_line: string | null; sheet_id: string | null }[] | null;
  concept_families: { name: string } | { name: string }[] | null;
  organizations: { display_name: string } | { display_name: string }[] | null;
};

function one<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default async function WinnersPage() {
  const user = await getCurrentUser();
  const staff = isStaff(user);
  const supabase = await createClient();

  const { data } = await supabase
    .from("content_cache")
    .select(
      "creative_id, org_id, score, cpt_cents, results, spend_cents, sport, hook_angle, archetype, captured_at, creatives(hook_line, sheet_id), concept_families(name), organizations(display_name)",
    )
    .order("score", { ascending: false });

  const rows = (data ?? []) as unknown as Row[];

  // Group by sport (the primary reuse dimension for a sportsbook), rows already
  // ranked best-first.
  const bySport = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.sport ?? "Other";
    (bySport.get(key) ?? bySport.set(key, []).get(key)!).push(r);
  }

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/ideas" className="text-sm text-white/50 hover:underline">← Ideas</Link>
          <h1 className="mt-1 text-2xl font-semibold">Winners</h1>
          <p className="text-sm text-white/50">
            Proven content — creatives beating their CPT target with enough volume to trust,
            cached for reuse in the next slate. {rows.length} cached.
          </p>
        </div>
        {staff && <WinnersRefresh />}
      </header>

      {rows.length === 0 && (
        <p className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          No winners cached yet.{" "}
          {staff ? "Import Meta performance, then Refresh cache." : ""}
        </p>
      )}

      {[...bySport.entries()].map(([sport, list]) => (
        <section key={sport} className="mb-8">
          <h2 className="mb-2 text-lg font-medium">{sport}</h2>
          <div className="overflow-hidden rounded-xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-white/60">
                <tr>
                  {staff && <th className="px-3 py-2">Org</th>}
                  <th className="px-3 py-2">Concept</th>
                  <th className="px-3 py-2">Family</th>
                  <th className="px-3 py-2">Hook angle</th>
                  <th className="px-3 py-2 text-right">CPT</th>
                  <th className="px-3 py-2 text-right">Trials</th>
                  <th className="px-3 py-2 text-right">Spend</th>
                  <th className="px-3 py-2 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const c = one(r.creatives);
                  const fam = one(r.concept_families);
                  const org = one(r.organizations);
                  return (
                    <tr key={r.creative_id} className="border-t border-white/5">
                      {staff && <td className="px-3 py-2 text-white/50">{org?.display_name ?? "—"}</td>}
                      <td className="px-3 py-2">
                        <Link href={`/creatives/${r.creative_id}`} className="text-sky-300 hover:underline">
                          {c?.hook_line || `#${c?.sheet_id ?? ""}`}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-white/70">{fam?.name ?? "—"}</td>
                      <td className="px-3 py-2 text-white/70">{r.hook_angle ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {r.cpt_cents == null ? "—" : `$${(r.cpt_cents / 100).toFixed(2)}`}
                      </td>
                      <td className="px-3 py-2 text-right text-white/70">{r.results}</td>
                      <td className="px-3 py-2 text-right text-white/70">
                        ${(r.spend_cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{r.score.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
