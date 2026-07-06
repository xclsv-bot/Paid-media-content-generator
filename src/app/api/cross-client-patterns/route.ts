import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// GET /api/cross-client-patterns — staff, list all statuses (management UI).
export async function GET() {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cross_client_patterns")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ patterns: data ?? [] });
}

// POST /api/cross-client-patterns — staff, create a draft pattern. Always
// lands as status='draft', authored_by=self — there is no way to pre-approve
// on create; a human must write the abstraction and publish it separately
// (POST never auto-copies raw learnings/family text into generalized_summary).
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json();
  if (!b.title || !String(b.title).trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!b.generalized_summary || !String(b.generalized_summary).trim()) {
    return NextResponse.json({ error: "generalized_summary is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cross_client_patterns")
    .insert({
      title: b.title,
      pattern_type: b.pattern_type || "hook",
      generalized_summary: b.generalized_summary,
      why_it_works: b.why_it_works || null,
      applicable_archetype: b.applicable_archetype || null,
      applicable_vertical: b.applicable_vertical || null,
      source_org_id: b.source_org_id || null,
      authored_by: user!.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pattern: data }, { status: 201 });
}
