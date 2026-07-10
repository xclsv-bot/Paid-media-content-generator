import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getGoldenExamples, findDuplicateScript } from "@/lib/loop/golden";

// POST /api/scripts/:id/approve  { allow_duplicate? }
// Staff approves a script version as-is. Approval is a hard gate for the
// diversity guard: a near-copy of a golden script must not become "approved"
// (the state that reaches a creator), even if it slipped into the table via an
// older/unguarded path. Re-check the body here before flipping the status.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { allow_duplicate } = await req.json().catch(() => ({}));
  const supabase = await createClient();

  const { data: script } = await supabase
    .from("scripts")
    .select("id, body, concept_id")
    .eq("id", id)
    .single();
  if (!script) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  if (!allow_duplicate) {
    const { data: c } = await supabase.from("creatives").select("org_id").eq("id", script.concept_id).single();
    if (c?.org_id) {
      const { examples } = await getGoldenExamples(supabase, c.org_id, 50);
      const dup = findDuplicateScript(script.body as string, examples);
      if (dup) {
        return NextResponse.json(
          {
            error: `This script near-duplicates a golden example ("${dup}"). Revise it, or resubmit with allow_duplicate:true to override.`,
            duplicate_of: dup,
          },
          { status: 422 },
        );
      }
    }
  }

  const { data, error } = await supabase
    .from("scripts")
    .update({ status: "approved" })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ script: data });
}
