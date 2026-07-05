import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { isAuthorizedAgent, isAuthorizedCron } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { evaluateWinner } from "@/lib/winners";

// Recompute the Winners Cache from current performance: evaluate every creative
// that has performance, upsert the strong performers, prune the rest. Uses the
// service-role client to read all performance and rewrite the cache.
async function recompute(): Promise<{ evaluated: number; cached: number } | { error: string }> {
  const admin = createAdminClient();
  const [{ data: perfRows, error: perfErr }, { data: creatives, error: cErr }] =
    await Promise.all([
      admin.from("creative_performance").select("creative_id, spend, results, cpt, ctr"),
      admin
        .from("creatives")
        .select("id, client_org, sport, concept_family_id, hook_angle, archetype, cpt_target_cents"),
    ]);
  if (perfErr) return { error: perfErr.message };
  if (cErr) return { error: cErr.message };

  const perfById = new Map<string, { spend: number | null; results: number | null; cpt: number | null; ctr: number | null }>();
  for (const p of perfRows ?? []) perfById.set(p.creative_id, p);

  const fallback = defaultTargetCents();
  const capturedAt = new Date().toISOString();
  const winners: Record<string, unknown>[] = [];
  let evaluated = 0;

  for (const c of creatives ?? []) {
    const p = perfById.get(c.id);
    if (!p) continue;
    evaluated++;
    const spend = Number(p.spend) || 0;
    const results = Number(p.results) || 0;
    const cpt = p.cpt == null ? null : Number(p.cpt);
    const target = c.cpt_target_cents ?? fallback;
    const verdict = evaluateWinner(
      { creativeId: c.id, spend, results, cpt, ctr: p.ctr == null ? null : Number(p.ctr) },
      target,
    );
    if (!verdict.qualifies) continue;
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

  return { evaluated, cached: winners.length };
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
