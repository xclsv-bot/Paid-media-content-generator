import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/concepts/:id/duplicate — clone a concept as a fresh Backlog test (staff).
// Copies the creative meaning (hook, hypothesis, angle, etc.) but not its identity:
// new row, no sheet_id, not proven, Backlog, Planned, and no videos/scripts/perf.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();
  const { data: src, error: readErr } = await supabase
    .from("creatives")
    .select(
      "concept_family_id, hook_line, hypothesis, content_summary, hook_angle, archetype, feature_pillar, sport, format, cta, variant_differentiator, compliance_note, org_id",
    )
    .eq("id", id)
    .single();
  if (readErr || !src) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("creatives")
    .insert({
      ...src,
      hook_line: `${src.hook_line} (copy)`,
      idea_status: "Backlog",
      is_proven: false,
      status: "Planned",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
