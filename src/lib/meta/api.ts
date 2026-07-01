import type { ParsedInsight } from "@/lib/meta/csv";

// ── Config ──────────────────────────────────────────────────────────────────
export type MetaConfig = {
  token: string;
  adAccountId: string; // normalized to act_XXXXXXXX
  apiVersion: string;
  trialActionType: string | null; // which Meta action = a "trial start"
};

export function metaConfig(): MetaConfig | null {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  const rawAccount = process.env.META_AD_ACCOUNT_ID;
  if (!token || !rawAccount) return null;
  const adAccountId = rawAccount.startsWith("act_") ? rawAccount : `act_${rawAccount}`;
  return {
    token,
    adAccountId,
    apiVersion: process.env.META_API_VERSION || "v21.0",
    trialActionType: process.env.META_TRIAL_ACTION_TYPE || null,
  };
}

type MetaAction = { action_type: string; value: string };
type MetaRow = {
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: MetaAction[];
  date_start?: string;
};
type MetaPage = { data?: MetaRow[]; paging?: { next?: string }; error?: { message?: string } };

const num = (v: string | undefined): number | null =>
  v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

// Pull per-ad, per-day insights for a date range, following pagination.
// Returns rows shaped exactly like the CSV parser so ingestInsights can reuse
// them, plus the set of action_types seen (to help configure the trial event).
export async function fetchAdInsights(
  cfg: MetaConfig,
  opts: { since: string; until: string },
): Promise<{ insights: ParsedInsight[]; actionTypesSeen: string[] }> {
  const fields = "ad_id,ad_name,spend,impressions,clicks,actions,date_start";
  const params = new URLSearchParams({
    level: "ad",
    fields,
    time_increment: "1",
    time_range: JSON.stringify({ since: opts.since, until: opts.until }),
    limit: "500",
    access_token: cfg.token,
  });
  let url: string | undefined =
    `https://graph.facebook.com/${cfg.apiVersion}/${cfg.adAccountId}/insights?${params.toString()}`;

  const insights: ParsedInsight[] = [];
  const actionTypes = new Set<string>();
  let guard = 0;

  while (url && guard < 50) {
    guard += 1;
    const res = await fetch(url);
    const json = (await res.json()) as MetaPage;
    if (!res.ok || json.error) {
      throw new Error(json.error?.message || `Meta API error (${res.status})`);
    }
    for (const row of json.data ?? []) {
      (row.actions ?? []).forEach((a) => actionTypes.add(a.action_type));
      const spend = num(row.spend);
      const impressions = num(row.impressions);
      const clicks = num(row.clicks);
      const results = cfg.trialActionType
        ? num(row.actions?.find((a) => a.action_type === cfg.trialActionType)?.value)
        : null;
      insights.push({
        adName: row.ad_name || row.ad_id || "unknown",
        adId: row.ad_id || null,
        date: row.date_start || opts.since,
        spend,
        impressions,
        clicks,
        ctr: impressions && clicks != null ? clicks / impressions : null,
        results,
        costPerResult: results && spend != null && results > 0 ? spend / results : null,
      });
    }
    url = json.paging?.next;
  }

  return { insights, actionTypesSeen: [...actionTypes].sort() };
}
