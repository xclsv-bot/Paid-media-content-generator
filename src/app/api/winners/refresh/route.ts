import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { isAuthorizedAgent, isAuthorizedCron } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAll, type RefreshResult } from "@/lib/loop/refresh";
import { minResults, minSpendCents } from "@/lib/loop/config";

// Thin auth wrapper over the loop's daily refresh (src/lib/loop/refresh.ts),
// which rebuilds content_cache, golden_examples, and bad_examples in one pass.

function respond(result: RefreshResult) {
  if ("error" in result) return NextResponse.json(result, { status: 500 });
  // gates: the env-resolved winners bar, so the UI can explain a legitimate
  // zero ("evaluated N, cached 0") with the real thresholds, never hardcoded.
  return NextResponse.json({
    ...result,
    gates: { min_results: minResults(), min_spend_cents: minSpendCents() },
  });
}

// POST /api/winners/refresh — manual trigger: staff (session) or the script agent.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return respond(await refreshAll(createAdminClient()));
}

// GET /api/winners/refresh — scheduled trigger. Vercel Cron hits this daily and
// presents `Authorization: Bearer $CRON_SECRET`; the agent key is also accepted.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return respond(await refreshAll(createAdminClient()));
}
