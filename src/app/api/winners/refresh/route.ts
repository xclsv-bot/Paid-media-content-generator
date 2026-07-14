import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { isAuthorizedAgent, isAuthorizedCron } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshAll, type RefreshResult } from "@/lib/loop/refresh";
import { refreshBreakdowns, type BreakdownRefreshResult } from "@/lib/loop/breakdowns-refresh";

// Breakdown generation can run several model calls; give the route headroom.
export const maxDuration = 300; // capped to plan max

// Thin auth wrapper over the loop's daily refresh (src/lib/loop/refresh.ts),
// which rebuilds content_cache, golden_examples, and bad_examples in one pass,
// then the winner-breakdown refresher (src/lib/loop/breakdowns-refresh.ts),
// which tears down new/changed winners into the structure Ideate grounds on.

async function run(): Promise<NextResponse> {
  const admin = createAdminClient();
  const result: RefreshResult = await refreshAll(admin);
  if ("error" in result) return NextResponse.json(result, { status: 500 });
  // Breakdowns ride the same run so the daily cron keeps them fresh; a
  // breakdown failure is reported but never fails the store refresh itself.
  const breakdowns: BreakdownRefreshResult = await refreshBreakdowns(admin);
  return NextResponse.json({ ...result, breakdowns });
}

// POST /api/winners/refresh — manual trigger: staff (session) or the script agent.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}

// GET /api/winners/refresh — scheduled trigger. Vercel Cron hits this daily and
// presents `Authorization: Bearer $CRON_SECRET`; the agent key is also accepted.
export async function GET(req: Request) {
  if (!isAuthorizedCron(req) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return run();
}
