import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { parseNamingConvention } from "@/lib/client/categorize";
import { latestLearnings, type Learning } from "@/lib/loop/learnings";
import LearningsPanel from "@/components/LearningsPanel";
import OrgPicker from "@/components/OrgPicker";
import PromotePatternButton from "@/components/PromotePatternButton";
import VerdictSelect from "@/components/VerdictSelect";
import ReportImporter from "@/components/ReportImporter";
import PeriodPicker from "@/components/PeriodPicker";
import { type Verdict } from "@/lib/metrics/verdict";

export const dynamic = "force-dynamic";

// One report row = one ad name for one flight (the unit of measurement).
type Metric = {
  ad_name: string;
  flight_label: string;
  flight_start: string | null;
  created_at: string | null;
  spend: number | null;
  conversions: number | null;
  cpa: number | null;
  ctr: number | null;
  bau_cpa: number | null;
  verdict: string | null;
  verdict_source: string | null;
  reason: string | null;
  cpm: number | null;
  cpi: number | null;
  cps: number | null;
  icvr: number | null;
  scvr: number | null;
  aov: number | null;
  roas: number | null;
};

const VERDICTS = ["GRADUATE", "ITERATE", "KEEP_TESTING", "KILL"] as const;
const VERDICT_LABEL: Record<string, string> = { GRADUATE: "Graduated", ITERATE: "Iterate", KEEP_TESTING: "Keep testing", KILL: "Stopped" };
const VERDICT_PILL: Record<string, string> = {
  GRADUATE: "bg-emerald-500/15 text-emerald-300",
  ITERATE: "bg-orange-500/15 text-orange-300",
  KEEP_TESTING: "bg-sky-500/15 text-sky-300",
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
  searchParams: Promise<{ org?: string; view?: string; flight?: string }>;
}) {
  const user = await requireStaff();
  const supabase = await createClient();
  const { org: orgParam, view: viewParam, flight: flightParam } = await searchParams;

  // Learnings/pattern-promotion are per-org. Staff can view any client org
  // (default: the first non-agency org); a client_viewer only ever has their
  // own org's context, so the selector below is staff-only.
  const { data: clientOrgs } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .eq("is_agency", false)
    .order("display_name");
  const orgId =
    clientOrgs?.find((o) => o.slug === orgParam)?.id ??
    clientOrgs?.[0]?.id ??
    user.org_id ??
    null;

  // Report rows are stamped with their org at import (0026), so the page
  // shows EVERYTHING imported for this client — including rows whose ad name
  // doesn't match a concept yet (those just don't get a concept link).
  const [{ data: creativeRows }, { data: metricRows }, learning] = await Promise.all([
    supabase
      .from("creatives")
      .select("id, ad_name, hook_line")
      .not("ad_name", "is", null)
      .eq("org_id", orgId ?? ""),
    supabase
      .from("creative_metrics")
      .select(
        "ad_name, flight_label, flight_start, created_at, spend, conversions, cpa, ctr, bau_cpa, verdict, verdict_source, reason, cpm, cpi, cps, icvr, scvr, aov, roas",
      )
      .eq("org_id", orgId ?? "")
      .order("spend", { ascending: false, nullsFirst: false }),
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

  // Two views over the same rows: a single weekly report, or contract-to-date
  // (every week since the contract started, mid-June). Photo imports carry no
  // flight_start, so recency falls back to when the row was imported.
  const recency = (m: Metric) => m.flight_start ?? m.created_at ?? "";
  const view: "week" | "total" = viewParam === "total" ? "total" : "week";

  // Weeks (flight labels), newest first.
  const flightRecency = new Map<string, string>();
  for (const m of all) {
    const r = recency(m);
    if (r > (flightRecency.get(m.flight_label) ?? "")) flightRecency.set(m.flight_label, r);
  }
  const flights = [...flightRecency.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(([label]) => label);
  const selectedFlight = flightParam && flights.includes(flightParam) ? flightParam : flights[0] ?? null;
  const weeksInPeriod = view === "week" ? 1 : flights.length;
  const firstWeek = flights[flights.length - 1] ?? null;

  let metrics: Metric[];
  if (view === "week") {
    metrics = all.filter((m) => m.flight_label === selectedFlight);
  } else {
    // One row per ad across the whole contract. The report's Spend/Conv are
    // FLIGHT-to-date running totals (a graduation report re-states each
    // still-testing ad with updated cumulative numbers every week), so the
    // ad's most recent row already carries its contract-to-date performance —
    // summing weeks would double-count. Killed ads keep their final week's
    // row, so nothing drops out of the totals.
    const byAd = new Map<string, Metric>();
    for (const m of all) {
      const prev = byAd.get(m.ad_name);
      if (!prev || recency(m) > recency(prev)) byAd.set(m.ad_name, m);
    }
    metrics = [...byAd.values()].sort((a, b) => Number(b.spend || 0) - Number(a.spend || 0));
  }

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

  // ---- Signals: the paid team's reads, computed live from the same rows ----
  // Confidence is keyed to spend: ~3.5× the CPA target is the gate where a
  // read starts to mean something; 5× the gate is full confidence. Below the
  // gate a great CPA is a promising signal, not a proven one.
  const gate = targetDollars != null ? targetDollars * 3.5 : null;
  const spendBand = (spend: number): "Proven" | "Testing" | "Early" | null =>
    gate == null ? null : spend >= gate * 5 ? "Proven" : spend >= gate ? "Testing" : "Early";
  const pctWorse = (worse: number, better: number) => Math.round(((worse - better) / better) * 100);
  const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  type Signal = { title: string; headline: string; detail: string; accent?: boolean };
  const signals: Signal[] = [];

  // 1. Dominant hook (theme): the one with the most trials vs everything else blended.
  const themed = byTheme.filter((r) => r.key !== "—" && r.conv > 0);
  if (themed.length >= 1 && byTheme.length >= 2) {
    const top = [...themed].sort((a, b) => b.conv - a.conv)[0];
    const rest = byTheme.filter((r) => r.key !== top.key);
    const rSpend = rest.reduce((s, r) => s + r.spend, 0);
    const rConv = rest.reduce((s, r) => s + r.conv, 0);
    if (top.cpa != null && rConv > 0) {
      const rCpa = rSpend / rConv;
      signals.push({
        title: `“${top.key}” is the lead hook`,
        headline: `${usd(top.cpa)} / trial`,
        detail: `${top.n} ad${top.n === 1 ? "" : "s"} · ${usd(top.spend)} (${share(top.spend, totSpend)}% of spend) → ${top.conv} trials. Every other hook blended: ${usd(rCpa)} — ${pctWorse(rCpa, top.cpa)}% more expensive. The hook is the format that works, not one good ad.`,
        accent: targetDollars != null && top.cpa <= targetDollars,
      });
    }
  }

  // 2. Workhorse: the single ad carrying the most trials.
  if (totConv > 0 && metrics.length > 1) {
    const work = [...metrics].sort((a, b) => Number(b.conversions || 0) - Number(a.conversions || 0))[0];
    const wConv = Number(work.conversions || 0);
    if (wConv > 0) {
      signals.push({
        title: "Workhorse",
        headline: shortName(work.ad_name),
        detail: `${usd(work.spend)} → ${wConv} trials at ${usd(work.cpa)} — ${share(wConv, totConv)}% of all trials this period.${spendBand(Number(work.spend || 0)) === "Proven" ? " Fully proven volume." : ""}`,
        accent: work.cpa != null && targetDollars != null && Number(work.cpa) <= targetDollars,
      });
    }
  }

  // 3. Best unit economics — cheapest trials with at least a couple of them,
  // labeled honestly when the spend is too small to call it proven.
  const efficient = metrics
    .filter((m) => Number(m.conversions || 0) >= 2 && m.cpa != null)
    .sort((a, b) => Number(a.cpa) - Number(b.cpa))[0];
  if (efficient) {
    const b = spendBand(Number(efficient.spend || 0));
    const roas = efficient.roas != null ? ` · ROAS ${Number(efficient.roas).toFixed(2)}` : "";
    signals.push({
      title: "Best unit economics",
      headline: `${usd(efficient.cpa)} / trial`,
      detail: `${shortName(efficient.ad_name)} — ${usd(efficient.spend)} → ${efficient.conversions} trials${roas}.${b === "Early" ? ` Only ${usd(efficient.spend)} in, so promising rather than proven — the cheapest trials in the set usually earn the next test budget.` : ""}`,
      accent: efficient.cpa != null && targetDollars != null && Number(efficient.cpa) <= targetDollars,
    });
  }

  // 4. Sport edge: best-converting sport vs the rest blended.
  const sported = bySport.filter((r) => r.key !== "—" && r.conv > 0);
  if (sported.length >= 1 && bySport.length >= 2) {
    const top = [...sported].sort((a, b) => b.conv - a.conv)[0];
    const rest = bySport.filter((r) => r.key !== top.key);
    const rSpend = rest.reduce((s, r) => s + r.spend, 0);
    const rConv = rest.reduce((s, r) => s + r.conv, 0);
    if (top.cpa != null && rConv > 0) {
      const rCpa = rSpend / rConv;
      signals.push({
        title: `${top.key} carries the account`,
        headline: `${usd(top.cpa)} blended`,
        detail: `${usd(top.spend)} on ${top.key} → ${top.conv} trials. Other sports blend to ${usd(rCpa)} — ${pctWorse(rCpa, top.cpa)}% worse. The sport is doing work, not just the hook.`,
        accent: targetDollars != null && top.cpa <= targetDollars,
      });
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-6 pb-24">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Performance</h1>
          <p className="text-sm text-white/50">
            Creative testing — graduation report
            {view === "week"
              ? selectedFlight ? ` · ${selectedFlight}` : ""
              : ` · Contract to date · ${weeksInPeriod} weekly report${weeksInPeriod === 1 ? "" : "s"}${firstWeek && weeksInPeriod > 1 ? ` since ${firstWeek}` : ""}`}
            . CPA target {targetDollars != null ? usd(targetDollars) : "—"}.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {clientOrgs && clientOrgs.length > 1 && (
            <OrgPicker organizations={clientOrgs} currentSlug={clientOrgs.find((o) => o.id === orgId)?.slug ?? ""} />
          )}
          {orgId && <ReportImporter orgId={orgId} />}
        </div>
      </header>

      {all.length > 0 && (
        <PeriodPicker view={view} weeks={flights} currentWeek={selectedFlight} />
      )}

      {metrics.length === 0 ? (
        <p className="mb-6 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-white/50">
          No report loaded yet — click “Import weekly report” above and add this week&apos;s photo or rows to light this page up.
        </p>
      ) : (
        <>
          {/* Grand totals */}
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="Spend" value={usd(totSpend)} />
            <Tile label="Conversions" value={num(totConv)} />
            <Tile label="Blended CPA" value={usd(blendedCpa)} accent={blendedCpa != null && targetDollars != null && blendedCpa <= targetDollars} />
            <Tile label={view === "total" ? "Graduated (all ads)" : "Graduated"} value={`${grads} / ${metrics.length}`} accent={grads > 0} />
          </div>

          {/* Signals — the paid team's reads, computed from this period's rows */}
          {signals.length > 0 && (
            <section className="mb-10">
              <h2 className="mb-1 text-lg font-medium">Signals</h2>
              <p className="mb-4 text-xs text-white/45">
                Computed from {view === "week" ? "this week's report" : "the whole contract"} — dominant hook, workhorse, unit economics, sport edge.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {signals.map((s) => (
                  <div key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{s.title}</div>
                    <div className={`mt-1 text-lg font-semibold ${s.accent ? "text-emerald-300" : "text-gray-50"}`}>{s.headline}</div>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/60">{s.detail}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

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
                                <div className="mt-1.5">
                                  <VerdictSelect
                                    adName={m.ad_name}
                                    flightLabel={m.flight_label}
                                    verdict={(m.verdict as Verdict | null) ?? null}
                                    source={m.verdict_source}
                                    canEdit
                                  />
                                </div>
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
              <RollupCard title="By theme" rows={byTheme} target={targetDollars} totalSpend={totSpend} gate={gate} />
              <RollupCard title="By sport" rows={bySport} target={targetDollars} totalSpend={totSpend} gate={gate} />
            </div>
          </section>

          {/* Agent learnings narrative */}
          {orgId && (
            <>
              {(
                <div className="mb-3 flex justify-end">
                  <PromotePatternButton orgId={orgId} />
                </div>
              )}
              <LearningsPanel learning={learning as Learning | null} canGenerate={true} orgId={orgId} />
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
  totalSpend,
  gate,
}: {
  title: string;
  rows: { key: string; spend: number; conv: number; grads: number; n: number; cpa: number | null }[];
  target: number | null;
  totalSpend: number;
  gate: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <div className="border-b border-white/10 bg-white/5 px-3 py-2 text-sm font-medium">{title}</div>
      <table className="w-full text-left text-sm">
        <thead className="text-white/50">
          <tr>
            <th className="px-3 py-1.5 font-normal">Value</th>
            <th className="px-3 py-1.5 text-right font-normal">Spend</th>
            <th className="px-3 py-1.5 text-right font-normal">Conv</th>
            <th className="px-3 py-1.5 text-right font-normal">CPA</th>
            <th className="px-3 py-1.5 text-right font-normal">Grad</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const good = r.cpa != null && target != null && r.cpa <= target;
            const early = gate != null && r.spend < gate;
            const pct = totalSpend > 0 ? Math.round((r.spend / totalSpend) * 100) : 0;
            return (
              <tr key={r.key} className="border-t border-white/5">
                <td className="px-3 py-1.5">
                  {r.key}
                  {early && (
                    <span className="ml-1.5 rounded bg-white/10 px-1 py-0.5 align-middle text-[9.5px] uppercase tracking-wide text-white/45" title="Spend is below the confidence gate — treat the CPA as a signal, not proof">
                      early
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-white/60">
                  {usd(r.spend)} <span className="text-[11px] text-white/35">{pct}%</span>
                </td>
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
