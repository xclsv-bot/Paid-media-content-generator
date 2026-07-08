import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import WinnersRefresh from "@/components/WinnersRefresh";
import GoldenCurationButtons from "@/components/GoldenCurationButtons";

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

type GoldenRow = {
  creative_id: string;
  why_it_won: string;
  script: string;
  source: "auto" | "curated";
  status: "active" | "pinned" | "removed";
  cpt_cents: number;
  results: number;
  dimensions: { family: string | null; hook_line: string | null; hook_angle: string | null; sport: string | null };
  organizations: { display_name: string } | { display_name: string }[] | null;
};

type BadRow = {
  id: string;
  kind: "proven_loser" | "review_rejection" | "manual_kill";
  creative_id: string;
  reason: string;
  cpt_cents: number | null;
  target_cents: number | null;
  results: number | null;
  dimensions: { family: string | null; hook_line: string | null };
  organizations: { display_name: string } | { display_name: string }[] | null;
};

const STATUS_BADGE: Record<GoldenRow["status"], string> = {
  pinned: "bg-sky-400/15 text-sky-300",
  active: "bg-emerald-400/15 text-emerald-300",
  removed: "bg-white/10 text-white/40",
};

export default async function WinnersPage() {
  const user = await getCurrentUser();
  const staff = isStaff(user);
  const supabase = await createClient();

  const [{ data: goldenData }, { data: badData }] = await Promise.all([
    supabase
      .from("golden_examples")
      .select(
        "creative_id, why_it_won, script, source, status, cpt_cents, results, dimensions, organizations(display_name)",
      )
      .order("score", { ascending: false }),
    supabase
      .from("bad_examples")
      .select("id, kind, creative_id, reason, cpt_cents, target_cents, results, dimensions, organizations(display_name)")
      .order("captured_at", { ascending: false })
      .limit(30),
  ]);
  // RLS scopes these: staff see everything (incl. removed tombstones, greyed
  // below), creators see non-removed golden rows, clients see none.
  const goldenRows = (goldenData ?? []) as unknown as GoldenRow[];
  const badRows = (badData ?? []) as unknown as BadRow[];

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

      {goldenRows.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-medium">Golden Set</h2>
          <p className="mb-2 text-[13px] text-white/50">
            The winning scripts themselves — what Ideate and the reviewer ground on. Pin to protect
            an example from refresh drift; Remove to veto it (it can never be auto re-added).
          </p>
          <div className="flex flex-col gap-2">
            {goldenRows.map((g) => {
              const org = one(g.organizations);
              const dim = g.dimensions ?? {};
              const tombstone = g.status === "removed";
              return (
                <div
                  key={g.creative_id}
                  className={`rounded-[12px] border border-white/10 p-3.5 ${tombstone ? "opacity-45" : "bg-white/[0.025]"}`}
                >
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${STATUS_BADGE[g.status]}`}>
                      {g.status}
                    </span>
                    {staff && <span className="text-[11.5px] text-white/40">{org?.display_name ?? "—"}</span>}
                    <Link href={`/creatives/${g.creative_id}`} className="text-[14px] font-medium text-sky-300 hover:underline">
                      “{dim.hook_line ?? "?"}”
                    </Link>
                    <span className="text-[12px] text-white/45">
                      {dim.family ?? "—"} / {dim.hook_angle ?? "—"} / {dim.sport ?? "—"} · CPT ${(g.cpt_cents / 100).toFixed(2)} · {g.results} trials
                    </span>
                    {staff && (
                      <span className="ml-auto">
                        <GoldenCurationButtons creativeId={g.creative_id} status={g.status} />
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-white/60">{g.why_it_won}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {badRows.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-1 text-lg font-medium">Bad examples</h2>
          <p className="mb-2 text-[13px] text-white/50">
            What not to make again — mature, volume-gated proven losers, content the paid team
            killed, and compliance-rejected scripts. These feed Ideate and the reviewer as patterns to avoid.
          </p>
          <div className="flex flex-col gap-2">
            {badRows.map((b) => {
              const org = one(b.organizations);
              const dim = b.dimensions ?? {};
              const perfBad = b.kind === "proven_loser" || b.kind === "manual_kill";
              const tag =
                b.kind === "proven_loser" ? "proven loser" : b.kind === "manual_kill" ? "killed" : "rejected";
              return (
                <div key={b.id} className="rounded-[12px] border border-white/10 bg-white/[0.025] p-3.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${perfBad ? "bg-red-400/15 text-red-300" : "bg-amber-400/15 text-amber-300"}`}>
                      {tag}
                    </span>
                    {staff && <span className="text-[11.5px] text-white/40">{org?.display_name ?? "—"}</span>}
                    <Link href={`/creatives/${b.creative_id}`} className="text-[14px] font-medium text-sky-300 hover:underline">
                      “{dim.hook_line ?? "?"}”
                    </Link>
                    {perfBad && b.cpt_cents != null && b.target_cents != null && (
                      <span className="text-[12px] text-white/45">
                        CPT ${(b.cpt_cents / 100).toFixed(2)} vs ${(b.target_cents / 100).toFixed(2)} target · {b.results ?? "?"} trials
                      </span>
                    )}
                  </div>
                  <p className="text-[12.5px] text-white/60">{b.reason}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
