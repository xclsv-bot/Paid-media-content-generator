import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { isAuthorizedAgent } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { deriveVerdict, parseVerdictLabel, type Verdict, type VerdictSource } from "@/lib/metrics/verdict";
import { canon, NUMERIC_COLS, parseCsv, toCtr, toNum, type RawRow } from "@/lib/metrics/sheet";
import { refreshAll } from "@/lib/loop/refresh";

export const maxDuration = 120;

// POST /api/metrics/import - bulk-ingest the paid team's weekly report (the
// Excel sheet, keyed by ad name) into creative_metrics, then rebuild the loop's
// stores ONCE. This is the recurring feed: one import lights up the /performance
// report, the winners cache, the golden set, and the bad-example store.
//
// Accepts either JSON { rows: [...] } or a raw CSV body (Content-Type: text/csv
// or text/plain). Headers are normalized loosely (see HEADER_MAP) so the sheet's
// exact column names don't have to match ours. A parsed verdict is stored as
// verdict_source='report' (the paid team's call); a blank verdict is derived
// from the numbers unless the row already carries a human/report verdict.
//
// Returns { imported, unmatched, refresh }. `unmatched` lists ad names with no
// matching creative - naming-convention drift the team can see and fix, rather
// than silently dropping rows.
//
// Staff session OR the script agent (AGENT_API_KEY); writes on the service-role
// client so the agent path isn't blocked by RLS.

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Read either JSON { rows } or a raw CSV body.
  const ctype = req.headers.get("content-type") || "";
  let rawRows: RawRow[];
  try {
    if (ctype.includes("application/json")) {
      const body = (await req.json()) as { rows?: RawRow[] };
      rawRows = Array.isArray(body.rows) ? body.rows : [];
    } else {
      rawRows = parseCsv(await req.text());
    }
  } catch {
    return NextResponse.json({ error: "Could not parse body (send JSON {rows} or CSV)" }, { status: 400 });
  }
  if (!rawRows.length) return NextResponse.json({ error: "No rows to import" }, { status: 400 });

  // Normalize each raw row to canonical columns.
  const target = defaultTargetCents();
  type Norm = { ad_name: string; flight_label: string; values: Record<string, string | number | null>; verdict_raw: string | null };
  const normalized: Norm[] = [];
  for (const raw of rawRows) {
    const values: Record<string, string | number | null> = {};
    let verdictRaw: string | null = null;
    for (const [k, v] of Object.entries(raw)) {
      const col = canon(k);
      if (!col) continue;
      if (col === "verdict") verdictRaw = v == null ? null : String(v);
      else if (col === "ctr") values.ctr = toCtr(v as string);
      else if (NUMERIC_COLS.has(col)) values[col] = toNum(v as string);
      else values[col] = v == null ? null : String(v).trim();
    }
    const adName = (values.ad_name as string | undefined)?.trim();
    if (!adName) continue; // a row with no ad name can't be keyed
    normalized.push({
      ad_name: adName,
      flight_label: (values.flight_label as string | undefined)?.trim() || "default",
      values,
      verdict_raw: verdictRaw,
    });
  }
  if (!normalized.length) return NextResponse.json({ error: "No rows had a usable ad name" }, { status: 400 });

  const admin = createAdminClient();

  // Existing verdicts for the keys in this batch - so a blank cell preserves a
  // prior human/report call instead of silently deriving over it.
  const { data: existingRows } = await admin
    .from("creative_metrics")
    .select("ad_name, flight_label, verdict, verdict_source, flight_start")
    .in("ad_name", [...new Set(normalized.map((n) => n.ad_name))]);
  const existing = new Map<string, { verdict: string | null; verdict_source: string | null; flight_start: string | null }>();
  for (const r of existingRows ?? []) existing.set(`${r.ad_name}\u0000${r.flight_label}`, r);

  const upserts = normalized.map((n) => {
    const prior = existing.get(`${n.ad_name}\u0000${n.flight_label}`);
    const spend = (n.values.spend as number | null) ?? null;
    const conversions = (n.values.conversions as number | null) ?? null;
    const cpa = (n.values.cpa as number | null) ?? (spend != null && conversions && conversions > 0 ? spend / conversions : null);
    const flightStart = (n.values.flight_start as string | null) ?? prior?.flight_start ?? null;

    let verdict: Verdict | null;
    let verdictSource: VerdictSource;
    const parsed = parseVerdictLabel(n.verdict_raw);
    if (parsed) {
      verdict = parsed;
      verdictSource = "report";
    } else if (prior?.verdict != null && (prior.verdict_source === "user" || prior.verdict_source === "report")) {
      verdict = prior.verdict as Verdict;
      verdictSource = prior.verdict_source as VerdictSource;
    } else {
      verdict = deriveVerdict(
        { spend: spend ?? 0, results: conversions ?? 0, cpt: cpa, ctr: (n.values.ctr as number | null) ?? null, firstDate: flightStart },
        target,
      );
      verdictSource = "auto";
    }

    return {
      ad_name: n.ad_name,
      flight_label: n.flight_label,
      flight_start: flightStart,
      spend,
      conversions,
      cpa,
      ctr: (n.values.ctr as number | null) ?? null,
      bau_cpa: (n.values.bau_cpa as number | null) ?? null,
      reason: (n.values.reason as string | null) ?? null,
      cpm: (n.values.cpm as number | null) ?? null,
      cpi: (n.values.cpi as number | null) ?? null,
      cps: (n.values.cps as number | null) ?? null,
      icvr: (n.values.icvr as number | null) ?? null,
      scvr: (n.values.scvr as number | null) ?? null,
      aov: (n.values.aov as number | null) ?? null,
      roas: (n.values.roas as number | null) ?? null,
      verdict,
      verdict_source: verdictSource,
    };
  });

  const { error } = await admin
    .from("creative_metrics")
    .upsert(upserts, { onConflict: "ad_name,flight_label" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Which ad names don't match any creative? Store them anyway (harmless - the
  // view just won't join), but surface them so the team can fix the naming.
  const importedNames = [...new Set(upserts.map((u) => u.ad_name))];
  const { data: matched } = await admin.from("creatives").select("ad_name").in("ad_name", importedNames);
  const matchedSet = new Set((matched ?? []).map((m) => m.ad_name));
  const unmatched = importedNames.filter((name) => !matchedSet.has(name));

  const refresh = await refreshAll(admin);

  return NextResponse.json({ imported: upserts.length, unmatched, refresh }, { status: 200 });
}
