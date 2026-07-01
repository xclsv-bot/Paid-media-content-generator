import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedInsight } from "@/lib/meta/csv";

export type IngestResult = {
  upserted: number;
  matchedAds: number;
  unmatchedAds: string[];
  dateRange: { from: string | undefined; to: string | undefined };
};

// Join a batch of per-ad daily insights to creatives (by ad name), auto-linking
// where a creative carries a matching ad_name, then upsert the daily rows.
// Shared by the CSV import and the Meta API sync so both behave identically.
export async function ingestInsights(
  supabase: SupabaseClient,
  insights: ParsedInsight[],
  opts: { adAccountId?: string | null; attributionWindow?: string | null } = {},
): Promise<IngestResult> {
  const adAccountId = opts.adAccountId ?? null;

  // First non-null Ad ID seen per name.
  const adIdByName = new Map<string, string | null>();
  for (const i of insights) {
    if (!adIdByName.get(i.adName)) adIdByName.set(i.adName, i.adId);
  }
  const adNames = [...adIdByName.keys()];

  // 1) Existing links.
  const linkByName = new Map<string, string>(); // adName -> meta_ad_id
  if (adNames.length) {
    const { data: existing } = await supabase
      .from("meta_ads")
      .select("ad_name, meta_ad_id")
      .in("ad_name", adNames);
    for (const a of existing ?? []) {
      if (a.ad_name && a.meta_ad_id) linkByName.set(a.ad_name, a.meta_ad_id);
    }
  }

  // 2) Auto-link unlinked names to creatives that carry a matching ad_name.
  const unlinked = adNames.filter((n) => !linkByName.has(n));
  const unmatched: string[] = [];
  if (unlinked.length > 0) {
    const { data: creatives } = await supabase
      .from("creatives")
      .select("id, ad_name")
      .in("ad_name", unlinked);
    const creativeByName = new Map<string, string>();
    for (const c of creatives ?? []) if (c.ad_name) creativeByName.set(c.ad_name, c.id);

    const newLinks = [];
    for (const name of unlinked) {
      const creativeId = creativeByName.get(name);
      if (!creativeId) {
        unmatched.push(name);
        continue;
      }
      const metaAdId = adIdByName.get(name) || `name:${name}`;
      linkByName.set(name, metaAdId);
      newLinks.push({ creative_id: creativeId, meta_ad_id: metaAdId, ad_name: name, ad_account_id: adAccountId });
    }
    if (newLinks.length > 0) await supabase.from("meta_ads").insert(newLinks);
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
      attribution_window: opts.attributionWindow || null,
      fetched_at: fetchedAt,
    }));

  let upserted = 0;
  if (rows.length > 0) {
    const { count } = await supabase
      .from("meta_insights_daily")
      .upsert(rows, { onConflict: "meta_ad_id,date", count: "exact" });
    upserted = count ?? rows.length;
  }

  const dates = insights.map((i) => i.date).sort();
  return {
    upserted,
    matchedAds: linkByName.size,
    unmatchedAds: [...new Set(unmatched)],
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
  };
}
