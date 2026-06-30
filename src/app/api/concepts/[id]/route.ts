import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ARCHETYPES = ["Qualifier", "Broad-appeal", "Mixed"];
const IDEA_STATUSES = ["Backlog", "Testing", "Winner", "Parked"];

// PATCH /api/concepts/:id — edit brief fields (staff).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const b = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const textFields = [
    "hook_line", "hypothesis", "content_summary", "hook_angle",
    "feature_pillar", "sport", "format", "cta", "variant_differentiator",
    "compliance_note", "script_doc_url",
  ];
  for (const f of textFields) if (f in b) patch[f] = b[f] || null;
  if ("archetype" in b) patch.archetype = ARCHETYPES.includes(b.archetype) ? b.archetype : null;
  if ("idea_status" in b && IDEA_STATUSES.includes(b.idea_status)) patch.idea_status = b.idea_status;
  if ("is_proven" in b) patch.is_proven = !!b.is_proven;

  const supabase = await createClient();
  const { error } = await supabase.from("creatives").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
