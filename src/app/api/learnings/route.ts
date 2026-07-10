import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { latestLearnings } from "@/lib/loop/learnings";
import { getCachedWinners } from "@/lib/loop/winners-cache";

// GET /api/learnings?org=<org_id> — the latest learnings snapshot plus the
// cached-winners count for one client org. Feeds Ideate's grounding panel
// (a client component with client-side org switching, so it can't read these
// server-side the way Performance does). Staff only.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "org is required" }, { status: 400 });

  const supabase = await createClient();
  const [learning, cache] = await Promise.all([
    latestLearnings(supabase, org),
    getCachedWinners(supabase, org, 100),
  ]);
  if (cache.error) return NextResponse.json({ error: cache.error }, { status: 500 });

  return NextResponse.json({ learning, winners_count: cache.winners.length });
}
