import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { CREATOR_STATUSES, PROD_STATUSES } from "@/lib/deliverables";

// PATCH /api/deliverables/:id  { assignee_id?, due_date?, production_status? }
// Staff edit any field. A creator may change only production_status on their own
// deliverable (RLS enforces assignee = self), and only within CREATOR_STATUSES.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const staff = isStaff(user);
  if (!user || (!staff && user.role !== "creator")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (staff) {
    if ("assignee_id" in body) patch.assignee_id = body.assignee_id || null;
    if ("due_date" in body) patch.due_date = body.due_date || null;
  }
  if ("production_status" in body) {
    const allowed = staff ? PROD_STATUSES : CREATOR_STATUSES;
    if (!allowed.includes(body.production_status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.production_status = body.production_status;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deliverables")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deliverable: data });
}

// DELETE /api/deliverables/:id — staff remove a concept from the cycle.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();
  const { error } = await supabase.from("deliverables").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
