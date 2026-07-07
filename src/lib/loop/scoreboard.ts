import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultTargetCents, rollupBy, type CreativePerf } from "@/lib/metrics/perf";
import { isMature, minTrials, rankScore } from "@/lib/loop/attribution";
import { EMPTY_CACHE_NOTE, getCachedWinners, winnerLine, type CachedWinner } from "@/lib/loop/winners-cache";

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
export async function getLearningInputs(supabase: SupabaseClient): Promise<LearningInputs> {
  const [{ data: perfRows }, { data: dimRows }] = await Promise.all([
    supabase.from("creative_performance").select("creative_id, spend, impressions, clicks, results, ctr, cpt, last_updated, first_date"),
    supabase.from("creatives").select("id, hook_line, hook_angle, archetype, sport, feature_pillar, format, cpt_target_cents, concept_families(name)"),
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

  // Winners come from the Winners Cache — the volume-gated set that only
  // /api/winners/refresh computes — never an inline best-CPT slice, which
  // could crown a small-sample fluke. Losers stay derived from the matured,
  // trial-gated cohorts (worst CPT first), minus anything the cache calls a
  // winner so the two lists can't contradict each other.
  const cache = await getCachedWinners(supabase, 5);
  const winnerIds = new Set(cache.winners.map((w) => w.creative_id));
  const losers = matured
    .filter((p) => p.cpt != null && !winnerIds.has(p.creative_id))
    .sort((a, b) => Number(b.cpt) - Number(a.cpt))
    .slice(0, 5);

  const ids = [...new Set([...cache.winners.map((w) => w.creative_id), ...losers.map((p) => p.creative_id)])];
  const scriptByConcept = new Map<string, string>();
  if (ids.length) {
    const { data: scripts } = await supabase
      .from("scripts")
      .select("concept_id, body, version")
      .in("concept_id", ids)
      .order("version", { ascending: false });
    for (const s of (scripts ?? []) as { concept_id: string; body: string }[]) {
      if (!scriptByConcept.has(s.concept_id)) scriptByConcept.set(s.concept_id, s.body);
    }
  }
  const scriptSuffix = (id: string) => {
    const scr = scriptByConcept.get(id);
    return scr ? `\n  Script: ${scr.slice(0, 400)}` : "";
  };
  const fmtWinner = (w: CachedWinner) => winnerLine(w) + scriptSuffix(w.creative_id);
  const fmtLoser = (p: PerfRow) => {
    const c = dims.get(p.creative_id);
    return `• "${c?.hook_line ?? "?"}" — ${famName(c) ?? "?"} / ${c?.hook_angle ?? "?"} / ${c?.archetype ?? "?"} / ${c?.sport ?? "?"} · CPT $${Number(p.cpt).toFixed(2)} (${p.results} trials)` +
      scriptSuffix(p.creative_id);
  };

  const winnersText = cache.error
    ? `(winners cache unavailable: ${cache.error})`
    : cache.winners.length
      ? cache.winners.map(fmtWinner).join("\n")
      : EMPTY_CACHE_NOTE;

  return {
    maturedCount: matured.length,
    targetDollars: fallback != null ? `$${(fallback / 100).toFixed(2)}` : "target",
    scoreboardText: scoreboardText || "(no matured cohorts)",
    winnersText,
    losersText: losers.map(fmtLoser).join("\n") || "(none)",
  };
}
