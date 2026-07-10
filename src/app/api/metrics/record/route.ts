import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { deriveVerdict, isVerdict, type Verdict, type VerdictSource } from "@/lib/metrics/verdict";
import { refreshAll } from "@/lib/loop/refresh";

export const maxDuration = 60;

// POST /api/metrics/record — record (or update) one performance row for an ad
// then immediately rebuild the loop's example stores so the winners cache /
// golden set / bad-example store reflect it AT ONCE — not next-day. This is
// the interaction that curates: staff records a CPA or picks a verdict, and
// the stores that ground Ideate + script generation update behind the scenes.
// No dedicated curation screen — the entry IS the curation.
//
// creative_metrics is keyed (ad_name, flight_label); creative_performance is a
// view over it joined to creatives by ad_name, so this single write feeds both
// the /performance report and refreshAll(). Staff only (route gate + cm_staff_all
// RLS on the user-scoped client); the refresh runs on the service-role client.
//
// PARTIAL by key: a field absent from the body keeps its existing value, so a
// verdict-only patch (the /performance inline select) never wipes the metrics,
// and a metrics-only save never disturbs the verdict. `null` explicitly clears.
//
// Verdict provenance (verdict_source):
//   • an explicit Verdict in the body  → 'user'  (staff override wins)
//   • verdict === 'AUTO'               → 'auto'  (derive from the row's numbers)
//   • verdict absent (metrics-only)    → keep an existing user/report verdict;
//                                         otherwise derive → 'auto'
// so a metrics-only update never silently clobbers a human/report decision.

type Body = {
  ad_name?: string;
  flight_label?: string;
  flight_start?: string | null;
  spend?: number | null;
  conversions?: number | null;
  cpa?: number | null;
  ctr?: number | null;
  bau_cpa?: number | null;
  reason?: string | null;
  verdict?: string | null; // a Verdict, the sentinel 'AUTO', or absent
};

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as Body;
  const adName = body.ad_name?.trim();
  if (!adName) return NextResponse.json({ error: "ad_name is required" }, { status: 400 });
  const flightLabel = body.flight_label?.trim() || "default";
  const has = (k: keyof Body) => Object.prototype.hasOwnProperty.call(body, k);

  const supabase = await createClient();

  // creative_metrics is org-scoped since 0026, but this single-row path carries
  // no org in the body. Derive it: the creative that owns this ad_name, else an
  // existing metric row for the ad. No org resolvable = nothing valid to write
  // (org_id is NOT NULL). Real ad names encode brand + date, so they don't
  // collide across orgs — the first match is the owner.
  const { data: ownerCreative } = await supabase
    .from("creatives")
    .select("org_id")
    .eq("ad_name", adName)
    .not("org_id", "is", null)
    .limit(1)
    .maybeSingle();
  let orgId = ownerCreative?.org_id ?? null;
  if (!orgId) {
    const { data: anyMetric } = await supabase
      .from("creative_metrics")
      .select("org_id")
      .eq("ad_name", adName)
      .limit(1)
      .maybeSingle();
    orgId = anyMetric?.org_id ?? null;
  }
  if (!orgId) {
    return NextResponse.json({ error: "No organization found for this ad_name." }, { status: 400 });
  }

  // The existing row for this (org, ad_name, flight_label). Omitted fields fall
  // back to it, so a partial patch preserves everything it doesn't mention.
  const { data: existing } = await supabase
    .from("creative_metrics")
    .select("flight_start, spend, conversions, cpa, ctr, bau_cpa, reason, verdict, verdict_source")
    .eq("org_id", orgId)
    .eq("ad_name", adName)
    .eq("flight_label", flightLabel)
    .maybeSingle();

  // Merge: explicit body value wins (including explicit null); else keep existing.
  const merge = (k: keyof Body, cur: unknown): number | null =>
    has(k) ? numOrNull(body[k]) : numOrNull(cur);
  const spend = merge("spend", existing?.spend);
  const conversions = merge("conversions", existing?.conversions);
  const ctr = merge("ctr", existing?.ctr);
  const bauCpa = merge("bau_cpa", existing?.bau_cpa);
  // CPA: explicit wins; else if THIS request set spend/conversions, recompute
  // (null when there are no conversions — an ad that spent and converted nobody
  // has no CPA, not a stale one); else (e.g. a verdict-only patch) keep existing.
  const cpa = has("cpa")
    ? numOrNull(body.cpa)
    : has("spend") || has("conversions")
      ? (spend != null && conversions != null && conversions > 0 ? spend / conversions : null)
      : (existing?.cpa ?? null);
  const flightStart = has("flight_start") ? (body.flight_start ?? null) : (existing?.flight_start ?? null);
  const reason = has("reason") ? (body.reason?.trim() || null) : (existing?.reason ?? null);

  // Resolve the verdict + its provenance from the EFFECTIVE (merged) numbers.
  let verdict: Verdict | null;
  let verdictSource: VerdictSource;
  if (isVerdict(body.verdict)) {
    verdict = body.verdict;
    verdictSource = "user";
  } else if (!has("verdict") || body.verdict === "AUTO" || body.verdict == null || body.verdict === "") {
    const explicitAuto = body.verdict === "AUTO";
    const hasHumanVerdict = existing?.verdict != null && (existing.verdict_source === "user" || existing.verdict_source === "report");
    if (!explicitAuto && hasHumanVerdict) {
      // Metrics-only update: leave the human/report verdict untouched.
      verdict = existing!.verdict as Verdict;
      verdictSource = existing!.verdict_source as VerdictSource;
    } else {
      verdict = deriveVerdict(
        { spend: spend ?? 0, results: conversions ?? 0, cpt: cpa, ctr, firstDate: flightStart },
        defaultTargetCents(),
      );
      verdictSource = "auto";
    }
  } else {
    return NextResponse.json({ error: "verdict must be GRADUATE, KEEP_TESTING, KILL, or AUTO" }, { status: 400 });
  }

  const row = {
    org_id: orgId,
    ad_name: adName,
    flight_label: flightLabel,
    flight_start: flightStart,
    spend,
    conversions,
    cpa,
    ctr,
    bau_cpa: bauCpa,
    reason,
    verdict,
    verdict_source: verdictSource,
    updated_at: new Date().toISOString(),
  };

  const { data: metric, error } = await supabase
    .from("creative_metrics")
    .upsert(row, { onConflict: "org_id,ad_name,flight_label" })
    .select("ad_name, flight_label, spend, conversions, cpa, ctr, verdict, verdict_source")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Rebuild the stores now, on the service-role client (refreshAll reads all
  // performance + calls the refresh RPCs). A refresh failure isn't fatal to the
  // save — the row is persisted; report it so the UI can surface a soft warning.
  const refresh = await refreshAll(createAdminClient());

  return NextResponse.json({ metric, refresh }, { status: 200 });
}
