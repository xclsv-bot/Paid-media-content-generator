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
  if (status === "Active") {
    await supabase
      .from("cycles")
      .update({ status: "Closed" })
      .eq("status", "Active")
      .neq("id", id);
  }

  const { data, error } = await supabase
    .from("cycles")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cycle: data });
}
