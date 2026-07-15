import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/deliverables/assign  { conceptIds: string[], assignee_id }
// Staff bulk-assign a creator to concepts' EXISTING week slots (a concept not
// scheduled into any week has no slot to assign — those come back in
// `unscheduled` so the UI can say so instead of silently skipping).
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { conceptIds, assignee_id: assigneeId } = (await req.json().catch(() => ({}))) as {
    conceptIds?: string[];
    assignee_id?: string | null;
  };
  if (!Array.isArray(conceptIds) || conceptIds.length === 0) {
    return NextResponse.json({ error: "conceptIds required" }, { status: 400 });
  }
  if (typeof assigneeId !== "string" || !assigneeId) {
    return NextResponse.json({ error: "assignee_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("deliverables")
    .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
    .in("concept_id", conceptIds)
    .select("concept_id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const touched = new Set((updated ?? []).map((d) => d.concept_id));
  const unscheduled = conceptIds.filter((id) => !touched.has(id));
  return NextResponse.json({ assigned: touched.size, unscheduled });
}
