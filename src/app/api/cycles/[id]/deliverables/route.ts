import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/cycles/:id/deliverables  { conceptIds: string[] }
// Staff add concepts to a cycle. Duplicates are ignored (unique cycle_id+concept_id).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: cycleId } = await params;
  const { conceptIds } = await req.json();
  if (!Array.isArray(conceptIds) || conceptIds.length === 0) {
    return NextResponse.json({ error: "conceptIds required" }, { status: 400 });
  }

  const supabase = await createClient();
  const rows = conceptIds.map((concept_id: string) => ({
    cycle_id: cycleId,
    concept_id,
  }));

  const { data, error } = await supabase
    .from("deliverables")
    .upsert(rows, { onConflict: "cycle_id,concept_id", ignoreDuplicates: true })
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ added: data?.length ?? 0 }, { status: 201 });
}
