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

  // Confirm the cycle exists (and get its org) BEFORE mutating anything — a PATCH
  // to a bad/deleted id must not demote the live Active cycle and then 500.
  const { data: target } = await supabase
    .from("cycles")
    .select("id, client_org")
    .eq("id", id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Demote any other Active cycle IN THE SAME ORG, then promote this one. The
  // partial unique index cycles_one_active (migration 0007) is per client_org, so
  // activations in different orgs never collide; on a same-org race (23505) we
  // retry. Re-activating the already-active cycle is a harmless no-op.
  const activate = () =>
    supabase
      .from("cycles")
      .update({ status: "Closed" })
      .eq("status", "Active")
      .eq("client_org", target.client_org)
      .neq("id", id)
      .then(() =>
        supabase.from("cycles").update({ status: "Active" }).eq("id", id).select().maybeSingle(),
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
      .maybeSingle();
  }

  const { data, error } = result;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ cycle: data });
}
