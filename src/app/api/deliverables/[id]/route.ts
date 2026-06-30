import { NextResponse } from "next/server";
import { getCurrentUser, isStaff, isCreator } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const STATUSES = [
  "Assigned",
  "In production",
  "Submitted",
  "In revision",
  "Approved",
  "Delivered",
];

// The forward-only statuses a creator may set on their own deliverable. The
// review outcomes (Approved, Delivered) and the back-to-start (Assigned) stay
// staff-only; assignee_id / due_date are staff-only too.
const CREATOR_STATUSES = ["In production", "Submitted", "In revision"];

// PATCH /api/deliverables/:id  { assignee_id?, due_date?, production_status? }
// Staff may edit any field. A creator may only advance production_status (within
// CREATOR_STATUSES) on a deliverable assigned to them — per-row ownership is
// enforced by RLS (deliverables_creator_update).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  const staff = isStaff(user);
  const creator = isCreator(user);
  if (!staff && !creator) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (creator) {
    // A creator may touch production_status only — nothing else.
    if ("assignee_id" in body || "due_date" in body) {
      return NextResponse.json(
        { error: "Creators may only change production_status" },
        { status: 403 },
      );
    }
    if (!("production_status" in body)) {
      return NextResponse.json({ error: "production_status is required" }, { status: 400 });
    }
    if (!CREATOR_STATUSES.includes(body.production_status)) {
      return NextResponse.json(
        { error: `Creators may only set: ${CREATOR_STATUSES.join(", ")}` },
        { status: 403 },
      );
    }
    patch.production_status = body.production_status;
  } else {
    if ("assignee_id" in body) patch.assignee_id = body.assignee_id || null;
    if ("due_date" in body) patch.due_date = body.due_date || null;
    if ("production_status" in body) {
      if (!STATUSES.includes(body.production_status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      patch.production_status = body.production_status;
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("deliverables")
    .update(patch)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // No row updated → either it doesn't exist or RLS hid it (e.g. a creator acting
  // on a deliverable that isn't theirs). Don't leak which; return 404.
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
