import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/cycles  { label, starts_on, ends_on, target_count? }  — staff create a weekly drop.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { label, starts_on, ends_on, target_count, org_id } = await req.json();
  if (!label || !starts_on || !ends_on) {
    return NextResponse.json(
      { error: "label, starts_on, ends_on are required" },
      { status: 400 },
    );
  }
  if (!org_id) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cycles")
    .insert({
      label,
      starts_on,
      ends_on,
      target_count: target_count ?? 15,
      org_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ cycle: data }, { status: 201 });
}
