import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultTargetCents, rollupBy, type CreativePerf } from "@/lib/metrics/perf";
import { isMature, minTrials, rankScore } from "@/lib/loop/attribution";
import { EMPTY_CACHE_NOTE, getCachedWinners, winnerLine, type CachedWinner } from "@/lib/loop/winners-cache";
import { badExampleLine, EMPTY_BAD_NOTE, getBadExamples, type BadExample } from "@/lib/loop/bad";

type Dim = {
  id: string;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  feature_pillar: string | null;
  format: string | null;
  cpt_target_cents: number | null;
  concept_families: { name: string } | { name: string }[] | null;
};
type PerfRow = CreativePerf & { first_date: string | null };

function famName(d: Dim | undefined): string | null {
  const f = d?.concept_families;
  if (!f) return null;
  return Array.isArray(f) ? f[0]?.name ?? null : f.name;
}

const DIMENSIONS: { label: string; pick: (d: Dim | undefined) => string | null }[] = [
  { label: "Family", pick: (d) => famName(d) },
  { label: "Hook angle", pick: (d) => d?.hook_angle ?? null },
  { label: "Audience", pick: (d) => d?.archetype ?? null },
  { label: "Sport", pick: (d) => d?.sport ?? null },
  { label: "Feature", pick: (d) => d?.feature_pillar ?? null },
  { label: "Format", pick: (d) => d?.format ?? null },
];

export type LearningInputs = {
  maturedCount: number;
  targetDollars: string;
  scoreboardText: string;
  winnersText: string;
  losersText: string;
};

// Assemble everything the analyst agent reasons from: the gated per-dimension
// scoreboard, plus the top winners/losers with their scripts.
//
// orgId MUST filter both queries explicitly, not just rely on RLS — the cron
// path (src/app/api/cron/loop/route.ts) calls this with a service-role client
// that bypasses RLS entirely, so this is the only thing standing between one
// org's scripts/CPT figures and another's.
export async function getLearningInputs(supabase: SupabaseClient, orgId: string): Promise<LearningInputs> {
  const [{ data: perfRows }, { data: dimRows }] = await Promise.all([
    supabase.from("creative_performance").select("creative_id, spend, impressions, clicks, results, ctr, cpt, last_updated, first_date").eq("org_id", orgId),
    supabase.from("creatives").select("id, hook_line, hook_angle, archetype, sport, feature_pillar, format, cpt_target_cents, concept_families(name)").eq("org_id", orgId),
  ]);

  const dims = new Map<string, Dim>();
  for (const d of (dimRows ?? []) as unknown as Dim[]) dims.set(d.id, d);
  const fallback = defaultTargetCents();
  const targetForRow = (id: string) => dims.get(id)?.cpt_target_cents ?? fallback;

  const perf = (perfRows ?? []) as unknown as PerfRow[];
  const now = new Date();
  const bar = minTrials();
  const matured = perf.filter((p) => isMature(p.first_date, now) && Number(p.results ?? 0) >= bar);

  const scoreboardText = DIMENSIONS.map((dd) => {
    const rows = rankScore(rollupBy(matured.map((p) => ({ ...p, dimension: dd.pick(dims.get(p.creative_id)) })), targetForRow));
    const lines = rows.map((r) => {
      const hr = r.judged > 0 ? Math.round((r.hits / r.judged) * 100) : 0;
      return `  ${r.key}: ${hr}% hit (${r.hits}/${r.judged}), CPT ${r.cpt != null ? `$${r.cpt.toFixed(2)}` : "—"}, ${r.results} trials`;
    });
    return `${dd.label}:\n${lines.join("\n")}`;
  }).join("\n\n");

  // Winners come from the Winners Cache; losers come from the Bad-Example
  // store — the triple-gated (mature + volume + over-target) set that only
  // /api/winners/refresh computes. Neither list is ever an inline CPT slice
  // over raw performance, which lacks those gates.
  const [cache, bad] = await Promise.all([
    getCachedWinners(supabase, orgId, 5),
    getBadExamples(supabase, orgId, 5),
  ]);
  const losers = bad.examples.filter((b) => b.kind === "proven_loser");

  const winnerIds = cache.winners.map((w) => w.creative_id);
  const scriptByConcept = new Map<string, string>();
  if (winnerIds.length) {
    const { data: scripts } = await supabase
      .from("scripts")
      .select("concept_id, body, version")
      .in("concept_id", winnerIds)
      .order("version", { ascending: false });
    for (const s of (scripts ?? []) as { concept_id: string; body: string }[]) {
      if (!scriptByConcept.has(s.concept_id)) scriptByConcept.set(s.concept_id, s.body);
    }
  }
  const fmtWinner = (w: CachedWinner) => {
    const scr = scriptByConcept.get(w.creative_id);
    return winnerLine(w) + (scr ? `\n  Script: ${scr.slice(0, 400)}` : "");
  };
  // Bad-example rows snapshot their own losing script — no join needed.
  const fmtLoser = (b: BadExample) => badExampleLine(b) + `\n  Script: ${b.script.slice(0, 400)}`;

  const winnersText = cache.error
    ? `(winners cache unavailable: ${cache.error})`
    : cache.winners.length
      ? cache.winners.map(fmtWinner).join("\n")
      : EMPTY_CACHE_NOTE;
  const losersText = bad.error
    ? `(bad-example store unavailable: ${bad.error})`
    : losers.length
      ? losers.map(fmtLoser).join("\n")
      : EMPTY_BAD_NOTE;

  return {
    maturedCount: matured.length,
    targetDollars: fallback != null ? `$${(fallback / 100).toFixed(2)}` : "target",
    scoreboardText: scoreboardText || "(no matured cohorts)",
    winnersText,
    losersText,
  };
}
