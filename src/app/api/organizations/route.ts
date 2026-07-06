import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// GET /api/organizations — staff-only. Populates the "which client is this
// for" selector on concept/cycle creation and Ideate, and the promote-pattern
// form. No client_viewer/creator use case for this list.
export async function GET() {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .order("display_name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ organizations: data ?? [] });
}
