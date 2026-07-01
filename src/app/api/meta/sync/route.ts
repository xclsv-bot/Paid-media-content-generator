import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { metaConfig, fetchAdInsights } from "@/lib/meta/api";
import { ingestInsights } from "@/lib/meta/ingest";

export const maxDuration = 60;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// POST /api/meta/sync  { since?, until? }
// Staff-only. Pulls per-ad daily insights from the Meta Marketing API, joins to
// creatives, and upserts them — the automated equivalent of the CSV import.
// Returns 503 until META_SYSTEM_USER_TOKEN + META_AD_ACCOUNT_ID are set.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const cfg = metaConfig();
  if (!cfg) {
    return NextResponse.json(
      { error: "Meta API isn't configured — set META_SYSTEM_USER_TOKEN and META_AD_ACCOUNT_ID." },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const until = body.until || isoDate(new Date());
  const since = body.since || isoDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  try {
    const { insights, actionTypesSeen } = await fetchAdInsights(cfg, { since, until });
    const result = await ingestInsights(await createClient(), insights, {
      adAccountId: cfg.adAccountId,
      attributionWindow: null,
    });

    // Help the team wire up the trial event if it isn't set or produced nothing.
    const trialCounted = insights.some((i) => (i.results ?? 0) > 0);
    const note =
      !cfg.trialActionType
        ? "META_TRIAL_ACTION_TYPE is not set — trials (results) were not counted. Pick the trial action_type from actionTypesSeen and set the env var."
        : !trialCounted
        ? `No '${cfg.trialActionType}' actions found in this window — confirm the trial action_type against actionTypesSeen.`
        : null;

    return NextResponse.json({ range: { since, until }, ...result, actionTypesSeen, note });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Meta sync failed" },
      { status: 502 },
    );
  }
}
