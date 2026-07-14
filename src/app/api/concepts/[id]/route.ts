import { NextResponse, after } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshBreakdowns } from "@/lib/loop/breakdowns-refresh";

const ARCHETYPES = ["Qualifier", "Broad-appeal", "Mixed"];
const IDEA_STATUSES = ["Backlog", "Testing", "Winner", "Parked"];

// PATCH /api/concepts/:id — edit brief fields (staff).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const b = await req.json();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const textFields = [
    "hook_line", "hypothesis", "content_summary", "hook_angle",
    "feature_pillar", "sport", "format", "cta", "variant_differentiator",
    "compliance_note", "script_doc_url", "ad_name",
  ];
  for (const f of textFields) if (f in b) patch[f] = b[f] || null;
  if ("archetype" in b) patch.archetype = ARCHETYPES.includes(b.archetype) ? b.archetype : null;
  if ("idea_status" in b && IDEA_STATUSES.includes(b.idea_status)) patch.idea_status = b.idea_status;
  if ("is_proven" in b) patch.is_proven = !!b.is_proven;

  const supabase = await createClient();

  // Marking a concept "Winner" is invisible curation (like recording a CPA):
  // it should generate the concept's breakdown for Ideate; un-marking should
  // retire it. Read the current status first so we only refresh on a real
  // transition to/from Winner, not on every brief edit.
  let winnerFlip = false;
  if (typeof patch.idea_status === "string") {
    const { data: current } = await supabase
      .from("creatives")
      .select("idea_status")
      .eq("id", id)
      .single();
    winnerFlip =
      !!current &&
      current.idea_status !== patch.idea_status &&
      (current.idea_status === "Winner" || patch.idea_status === "Winner");
  }

  const { error } = await supabase.from("creatives").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (winnerFlip) {
    // Post-response: breakdown generation can involve a model call. Scoped to
    // this creative so a status flip never triggers a full-store sweep.
    after(() => refreshBreakdowns(createAdminClient(), { creativeIds: [id] }).catch(() => {}));
  }
  return NextResponse.json({ ok: true });
}
