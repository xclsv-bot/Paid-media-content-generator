import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const STATUSES = ["draft", "published", "archived"];

// PATCH /api/cross-client-patterns/:id — staff edit fields and/or transition
// status (draft -> published -> archived).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const b = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const textFields = ["title", "pattern_type", "generalized_summary", "why_it_works", "applicable_archetype", "applicable_vertical"];
  for (const f of textFields) if (f in b) patch[f] = b[f] || null;
  if ("status" in b) {
    if (!STATUSES.includes(b.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = b.status;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cross_client_patterns")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pattern: data });
}
