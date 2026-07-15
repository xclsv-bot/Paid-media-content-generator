import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/cycles/:id/deliverables  { conceptIds: string[], assignee_id? }
// Staff add concepts to a cycle. Duplicates are ignored (unique cycle_id+concept_id).
// When assignee_id is present, every listed concept's slot in this cycle gets
// that creator — including slots that already existed before this call.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: cycleId } = await params;
  const { conceptIds, assignee_id: assigneeId } = await req.json();
  if (!Array.isArray(conceptIds) || conceptIds.length === 0) {
    return NextResponse.json({ error: "conceptIds required" }, { status: 400 });
  }

  const supabase = await createClient();

  // A cycle belongs to one org — guard against scheduling a concept from a
  // different org into it (the picker UI already scopes to the cycle's org;
  // this is the API-level backstop).
  const { data: cycle } = await supabase.from("cycles").select("org_id").eq("id", cycleId).maybeSingle();
  if (!cycle) return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  const { data: concepts } = await supabase.from("creatives").select("id, org_id").in("id", conceptIds);
  const mismatched = (concepts ?? []).filter((c) => c.org_id !== cycle.org_id);
  if (mismatched.length > 0) {
    return NextResponse.json({ error: "One or more concepts belong to a different client than this cycle" }, { status: 400 });
  }

  const rows = conceptIds.map((concept_id: string) => ({
    cycle_id: cycleId,
    concept_id,
  }));

  const { data, error } = await supabase
    .from("deliverables")
    .upsert(rows, { onConflict: "cycle_id,concept_id", ignoreDuplicates: true })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let assigned = 0;
  if (typeof assigneeId === "string" && assigneeId) {
    const { data: upd, error: aErr } = await supabase
      .from("deliverables")
      .update({ assignee_id: assigneeId, updated_at: new Date().toISOString() })
      .eq("cycle_id", cycleId)
      .in("concept_id", conceptIds)
      .select("id");
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });
    assigned = upd?.length ?? 0;
  }
  return NextResponse.json({ added: data?.length ?? 0, assigned }, { status: 201 });
}
