import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { parseNamingConvention } from "@/lib/client/categorize";
import { latestLearnings, type Learning } from "@/lib/loop/learnings";
import LearningsPanel from "@/components/LearningsPanel";
import OrgPicker from "@/components/OrgPicker";
import PromotePatternButton from "@/components/PromotePatternButton";

export const dynamic = "force-dynamic";

// One report row = one ad name for one flight (the unit of measurement).
type Metric = {
  ad_name: string;
  flight_label: string;
  flight_start: string | null;
  spend: number | null;
  conversions: number | null;
  cpa: number | null;
  ctr: number | null;
  bau_cpa: number | null;
  verdict: string | null;
  reason: string | null;
  cpm: number | null;
  cpi: number | null;
  cps: number | null;
  icvr: number | null;
  scvr: number | null;
  aov: number | null;
  roas: number | null;
};

const VERDICTS = ["GRADUATE", "KEEP_TESTING", "KILL"] as const;
const VERDICT_LABEL: Record<string, string> = { GRADUATE: "Graduated", KEEP_TESTING: "Keep testing", KILL: "Killed" };
const VERDICT_PILL: Record<string, string> = {
  GRADUATE: "bg-emerald-500/15 text-emerald-300",
  KEEP_TESTING: "bg-amber-500/15 text-amber-300",
  KILL: "bg-red-500/15 text-red-300",
};
const VERDICT_BAR: Record<string, string> = {
  GRADUATE: "bg-emerald-400/80",
  KEEP_TESTING: "bg-amber-400/80",
  KILL: "bg-red-400/70",
};

const usd = (n: number | null | undefined) =>
  n == null ? "—" : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (r: number | null | undefined) => (r == null ? "—" : `${(Number(r) * 100).toFixed(2)}%`);
const num = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString());

