import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { ReportRow } from "@/lib/metrics/report";

const VERDICTS = new Set(["GRADUATE", "KEEP_TESTING", "KILL"]);
const NUM_FIELDS = [
  "spend", "conversions", "cpa", "ctr", "bau_cpa", "cpm", "cpi", "cps", "icvr", "scvr", "aov", "roas",
] as const;
const MAX_ROWS = 500;

// POST /api/metrics  { rows: ReportRow[] }
// Staff paste the weekly report; rows upsert into creative_metrics keyed on
// (ad_name, flight_label). Responds with which ad names matched a concept —
// an unmatched name is almost always a naming-convention typo, and catching
// it here is what keeps the performance loop joined up.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    if (r.verdict != null && !VERDICTS.has(r.verdict)) {
      return NextResponse.json({ error: `Invalid verdict "${r.verdict}".` }, { status: 400 });
    }
    const row: Record<string, unknown> = {
      ad_name: r.ad_name.trim(),
      flight_label: typeof r.flight_label === "string" && r.flight_label.trim() ? r.flight_label.trim() : "default",
      flight_start: typeof r.flight_start === "string" ? r.flight_start : null,
      verdict: r.verdict ?? null,
      reason: typeof r.reason === "string" ? r.reason : null,
    };
    for (const f of NUM_FIELDS) {
      const v = r[f];
      row[f] = typeof v === "number" && Number.isFinite(v) ? v : null;
    }
    clean.push(row);
  }

  // Session client: cm_staff_all RLS authorizes the write, no service role.
  const supabase = await createClient();
  const { error } = await supabase
    .from("creative_metrics")
    .upsert(clean, { onConflict: "ad_name,flight_label" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Which of these names actually join to a concept?
  const names = [...new Set(clean.map((r) => r.ad_name as string))];
  const { data: matched } = await supabase
    .from("creatives")
    .select("ad_name")
    .in("ad_name", names);
  const matchedSet = new Set((matched ?? []).map((m) => m.ad_name));
  const unmatched = names.filter((n) => !matchedSet.has(n));

  return NextResponse.json({
    imported: clean.length,
    matched: names.length - unmatched.length,
    unmatched,
  });
}
