import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { isAuthorizedAgent } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultTargetCents } from "@/lib/meta/perf";
import { evaluateWinner } from "@/lib/winners";

// POST /api/winners/refresh
// Recompute the Winners Cache from current performance. Staff (session) or the
// script agent (Bearer AGENT_API_KEY) may trigger it — e.g. after a Meta import.
// Uses the service-role client to read all performance and rewrite the cache.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [{ data: perfRows, error: perfErr }, { data: creatives, error: cErr }] =
    await Promise.all([
      admin.from("creative_performance").select("creative_id, spend, results, cpt, ctr"),
      admin
        .from("creatives")
        .select("id, client_org, sport, concept_family_id, hook_angle, archetype, cpt_target_cents"),
    ]);
  if (perfErr) return NextResponse.json({ error: perfErr.message }, { status: 500 });
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Prune cache rows that no longer qualify.
  const keepIds = winners.map((w) => w.creative_id as string);
  const prune =
    keepIds.length > 0
      ? admin.from("content_cache").delete().not("creative_id", "in", `(${keepIds.join(",")})`)
      : admin.from("content_cache").delete().not("creative_id", "is", null);
  const { error: delErr } = await prune;
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ evaluated, cached: winners.length });
}
