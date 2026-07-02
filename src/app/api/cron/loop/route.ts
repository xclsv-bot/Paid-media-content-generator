import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateLearnings } from "@/lib/loop/generate";

export const maxDuration = 300;

// GET /api/cron/loop — the weekly heartbeat (Vercel cron; see vercel.json).
// Regenerates learnings from the latest report metrics. Secured by CRON_SECRET:
// Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron runs.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured (set CRON_SECRET)." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const learn = await generateLearnings(admin, null);
  return NextResponse.json({
    ok: true,
    learnings: learn.error ? { error: learn.error, status: learn.status } : "generated",
  });
}