// Short, human ad label — drop the "XCLSV _ XCLSV _" and date noise.
function shortName(adName: string): string {
  const parts = adName.split(/\s*_\s*/).map((s) => s.trim());
  const body = parts.slice(2).filter((p) => !/^\d/.test(p)); // drop leading brand tokens + trailing date
  return body.join(" · ");
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const user = await getCurrentUser();
  const staff = isStaff(user);
  const supabase = await createClient();
  const { org: orgParam } = await searchParams;

  // Learnings/pattern-promotion are per-org. Staff can view any client org
  // (default: the first non-agency org); a client_viewer only ever has their
  // own org's context, so the selector below is staff-only.
  const { data: clientOrgs } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .eq("is_agency", false)
    .order("display_name");
  const orgId =
    (staff ? clientOrgs?.find((o) => o.slug === orgParam)?.id : undefined) ??
    (staff ? clientOrgs?.[0]?.id : undefined) ??
    user?.org_id ??
    null;

  const [{ data: metricRows }, { data: creativeRows }, learning] = await Promise.all([
    supabase
      .from("creative_metrics")
      .select(
        "ad_name, flight_label, flight_start, spend, conversions, cpa, ctr, bau_cpa, verdict, reason, cpm, cpi, cps, icvr, scvr, aov, roas",
      )
      .order("spend", { ascending: false, nullsFirst: false }),
    supabase.from("creatives").select("id, ad_name, hook_line").not("ad_name", "is", null),
    orgId ? latestLearnings(supabase, orgId) : Promise.resolve(null),
  ]);

  const all = (metricRows ?? []) as Metric[];

  // The concept(s) behind each ad name — a name can map to more than one (same
  // creative "type"). Lets us click a graduated ad through to its brief/transcript.
  const conceptsByName = new Map<string, { id: string; hook_line: string | null }[]>();
  for (const c of (creativeRows ?? []) as { id: string; ad_name: string | null; hook_line: string | null }[]) {
    if (!c.ad_name) continue;
    const list = conceptsByName.get(c.ad_name) ?? [];
    list.push({ id: c.id, hook_line: c.hook_line });
    conceptsByName.set(c.ad_name, list);
  }

  // Default to the most recent flight.
  const flights = [...new Set(all.map((m) => m.flight_label))];
  const latestFlight =
    all.reduce<Metric | null>((best, m) => (!best || (m.flight_start ?? "") > (best.flight_start ?? "") ? m : best), null)
      ?.flight_label ?? flights[0] ?? null;
  const metrics = all.filter((m) => m.flight_label === latestFlight);

  const targetCents = defaultTargetCents();
  const targetDollars = targetCents != null ? targetCents / 100 : null;

  // Grand totals (blended, ratio-of-sums).
  const totSpend = metrics.reduce((s, m) => s + Number(m.spend || 0), 0);
  const totConv = metrics.reduce((s, m) => s + Number(m.conversions || 0), 0);
  const blendedCpa = totConv > 0 ? totSpend / totConv : null;
  const grads = metrics.filter((m) => m.verdict === "GRADUATE").length;

  // "What's working" — roll up by Theme and Sport from the name (each ad once).
  const rollup = (pick: (m: Metric) => string | null) => {
    const g = new Map<string, { key: string; spend: number; conv: number; grads: number; n: number }>();
    for (const m of metrics) {
      const key = pick(m) ?? "—";
      const row = g.get(key) ?? { key, spend: 0, conv: 0, grads: 0, n: 0 };
      row.spend += Number(m.spend || 0);
      row.conv += Number(m.conversions || 0);
      row.n += 1;
      if (m.verdict === "GRADUATE") row.grads += 1;
      g.set(key, row);
    }
    return [...g.values()]
      .map((r) => ({ ...r, cpa: r.conv > 0 ? r.spend / r.conv : null }))
      .sort((a, b) => (a.cpa ?? Infinity) - (b.cpa ?? Infinity));
  };
  const byTheme = rollup((m) => parseNamingConvention(m.ad_name).theme ?? null);
  const bySport = rollup((m) => parseNamingConvention(m.ad_name).sport ?? null);

  return (
    <main className="mx-auto max-w-6xl p-6 pb-24">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-white/50">
            Creative testing — graduation report{latestFlight ? ` · ${latestFlight}` : ""}. CPA target{" "}
            {targetDollars != null ? usd(targetDollars) : "—"}.
          </p>
        </div>
        {staff && clientOrgs && clientOrgs.length > 1 && (
          <OrgPicker organizations={clientOrgs} currentSlug={clientOrgs.find((o) => o.id === orgId)?.slug ?? ""} />
        )}
      </header>

      {metrics.length === 0 ? (
        <p className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          No report loaded yet. {isStaff(user) ? "Add a weekly report to populate this." : ""}
        </p>
      ) : (
        <>
          {/* Grand totals */}
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Spend" value={usd(totSpend)} />
            <Tile label="Conversions" value={num(totConv)} />
            <Tile label="Blended CPA" value={usd(blendedCpa)} accent={blendedCpa != null && targetDollars != null && blendedCpa <= targetDollars} />
            <Tile label="Graduated" value={`${grads} / ${metrics.length}`} accent={grads > 0} />
          </div>

          {/* Verdict groups */}
          <div className="mb-10 space-y-6">
            {VERDICTS.map((v) => {
              const rows = metrics.filter((m) => m.verdict === v);
              if (rows.length === 0) return null;
              return (
                <section key={v}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${VERDICT_BAR[v]}`} />
                    <h2 className="text-lg font-medium">{VERDICT_LABEL[v]}</h2>
                    <span className="font-mono text-xs text-white/40">{rows.length}</span>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-white/5 text-white/55">
                        <tr>
                          <th className="px-3 py-2 font-normal">Ad</th>
                          <th className="px-3 py-2 text-right font-normal">Spend</th>
                          <th className="px-3 py-2 text-right font-normal">Conv</th>
                          <th className="px-3 py-2 text-right font-normal">CPA</th>
                          <th className="px-3 py-2 text-right font-normal">CTR</th>
                          <th className="px-3 py-2 text-right font-normal">ROAS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((m) => {
                          const good = m.cpa != null && targetDollars != null && m.cpa <= targetDollars;
                          const concepts = conceptsByName.get(m.ad_name) ?? [];
                          return (
                            <tr key={m.ad_name} className="border-t border-white/5 align-top">
                              <td className="px-3 py-2">
                                <div className="font-medium text-gray-100">{shortName(m.ad_name)}</div>
                                <div className="truncate font-mono text-[10.5px] text-white/35" title={m.ad_name}>{m.ad_name}</div>
                                {concepts.length > 0 && (
                                  <div className="mt-1 flex flex-col gap-0.5">
                                    {concepts.map((c) => (
                                      <Link
                                        key={c.id}
                                        href={`/creatives/${c.id}`}
                                        className="w-fit text-[12px] text-sky-300 hover:underline"
                                        title="Open the concept — brief, transcript, and details"
                                      >
                                        → {c.hook_line ?? "Open concept"}
                                      </Link>
                                    ))}
                                  </div>
                                )}
                                {m.reason && <div className="mt-0.5 max-w-md text-[11.5px] text-white/45">{m.reason}</div>}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/80">{usd(m.spend)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/80">{num(m.conversions)}</td>
                              <td className={`px-3 py-2 text-right tabular-nums font-semibold ${m.cpa == null ? "text-white/40" : good ? "text-emerald-300" : "text-red-300"}`}>
                                {usd(m.cpa)}
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/70">{pct(m.ctr)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-white/70">{m.roas == null ? "—" : Number(m.roas).toFixed(2)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>

          {/* What's working — the backbone for new content */}
          <section className="mb-10">
            <h2 className="mb-1 text-lg font-medium">What&apos;s working</h2>
            <p className="mb-4 text-xs text-white/45">
              Blended CPA by the name&apos;s dimensions (each ad counted once). This is what feeds the next slate.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <RollupCard title="By theme" rows={byTheme} target={targetDollars} />
              <RollupCard title="By sport" rows={bySport} target={targetDollars} />
            </div>
          </section>

          {/* Agent learnings narrative */}
          {orgId && (
            <>
              {staff && (
                <div className="mb-3 flex justify-end">
                  <PromotePatternButton orgId={orgId} />
                </div>
              )}
              <LearningsPanel learning={learning as Learning | null} canGenerate={staff} orgId={orgId} />
            </>
          )}
        </>
      )}
    </main>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold ${accent ? "text-emerald-300" : "text-gray-50"}`}>{value}</div>
    </div>
  );
}

function RollupCard({
  title,
  rows,
  target,
}: {
  title: string;
  rows: { key: string; spend: number; conv: number; grads: number; n: number; cpa: number | null }[];
  target: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 text-sm font-medium">{title}</div>
      <table className="w-full text-left text-sm">
        <thead className="text-white/50">
          <tr>
            <th className="px-3 py-1.5 font-normal">Value</th>
            <th className="px-3 py-1.5 text-right font-normal">Conv</th>
            <th className="px-3 py-1.5 text-right font-normal">CPA</th>
            <th className="px-3 py-1.5 text-right font-normal">Grad</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const good = r.cpa != null && target != null && r.cpa <= target;
            return (
              <tr key={r.key} className="border-t border-white/5">
                <td className="px-3 py-1.5">{r.key}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{r.conv}</td>
                <td className={`px-3 py-1.5 text-right tabular-nums ${r.cpa == null ? "text-white/40" : good ? "text-emerald-300" : "text-red-300"}`}>
                  {usd(r.cpa)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-white/60">{r.grads}/{r.n}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
