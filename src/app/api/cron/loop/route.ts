import { NextResponse } from "next/server";
import { isAuthorizedCron } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateLearnings } from "@/lib/loop/generate";

export const maxDuration = 300;

// GET /api/cron/loop — the weekly heartbeat (Vercel cron; see vercel.json).
// Regenerates learnings from the latest report metrics, once per client org
// (is_agency = false — XCLSV itself has no creatives/learnings of its own).
// Secured by CRON_SECRET: Vercel sends `Authorization: Bearer <CRON_SECRET>`
// on cron runs.
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron not configured (set CRON_SECRET)." }, { status: 503 });
  }
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: clientOrgs } = await admin.from("organizations").select("id, slug").eq("is_agency", false);
  const results: Record<string, unknown> = {};
  for (const org of clientOrgs ?? []) {
    const learn = await generateLearnings(admin, null, org.id);
    results[org.slug] = learn.error ? { error: learn.error, status: learn.status } : "generated";
  }
  return NextResponse.json({ ok: true, learnings: results });
}
