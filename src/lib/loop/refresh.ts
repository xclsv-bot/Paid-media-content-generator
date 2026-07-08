import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { evaluateWinner } from "@/lib/winners";
import { isMature } from "@/lib/loop/attribution";
import { type GoldenQualifier } from "@/lib/loop/golden";
import { badMax, goldenMax, loserCptMultiplier, loserMatureDays, loserMinResults } from "@/lib/loop/config";

// The loop's daily refresh — evaluates every creative with performance and
// rebuilds the three example stores in one pass:
//   1. content_cache      — WHO is winning (performance snapshot; upsert+prune)
//   2. golden_examples    — WHAT won (script snapshot; via apply_golden_refresh,
//                           which protects curated pinned/removed rows)
//   3. bad_examples       — what lost / to avoid (via apply_bad_refresh, which
//                           re-enforces the mature+volume+over-target gates)
// Called by /api/winners/refresh (daily cron / staff / agent). Requires the
// service-role client: it reads all performance and calls the refresh RPCs.

export type StageResult = { upserted: number; pruned: number; skippedNoScript: number };
export type RefreshResult =
  | { evaluated: number; cached: number; golden: StageResult; bad: StageResult; manualKills: StageResult }
  | { error: string };

export async function refreshAll(admin: SupabaseClient): Promise<RefreshResult> {
  const [{ data: perfRows, error: perfErr }, { data: creatives, error: cErr }] =
    await Promise.all([
      admin.from("creative_performance").select("creative_id, spend, results, cpt, ctr, first_date"),
      admin
        .from("creatives")
        .select("id, org_id, ad_name, sport, format, hook_line, concept_family_id, hook_angle, archetype, cpt_target_cents, concept_families(name)"),
    ]);
  if (perfErr) return { error: perfErr.message };
  if (cErr) return { error: cErr.message };

  const perfById = new Map<string, { spend: number | null; results: number | null; cpt: number | null; ctr: number | null; first_date: string | null }>();
  for (const p of perfRows ?? []) perfById.set(p.creative_id, p);

  // Latest-flight user/report verdict per ad name — the human override the loop
  // must honor over its own gates. Rows are ordered newest flight first, so the
  // first row seen per ad name is the current call; an 'auto' latest flight
  // means "no override — let the gates decide" (newer data supersedes an older
  // hand-set verdict). creative_metrics is the base table (the performance view
  // drops the verdict); the admin client reads every org's rows.
  const { data: metricRows } = await admin
    .from("creative_metrics")
    .select("ad_name, verdict, verdict_source, flight_start, created_at")
    .order("flight_start", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const latestVerdict = new Map<string, "GRADUATE" | "KEEP_TESTING" | "KILL" | null>();
  for (const m of (metricRows ?? []) as { ad_name: string; verdict: string | null; verdict_source: string | null }[]) {
    if (latestVerdict.has(m.ad_name)) continue; // keep only the latest flight
    const isOverride =
      (m.verdict_source === "user" || m.verdict_source === "report") &&
      (m.verdict === "GRADUATE" || m.verdict === "KEEP_TESTING" || m.verdict === "KILL");
    latestVerdict.set(m.ad_name, isOverride ? (m.verdict as "GRADUATE" | "KEEP_TESTING" | "KILL") : null);
  }

  const fallback = defaultTargetCents();
  const capturedAt = new Date().toISOString();
  const now = new Date();
  const minLoserResults = loserMinResults();
  const cptMultiplier = loserCptMultiplier();
  const winners: Record<string, unknown>[] = [];
  const qualifiers: GoldenQualifier[] = [];
  const losers: (GoldenQualifier & { spend_cents: number; first_spend_date: string })[] = [];
  const manualKills: (Omit<GoldenQualifier, "cpt_cents"> & { cpt_cents: number | null; spend_cents: number; first_spend_date: string | null })[] = [];
  let evaluated = 0;

  for (const c of creatives ?? []) {
    const p = perfById.get(c.id);
    if (!p) continue;
    evaluated++;
    const spend = Number(p.spend) || 0;
    const results = Number(p.results) || 0;
    const cpt = p.cpt == null ? null : Number(p.cpt);
    const target = c.cpt_target_cents ?? fallback;
    const famRaw = c.concept_families as { name: string } | { name: string }[] | null;
    const family = !famRaw ? null : Array.isArray(famRaw) ? famRaw[0]?.name ?? null : famRaw.name;

    // Latest-flight human verdict overrides the gates (Zaire's invisible
    // curation): KILL → manual-kill bad example; GRADUATE → force-cache even
    // under-volume; KEEP_TESTING → hold (neither win nor loss). No override, or
    // an 'auto' latest flight, falls through to the gates below.
    const override = c.ad_name ? latestVerdict.get(c.ad_name) ?? null : null;

    if (override === "KILL") {
      manualKills.push({
        creative_id: c.id,
        org_id: c.org_id,
        score: cpt != null && target ? (cpt * 100) / target : 0,
        reason: `Killed by the paid team${cpt != null ? `: CPA $${cpt.toFixed(2)} vs $${(target / 100).toFixed(2)} target` : ""}${results ? ` over ${Math.round(results)} conversions` : ""}`,
        cpt_cents: cpt == null ? null : Math.round(cpt * 100),
        results: Math.round(results),
        target_cents: target,
        spend_cents: Math.round(spend * 100),
        first_spend_date: p.first_date,
        family,
        hook_line: c.hook_line,
        hook_angle: c.hook_angle,
        archetype: c.archetype,
        sport: c.sport,
        format: c.format,
      });
      continue;
    }
    if (override === "KEEP_TESTING") continue; // human says inconclusive — hold

    // Proven loser? All three gates: mature + volume + CPT well over target.
    // (apply_bad_refresh re-enforces these in SQL; this is the primary filter.)
    // A GRADUATE override is a winner by fiat, so it can't also be a loser.
    if (
      override !== "GRADUATE" &&
      cpt != null && target != null && p.first_date != null &&
      isMature(p.first_date, now) &&
      results >= minLoserResults &&
      Math.round(cpt * 100) >= Math.ceil(target * cptMultiplier)
    ) {
      losers.push({
        creative_id: c.id,
        org_id: c.org_id,
        score: (cpt * 100) / target, // rank: how far over target
        reason: `Proven loser: CPT $${cpt.toFixed(2)} is ${((cpt * 100) / target).toFixed(1)}x the $${(target / 100).toFixed(2)} target over ${Math.round(results)} trials (mature — first spend ${p.first_date})`,
        cpt_cents: Math.round(cpt * 100),
        results: Math.round(results),
        target_cents: target,
        spend_cents: Math.round(spend * 100),
        first_spend_date: p.first_date,
        family,
        hook_line: c.hook_line,
        hook_angle: c.hook_angle,
        archetype: c.archetype,
        sport: c.sport,
        format: c.format,
      });
    }

    const graded = evaluateWinner(
      { creativeId: c.id, spend, results, cpt, ctr: p.ctr == null ? null : Number(p.ctr) },
      target,
    );
    const graduate = override === "GRADUATE";
    if (!graded.qualifies && !graduate) continue;
    // A forced graduate still needs a comparable rank: efficiency (when a CPT
    // is known) × √volume, falling back to volume alone. Gated winners keep
    // their evaluateWinner score untouched.
    const efficiency = cpt != null && cpt > 0 && target != null ? target / 100 / cpt : 1;
    const score = graded.qualifies ? (graded.score ?? 0) : efficiency * Math.sqrt(Math.max(results, 1));
    const reason = graded.qualifies
      ? graded.reason
      : `Graduated by the paid team${cpt != null ? `: CPA $${cpt.toFixed(2)}` : ""}${results ? ` over ${Math.round(results)} conversions` : ""}`;
    qualifiers.push({
      creative_id: c.id,
      org_id: c.org_id,
      score,
      reason,
      cpt_cents: Math.round((cpt ?? 0) * 100),
      results: Math.round(results),
      target_cents: target ?? 0,
      family,
      hook_line: c.hook_line,
      hook_angle: c.hook_angle,
      archetype: c.archetype,
      sport: c.sport,
      format: c.format,
    });
    winners.push({
      creative_id: c.id,
      org_id: c.org_id,
      score,
      cpt_cents: cpt == null ? null : Math.round(cpt * 100),
      results: Math.round(results),
      spend_cents: Math.round(spend * 100),
      ctr: p.ctr == null ? null : Number(p.ctr),
      target_cents: target,
      sport: c.sport,
      concept_family_id: c.concept_family_id,
      hook_angle: c.hook_angle,
      archetype: c.archetype,
      captured_at: capturedAt,
    });
  }

  if (winners.length > 0) {
    const { error } = await admin
      .from("content_cache")
      .upsert(winners, { onConflict: "creative_id" });
    if (error) return { error: error.message };
  }

  // Prune anything not refreshed this run: the winners just upserted all carry
  // THIS run's captured_at, so any row with an older captured_at is a former
  // winner that no longer qualifies. O(1) in URL size (vs. embedding every id),
  // and safe under concurrency — an older run can't delete a newer run's rows.
  const { error: delErr } = await admin
    .from("content_cache")
    .delete()
    .lt("captured_at", capturedAt);
  if (delErr) return { error: delErr.message };

  // Golden Set + Bad Examples: snapshot the top winners / proven losers WITH
  // their scripts. A row without a script can't be an example (the script IS
  // the reusable asset) — it's skipped and counted, never inserted incomplete.
  // All curation-safety and gate enforcement live in the SQL functions.
  const topGolden = [...qualifiers].sort((a, b) => b.score - a.score).slice(0, goldenMax());
  const topLosers = [...losers].sort((a, b) => b.score - a.score).slice(0, badMax());
  const topManualKills = [...manualKills].sort((a, b) => b.score - a.score).slice(0, badMax());
  const scriptByConcept = new Map<string, { body: string; version: number }>();
  const scriptIds = [...new Set([...topGolden, ...topLosers, ...topManualKills].map((q) => q.creative_id))];
  if (scriptIds.length) {
    const { data: scripts, error: sErr } = await admin
      .from("scripts")
      .select("concept_id, body, version")
      .in("concept_id", scriptIds)
      .order("version", { ascending: false });
    if (sErr) return { error: sErr.message };
    for (const s of (scripts ?? []) as { concept_id: string; body: string; version: number }[]) {
      if (!scriptByConcept.has(s.concept_id)) scriptByConcept.set(s.concept_id, s);
    }
  }
  const dims = (q: Pick<GoldenQualifier, "family" | "hook_line" | "hook_angle" | "archetype" | "sport" | "format">) => ({
    family: q.family,
    hook_line: q.hook_line,
    hook_angle: q.hook_angle,
    archetype: q.archetype,
    sport: q.sport,
    format: q.format,
  });

  let goldenSkipped = 0;
  const goldenCandidates: Record<string, unknown>[] = [];
  for (const q of topGolden) {
    const s = scriptByConcept.get(q.creative_id);
    if (!s || !s.body.trim()) {
      goldenSkipped++;
      continue;
    }
    goldenCandidates.push({
      creative_id: q.creative_id,
      org_id: q.org_id,
      script: s.body,
      script_version: s.version,
      why_it_won: q.reason,
      dimensions: dims(q),
      score: q.score,
      cpt_cents: q.cpt_cents,
      results: q.results,
      target_cents: q.target_cents,
    });
  }
  // Always call the refresh — an empty candidate list must still prune stale
  // auto rows (pinned/removed rows are protected inside the function).
  const { data: goldenRes, error: gErr } = await admin.rpc("apply_golden_refresh", {
    candidates: goldenCandidates,
  });
  if (gErr) return { error: gErr.message };
  const g = (goldenRes ?? {}) as { upserted?: number; pruned?: number };

  let badSkipped = 0;
  const badCandidates: Record<string, unknown>[] = [];
  for (const q of topLosers) {
    const s = scriptByConcept.get(q.creative_id);
    if (!s || !s.body.trim()) {
      badSkipped++;
      continue;
    }
    badCandidates.push({
      creative_id: q.creative_id,
      org_id: q.org_id,
      script: s.body,
      script_version: s.version,
      reason: q.reason,
      dimensions: dims(q),
      cpt_cents: q.cpt_cents,
      target_cents: q.target_cents,
      results: q.results,
      spend_cents: q.spend_cents,
      first_spend_date: q.first_spend_date,
    });
  }
  const { data: badRes, error: bErr } = await admin.rpc("apply_bad_refresh", {
    candidates: badCandidates,
    min_results: minLoserResults,
    cpt_multiplier: cptMultiplier,
    mature_days: loserMatureDays(),
  });
  if (bErr) return { error: bErr.message };
  const b = (badRes ?? {}) as { upserted?: number; pruned?: number };

  // Manual kills — human KILL verdicts, no gates to re-enforce (the decision is
  // the evidence), but still snapshot the script like every other example. An
  // empty list still prunes: a verdict flipped off KILL un-kills next run.
  let manualSkipped = 0;
  const manualCandidates: Record<string, unknown>[] = [];
  for (const q of topManualKills) {
    const s2 = scriptByConcept.get(q.creative_id);
    if (!s2 || !s2.body.trim()) {
      manualSkipped++;
      continue;
    }
    manualCandidates.push({
      creative_id: q.creative_id,
      org_id: q.org_id,
      script: s2.body,
      script_version: s2.version,
      reason: q.reason,
      dimensions: dims(q),
      cpt_cents: q.cpt_cents,
      target_cents: q.target_cents,
      results: q.results,
      spend_cents: q.spend_cents,
      first_spend_date: q.first_spend_date,
    });
  }
  const { data: killRes, error: kErr } = await admin.rpc("apply_manual_kills", {
    candidates: manualCandidates,
  });
  if (kErr) return { error: kErr.message };
  const k = (killRes ?? {}) as { upserted?: number; pruned?: number };

  return {
    evaluated,
    cached: winners.length,
    golden: { upserted: g.upserted ?? 0, pruned: g.pruned ?? 0, skippedNoScript: goldenSkipped },
    bad: { upserted: b.upserted ?? 0, pruned: b.pruned ?? 0, skippedNoScript: badSkipped },
    manualKills: { upserted: k.upserted ?? 0, pruned: k.pruned ?? 0, skippedNoScript: manualSkipped },
  };
}
