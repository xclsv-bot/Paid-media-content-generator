import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseMetaCsv } from "@/lib/meta/csv";
import { ingestInsights } from "@/lib/meta/ingest";

// POST /api/meta/import  { csv, resultsColumn?, costColumn?, adAccountId?, attributionWindow? }
// Staff-only. Parses a Meta Ads Manager export, joins rows to creatives by ad
// name, upserts daily insights, and reports any ad names that didn't match so a
// human can reconcile them (see /api/meta/link).
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { csv, resultsColumn, costColumn, attributionWindow } = body;
  const adAccountId = body.adAccountId || process.env.META_AD_ACCOUNT_ID || null;
  if (!csv || typeof csv !== "string") {
    return NextResponse.json({ error: "csv (string) is required" }, { status: 400 });
  }

  const { insights, detected, skipped, errors } = parseMetaCsv(csv, {
    resultsColumn,
    costColumn,
  });
  if (insights.length === 0) {
    return NextResponse.json(
      { error: "No usable rows parsed", detected, errors },
      { status: 422 },
    );
  }

  const supabase = await createClient();
  const { upserted, matchedAds, unmatchedAds, dateRange } = await ingestInsights(
    supabase,
    insights,
    { adAccountId, attributionWindow },
  );

  return NextResponse.json({
    totalRows: insights.length,
    upserted,
    matchedAds,
    unmatchedAds,
    dateRange,
    detected,
    skipped,
    errors,
  });
}
