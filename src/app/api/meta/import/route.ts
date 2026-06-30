import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseMetaCsv } from "@/lib/meta/csv";

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

  // First non-null Ad ID seen per name (Meta exports usually carry it).
  const adIdByName = new Map<string, string | null>();
  for (const i of insights) {
    if (!adIdByName.get(i.adName)) adIdByName.set(i.adName, i.adId);
  }
  const adNames = [...adIdByName.keys()];

  // 1) Existing links.
  const linkByName = new Map<string, string>(); // adName -> meta_ad_id
  const { data: existing } = await supabase
    .from("meta_ads")
    .select("ad_name, meta_ad_id")
    .in("ad_name", adNames);
  for (const a of existing ?? []) {
    if (a.ad_name && a.meta_ad_id) linkByName.set(a.ad_name, a.meta_ad_id);
  }

  // 2) Auto-link unlinked names to creatives that carry a matching ad_name.
  const unlinked = adNames.filter((n) => !linkByName.has(n));
  let unmatched: string[] = [];
  if (unlinked.length > 0) {
    const { data: creatives } = await supabase
      .from("creatives")
      .select("id, ad_name")
      .in("ad_name", unlinked);
    const creativeByName = new Map<string, string>();
    for (const c of creatives ?? []) {
      if (c.ad_name) creativeByName.set(c.ad_name, c.id);
    }

    const newLinks = [];
    for (const name of unlinked) {
      const creativeId = creativeByName.get(name);
      if (!creativeId) {
        unmatched.push(name);
        continue;
      }
      newLinks.push({
        creative_id: creativeId,
        meta_ad_id: adIdByName.get(name) || `name:${name}`,
        ad_name: name,
        ad_account_id: adAccountId,
      });
    }

    if (newLinks.length > 0) {
      const { error: linkErr } = await supabase.from("meta_ads").insert(newLinks);
      // 23505 = a concurrent import already created some of these links; that's
      // fine, the re-select below recovers them. Any other error is real — don't
      // pretend these names matched.
      if (linkErr && linkErr.code !== "23505") {
        return NextResponse.json({ error: linkErr.message }, { status: 500 });
      }
    }

    // Re-read the authoritative links for every name so insights only attach to
    // links that actually persisted (covers rows we inserted and ones a
    // concurrent import created). meta_ads is unique on the functional index
    // (coalesce(ad_account_id,''), ad_name), so we reconcile by re-select rather
    // than onConflict.
    const { data: linksNow } = await supabase
      .from("meta_ads")
      .select("ad_name, meta_ad_id")
      .in("ad_name", adNames);
    linkByName.clear();
    for (const a of linksNow ?? []) {
      if (a.ad_name && a.meta_ad_id) linkByName.set(a.ad_name, a.meta_ad_id);
    }
    // A name is only unmatched if it still has no persisted link.
    unmatched = unmatched.filter((n) => !linkByName.has(n));
  }

  // 3) Upsert daily insights for everything we could link.
  const fetchedAt = new Date().toISOString();
  const rows = insights
    .filter((i) => linkByName.has(i.adName))
    .map((i) => ({
      meta_ad_id: linkByName.get(i.adName)!,
      date: i.date,
      spend: i.spend,
      impressions: i.impressions,
      clicks: i.clicks,
      ctr: i.ctr,
      results: i.results,
      cost_per_result: i.costPerResult,
      attribution_window: attributionWindow || null,
      fetched_at: fetchedAt,
    }));

  let upserted = 0;
  if (rows.length > 0) {
    const { error, count } = await supabase
      .from("meta_insights_daily")
      .upsert(rows, { onConflict: "meta_ad_id,date", count: "exact" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    upserted = count ?? rows.length;
  }

  const dates = insights.map((i) => i.date).sort();
  return NextResponse.json({
    totalRows: insights.length,
    upserted,
    matchedAds: linkByName.size,
    unmatchedAds: [...new Set(unmatched)],
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    detected,
    skipped,
    errors,
  });
}
