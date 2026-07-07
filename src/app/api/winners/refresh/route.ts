import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { isAuthorizedAgent, isAuthorizedCron } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { evaluateWinner } from "@/lib/winners";
import { goldenMax, type GoldenQualifier } from "@/lib/loop/golden";
import { badMax, loserCptMultiplier, loserMatureDays, loserMinResults } from "@/lib/loop/bad";
import { isMature } from "@/lib/loop/attribution";

type StageResult = { upserted: number; pruned: number; skippedNoScript: number };
type RefreshResult =
  | { evaluated: number; cached: number; golden: StageResult; bad: StageResult }
  | { error: string };

// Recompute the Winners Cache from current performance: evaluate every creative
// that has performance, upsert the strong performers, prune the rest. Uses the
// service-role client to read all performance and rewrite the cache.
async function recompute(): Promise<RefreshResult> {
  const admin = createAdminClient();
  const [{ data: perfRows, error: perfErr }, { data: creatives, error: cErr }] =
    await Promise.all([
      admin.from("creative_performance").select("creative_id, spend, results, cpt, ctr, first_date"),
      admin
        .from("creatives")
        .select("id, client_org, sport, format, hook_line, concept_family_id, hook_angle, archetype, cpt_target_cents, concept_families(name)"),
    ]);
  if (perfErr) return { error: perfErr.message };
  if (cErr) return { error: cErr.message };

  const perfById = new Map<string, { spend: number | null; results: number | null; cpt: number | null; ctr: number | null; first_date: string | null }>();
  for (const p of perfRows ?? []) perfById.set(p.creative_id, p);

  const fallback = defaultTargetCents();
  const capturedAt = new Date().toISOString();
  const now = new Date();
  const minLoserResults = loserMinResults();
  const cptMultiplier = loserCptMultiplier();
  const winners: Record<string, unknown>[] = [];
  const qualifiers: GoldenQualifier[] = [];
  const losers: (GoldenQualifier & { spend_cents: number; first_spend_date: string })[] = [];
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

    // Proven loser? All three gates: mature + volume + CPT well over target.
    // (apply_bad_refresh re-enforces these in SQL; this is the primary filter.)
    if (
      cpt != null && target != null && p.first_date != null &&
      isMature(p.first_date, now) &&
      results >= minLoserResults &&
      Math.round(cpt * 100) >= Math.ceil(target * cptMultiplier)
    ) {
      losers.push({
        creative_id: c.id,
        client_org: c.client_org,
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

    const verdict = evaluateWinner(
      { creativeId: c.id, spend, results, cpt, ctr: p.ctr == null ? null : Number(p.ctr) },
      target,
    );
    if (!verdict.qualifies) continue;
    qualifiers.push({
      creative_id: c.id,
      client_org: c.client_org,
      score: verdict.score ?? 0,
      reason: verdict.reason,
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
      client_org: c.client_org,
      score: verdict.score,
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
  const scriptByConcept = new Map<string, { body: string; version: number }>();
  const scriptIds = [...new Set([...topGolden, ...topLosers].map((q) => q.creative_id))];
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
  const dims = (q: GoldenQualifier) => ({
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
      client_org: q.client_org,
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
      client_org: q.client_org,
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

  return {
    evaluated,
    cached: winners.length,
    golden: { upserted: g.upserted ?? 0, pruned: g.pruned ?? 0, skippedNoScript: goldenSkipped },
    bad: { upserted: b.upserted ?? 0, pruned: b.pruned ?? 0, skippedNoScript: badSkipped },
  };
}

function respond(result: Awaited<ReturnType<typeof recompute>>) {
  if ("error" in result) return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}

// POST /api/winners/refresh — manual trigger: staff (session) or the script agent.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return respond(await recompute());
}

// GET /api/winners/refresh — scheduled trigger. Vercel Cron hits this daily and
// presents `Authorization: Bearer $CRON_SECRET`; the agent key is also accepted.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return respond(await recompute());
}
