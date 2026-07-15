import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { CREATOR_STATUSES, PROD_STATUSES } from "@/lib/deliverables";

// PATCH /api/deliverables/:id  { assignee_id?, due_date?, production_status?, cycle_id? }
// Staff edit any field — cycle_id moves the deliverable to another week (same
// client only), carrying its assignee/status/videos along. A creator may change
// only production_status on their own deliverable (RLS enforces assignee =
// self), and only within CREATOR_STATUSES.
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
  const supabase = await createClient();

  if (staff) {
    if ("assignee_id" in body) patch.assignee_id = body.assignee_id || null;
    if ("due_date" in body) patch.due_date = body.due_date || null;
    if ("cycle_id" in body) {
      const targetId = typeof body.cycle_id === "string" ? body.cycle_id : "";
      const [{ data: cur }, { data: target }] = await Promise.all([
        supabase.from("deliverables").select("cycle_id, cycles(org_id)").eq("id", id).single(),
        supabase.from("cycles").select("id, org_id").eq("id", targetId).single(),
      ]);
      if (!cur || !target) {
        return NextResponse.json({ error: "Unknown week" }, { status: 400 });
      }
      const curCycle = Array.isArray(cur.cycles) ? cur.cycles[0] : cur.cycles;
      if (curCycle?.org_id && curCycle.org_id !== target.org_id) {
        return NextResponse.json({ error: "That week belongs to a different client" }, { status: 400 });
      }
      patch.cycle_id = target.id;
    }
  }
  if ("production_status" in body) {
    const allowed = staff ? PROD_STATUSES : CREATOR_STATUSES;
    if (!allowed.includes(body.production_status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.production_status = body.production_status;
  }

  const { data, error } = await supabase
    .from("deliverables")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    // unique (cycle_id, concept_id): the concept is already scheduled there.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "This concept is already in that week — remove this row instead of moving it." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
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
