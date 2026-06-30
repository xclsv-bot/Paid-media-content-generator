import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/cycles/:id  { status }  — staff change a cycle's status.
// Activating one cycle demotes any other Active cycle to Closed (only one active).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { status } = await req.json();
  if (!["Planning", "Active", "Closed"].includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const supabase = await createClient();

  // Demote any other Active cycle, then promote this one. The partial unique
  // index cycles_one_active (migration 0007) guarantees at most one Active even
  // if two activations race; on the unique violation (23505) we retry.
  // Re-activating the already-active cycle is a harmless no-op.
  const activate = () =>
    supabase
      .from("cycles")
      .update({ status: "Closed" })
      .eq("status", "Active")
      .neq("id", id)
      .then(() =>
        supabase.from("cycles").update({ status: "Active" }).eq("id", id).select().single(),
      );

  let result;
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
      .single();
  }

  const { data, error } = result;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cycle: data });
}
