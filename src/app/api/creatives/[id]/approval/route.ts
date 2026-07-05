import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const STATES = ["Pending", "Approved", "Changes requested"];

// POST /api/creatives/:id/approval  { state }
// Client (own org) or staff sets the approval state. RLS (can_see_creative) scopes it.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: creativeId } = await params;
  const { state } = await req.json();
  if (!STATES.includes(state)) {
    return NextResponse.json({ error: "Invalid state" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("approvals")
    .upsert(
      { creative_id: creativeId, state, actor_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: "creative_id" },
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ approval: data });
}
