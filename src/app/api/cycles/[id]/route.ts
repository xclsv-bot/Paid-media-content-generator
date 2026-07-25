import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/cycles/:id  { status?, label? }  — staff change a cycle's status
// and/or rename it. Activating one cycle demotes any other Active cycle to
// Closed (only one active per org).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { status, label } = await req.json();
  const labelClean = typeof label === "string" ? label.trim().slice(0, 80) : undefined;
  if (label !== undefined && !labelClean) {
    return NextResponse.json({ error: "The label can't be empty" }, { status: 400 });
  }
  if (status === undefined && labelClean === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  if (status !== undefined && !["Planning", "Active", "Closed"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const supabase = await createClient();

  // Confirm the cycle exists (and get its org) BEFORE mutating anything — a PATCH
  // to a bad/deleted id must not demote the live Active cycle and then 500.
  const { data: target } = await supabase
    .from("cycles")
    .select("id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Demote any other Active cycle IN THE SAME ORG, then promote this one. The
  // partial unique index cycles_one_active (migration 0012, org-scoped since
  // 0015) is per org_id, so activations in different orgs never collide; on a
  // same-org race (23505) we retry. Re-activating the already-active cycle is
  // a harmless no-op.
  const activate = () =>
    supabase
      .from("cycles")
      .update({ status: "Closed" })
      .eq("status", "Active")
      .eq("org_id", target.org_id)
      .neq("id", id)
      .then(() =>
        supabase.from("cycles").update({ status: "Active" }).eq("id", id).select().maybeSingle(),
      );

  let result = null;
  if (status !== undefined) {
    if (status === "Active") {
      result = await activate();
      let attempts = 1;
      while (result.error?.code === "23505" && attempts < 5) {
        result = await activate();
        attempts++;
      }
    } else {
      result = await supabase
        .from("cycles")
        .update({ status })
        .eq("id", id)
        .select()
        .maybeSingle();
    }
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    if (!result.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (labelClean !== undefined) {
    result = await supabase
      .from("cycles")
      .update({ label: labelClean })
      .eq("id", id)
      .select()
      .maybeSingle();
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    if (!result.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ cycle: result!.data });
}
