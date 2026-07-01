import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { metaConfig, fetchAdInsights } from "@/lib/meta/api";
import { ingestInsights } from "@/lib/meta/ingest";
import { generateLearnings } from "@/lib/loop/generate";

export const maxDuration = 300;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// GET /api/cron/loop — the weekly heartbeat (Vercel cron; see vercel.json).
// Pulls Meta insights (if configured) then regenerates learnings. Secured by
// CRON_SECRET: Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron runs.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured (set CRON_SECRET)." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const summary: Record<string, unknown> = {};

  // 1) Meta sync (best-effort — don't let it block learnings).
  const cfg = metaConfig();
  if (cfg) {
    try {
      const until = isoDate(new Date());
      const since = isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      const { insights } = await fetchAdInsights(cfg, { since, until });
      const res = await ingestInsights(admin, insights, { adAccountId: cfg.adAccountId, attributionWindow: null });
      summary.metaSync = { since, until, upserted: res.upserted, matchedAds: res.matchedAds };
    } catch (e) {
      summary.metaSync = { error: e instanceof Error ? e.message : "sync failed" };
    }
  } else {
    summary.metaSync = "skipped (Meta not configured)";
  }

  // 2) Regenerate learnings from the (freshly updated) scoreboard.
  const learn = await generateLearnings(admin, null);
  summary.learnings = learn.error ? { error: learn.error, status: learn.status } : "generated";

  return NextResponse.json({ ok: true, ...summary });
}
