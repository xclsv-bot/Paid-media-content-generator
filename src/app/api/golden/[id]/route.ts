import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/golden/:creativeId — curator actions on a golden example.
// Body: { action: "pin" | "remove" | "restore", why_it_won?: string }
//
//   pin     — keep this example regardless of performance drift; the refresh
//             never updates or prunes it. Optionally rewrite why_it_won.
//   remove  — tombstone it: excluded from consumers AND immune to
//             auto-populate. Only "restore" brings it back.
//   restore — hand it back to the auto pool; the next refresh re-snapshots it
//             if it still qualifies, or prunes it if it doesn't.
//
// Staff only (route gate + ge_staff_all RLS via the user-scoped client).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; why_it_won?: string };
  const action = body.action;
  if (action !== "pin" && action !== "remove" && action !== "restore") {
    return NextResponse.json(
      { error: "action must be one of: pin, remove, restore" },
      { status: 400 },
    );
  }

  const curation = { curated_by: user!.id, curated_at: new Date().toISOString() };
  const patch: Record<string, unknown> =
    action === "pin"
      ? { status: "pinned", source: "curated", ...curation }
      : action === "remove"
        ? { status: "removed", source: "curated", ...curation }
        : { status: "active", source: "auto", ...curation };
  if (action === "pin" && typeof body.why_it_won === "string" && body.why_it_won.trim()) {
    patch.why_it_won = body.why_it_won.trim();
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("golden_examples")
    .update(patch)
    .eq("creative_id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ example: data });
}
