import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultTargetCents, rollupBy, type CreativePerf } from "@/lib/metrics/perf";
import { isMature, minTrials, rankScore } from "@/lib/loop/attribution";
import { getGoldenExamples, type GoldenExample } from "@/lib/loop/golden";
import { getBadExamples, type BadExample } from "@/lib/loop/bad";
import { getFamilySlots } from "@/lib/loop/slots";
import { sourceRef } from "@/lib/loop/sourceRef";

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

// A backing row a recommendation can cite. `id` is a self-describing ref of the
// form `<kind>:<key>` (e.g. `golden:<creative_id>`, `explore:<family>`) — it is
// what the rec stores in `sources`, what the analyst must cite, and what a cold
// reader splits on to know WHICH store to query (`golden`/`loser`/`rejection` →
// creative_id; `explore`/`validating` → concept family name). Keeping the kind
// in the ID means the trace survives being flattened or exported away from its
// column. `metric` is the authoritative figure attached at write time; `prompt`
// is the richer line (script/reason context) the analyst reasons from.
export type RecSource = { id: string; label: string; metric: string; prompt: string };

export type LearningInputs = {
  maturedCount: number;
  targetDollars: string;
  scoreboardText: string;
  // Candidate rows per rec type, each carrying the ID a rec must cite. The
  // analyst may only ground a recommendation in one of these IDs; generate.ts
  // drops any rec that cites something outside these sets.
  golden: RecSource[]; // proven winners → do_more (variant the golden family, by creative_id)
  losers: RecSource[]; // proven losers → do_less (by creative_id)
  rejections: RecSource[]; // compliance rejections → watchouts (by creative_id)
  explore: RecSource[]; // Untested family slots → explore (the named unfilled slot)
  validating: RecSource[]; // Validating family slots → watchouts (small-sample, by family)
};

function dollars(cents: number | null | undefined): string {
  return cents != null ? `$${(cents / 100).toFixed(2)}` : "—";
}

// Assemble everything the analyst agent reasons from: the gated per-dimension
// scoreboard, plus the ID-carrying candidate rows for each recommendation type
// (golden winners, proven losers, compliance rejections, explore/validating
// slots) so every emitted rec can cite the exact row behind it.
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

  // Every rec type is grounded in a store the loop already computes with IDs:
  //   do_more   ← Golden Set (proven winners, WITH script)     — by creative_id
  //   do_less   ← Bad-Example proven losers                    — by creative_id
  //   watchouts ← Bad-Example compliance rejections + Validating slots
  //   explore   ← Untested family slots (the named unfilled slots)
  // None is an inline CPT slice over raw performance (which lacks the gates).
  const [golden, bad, slotsRes] = await Promise.all([
    getGoldenExamples(supabase, orgId, 6),
    getBadExamples(supabase, orgId, 6),
    getFamilySlots(supabase, orgId),
  ]);

  const goldenSrc: RecSource[] = golden.examples.map((g: GoldenExample) => {
    const d = g.dimensions ?? {};
    const label = `"${d.hook_line ?? "?"}" — ${d.family ?? "?"} / ${d.hook_angle ?? "?"} / ${d.sport ?? "?"}`;
    const metric = `CPT ${dollars(g.cpt_cents)} vs ${dollars(g.target_cents)} target, ${g.results} trials`;
    const ref = sourceRef("golden", g.creative_id);
    return {
      id: ref,
      label,
      metric,
      prompt: `[${ref}] ${label} · ${metric}\n  Why it won: ${g.why_it_won}\n  Script: ${g.script.slice(0, 300)}`,
    };
  });

  const loserRows = bad.examples.filter((b: BadExample) => b.kind === "proven_loser");
  const losersSrc: RecSource[] = loserRows.map((b) => {
    const d = b.dimensions ?? {};
    const label = `"${d.hook_line ?? "?"}" — ${d.family ?? "?"} / ${d.hook_angle ?? "?"} / ${d.sport ?? "?"}`;
    const metric = `CPT ${dollars(b.cpt_cents)} vs ${dollars(b.target_cents)} target, ${b.results ?? "?"} trials`;
    const ref = sourceRef("loser", b.creative_id);
    return {
      id: ref,
      label,
      metric,
      prompt: `[${ref}] ${label} · ${metric} — ${b.reason}\n  Script: ${b.script.slice(0, 300)}`,
    };
  });

  const rejectionRows = bad.examples.filter((b: BadExample) => b.kind === "review_rejection");
  const rejectionsSrc: RecSource[] = rejectionRows.map((b) => {
    const d = b.dimensions ?? {};
    const label = `"${d.hook_line ?? "?"}" — ${d.family ?? "?"}`;
    const ref = sourceRef("rejection", b.creative_id);
    return {
      id: ref,
      label,
      metric: "compliance rejection",
      prompt: `[${ref}] ${label} — rejected: ${b.reason}`,
    };
  });

  // Slots: Untested → explore (the named unfilled slots), Validating → watchout
  // (has matured data but hasn't cleared the bar — small-sample risk). The slot
  // ID a rec cites is the family NAME (slots aren't a per-creative row).
  const exploreSrc: RecSource[] = slotsRes.slots
    .filter((s) => s.status === "Untested")
    .map((s) => ({
      id: sourceRef("explore", s.family),
      label: `${s.family} (no matured cohort yet)`,
      metric: "unfilled explore slot",
      prompt: `[${sourceRef("explore", s.family)}] Untested family — no matured, trial-gated cohort yet`,
    }));
  const validatingSrc: RecSource[] = slotsRes.slots
    .filter((s) => s.status === "Validating")
    .map((s) => ({
      id: sourceRef("validating", s.family),
      label: `${s.family} (${s.hits}/${s.judged} hit)`,
      metric: `Validating: ${s.hits}/${s.judged} hit, CPT ${s.cpt != null ? `$${s.cpt.toFixed(2)}` : "—"}`,
      prompt: `[${sourceRef("validating", s.family)}] ${s.hits}/${s.judged} hit — matured but not yet proven`,
    }));

  return {
    maturedCount: matured.length,
    targetDollars: fallback != null ? `$${(fallback / 100).toFixed(2)}` : "target",
    scoreboardText: scoreboardText || "(no matured cohorts)",
    golden: goldenSrc,
    losers: losersSrc,
    rejections: rejectionsSrc,
    explore: exploreSrc,
    validating: validatingSrc,
  };
}
