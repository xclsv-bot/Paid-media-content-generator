import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { isAuthorizedAgent } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { NUMBER_FIELDS, REPORT_VERDICTS, type ReportRow } from "@/lib/metrics/report";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { deriveVerdict, type Verdict, type VerdictSource } from "@/lib/metrics/verdict";
import { refreshAll } from "@/lib/loop/refresh";

export const maxDuration = 120;
const MAX_ROWS = 500;

// POST /api/metrics  { rows: ReportRow[] }
// Bulk-ingest the team's weekly report; rows upsert into creative_metrics keyed
// on (ad_name, flight_label), then the loop's example stores rebuild ONCE so a
// single import lights up the winners cache / golden set / bad-example store —
// not next-day. Responds with which ad names matched a concept (an unmatched
// name is almost always a naming-convention typo) plus the refresh result.
//
// A row's verdict, when present, is the paid team's call (verdict_source
// 'report'); a blank verdict is derived from the row's numbers, unless the row
// already carries a human/report verdict, which is preserved.
//
// Staff session OR the script agent (AGENT_API_KEY); writes on the service-role
// client so the agent path isn't blocked by RLS.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user) && !isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const rows = body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "rows is required" }, { status: 400 });
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (max ${MAX_ROWS} per import).` }, { status: 400 });
  }

  const clean: Record<string, unknown>[] = [];
  for (const r of rows as ReportRow[]) {
    if (!r || typeof r.ad_name !== "string" || !r.ad_name.trim()) {
      return NextResponse.json({ error: "Every row needs an ad_name." }, { status: 400 });
    }
    if (r.verdict != null && !REPORT_VERDICTS.has(r.verdict)) {
      return NextResponse.json({ error: `Invalid verdict "${r.verdict}".` }, { status: 400 });
    }
    const row: Record<string, unknown> = {
      ad_name: r.ad_name.trim(),
      flight_label: typeof r.flight_label === "string" && r.flight_label.trim() ? r.flight_label.trim() : "default",
      flight_start: typeof r.flight_start === "string" ? r.flight_start : null,
      verdict: r.verdict ?? null,
      reason: typeof r.reason === "string" ? r.reason : null,
    };
    for (const f of NUMBER_FIELDS) {
      const v = r[f as keyof ReportRow];
      row[f] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    clean.push(row);
  }

  // Dedupe on the conflict key (last wins) — Postgres refuses an upsert batch
  // that touches the same (ad_name, flight_label) twice. The UI parser already
  // dedupes; this covers direct API callers.
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of clean) byKey.set(`${row.ad_name}\u0000${row.flight_label}`, row);
  const deduped = [...byKey.values()];

  // Staff session already authorized via RLS, but the agent path has no session,
  // and refreshAll needs the service role regardless — do it all on admin.
  const admin = createAdminClient();

  // Existing verdicts for the batch keys, so a blank cell preserves a prior
  // human/report call instead of silently deriving over it.
  const target = defaultTargetCents();
  const names = [...new Set(deduped.map((r) => r.ad_name as string))];
  const { data: existingRows } = await admin
    .from("creative_metrics")
    .select("ad_name, flight_label, verdict, verdict_source")
    .in("ad_name", names);
  const existing = new Map<string, { verdict: string | null; verdict_source: string | null }>();
  for (const r of existingRows ?? []) existing.set(`${r.ad_name}\u0000${r.flight_label}`, r);

  for (const row of deduped) {
    let verdict: Verdict | null;
    let verdictSource: VerdictSource;
    const raw = row.verdict as Verdict | null;
    if (raw != null) {
      verdict = raw;
      verdictSource = "report";
    } else {
      const prior = existing.get(`${row.ad_name}\u0000${row.flight_label}`);
      if (prior?.verdict != null && (prior.verdict_source === "user" || prior.verdict_source === "report")) {
        verdict = prior.verdict as Verdict;
        verdictSource = prior.verdict_source as VerdictSource;
      } else {
        verdict = deriveVerdict(
          {
            spend: (row.spend as number | null) ?? 0,
            results: (row.conversions as number | null) ?? 0,
            cpt: (row.cpa as number | null) ?? null,
            ctr: (row.ctr as number | null) ?? null,
            firstDate: (row.flight_start as string | null) ?? null,
          },
          target,
        );
        verdictSource = "auto";
      }
    }
    row.verdict = verdict;
    row.verdict_source = verdictSource;
    row.updated_at = new Date().toISOString();
  }

  const { error } = await admin
    .from("creative_metrics")
    .upsert(deduped, { onConflict: "ad_name,flight_label" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Which of these names actually join to a concept?
  const { data: matched } = await admin.from("creatives").select("ad_name").in("ad_name", names);
  const matchedSet = new Set((matched ?? []).map((m) => m.ad_name));
  const unmatched = names.filter((n) => !matchedSet.has(n));

  // Rebuild the loop's stores now that the metrics changed.
  const refresh = await refreshAll(admin);

  return NextResponse.json({
    imported: deduped.length,
    matched: names.length - unmatched.length,
    unmatched,
    refresh,
  });
}
