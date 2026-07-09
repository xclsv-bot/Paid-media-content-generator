import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// GET /api/winners?sport=NFL&limit=50
// The reusable proven-content feed for the internal Winners page. Carries
// internal spend/score figures, so it is staff-only.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const sport = searchParams.get("sport");
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 50, 1), 200);

  const supabase = await createClient();
  let q = supabase
    .from("content_cache")
    .select("creative_id, org_id, score, cpt_cents, results, spend_cents, sport, hook_angle, archetype, captured_at, creatives(hook_line, sheet_id), concept_families(name), organizations(display_name)")
    .order("score", { ascending: false })
    .limit(limit);
  if (sport) q = q.eq("sport", sport);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ winners: data ?? [] });
}
