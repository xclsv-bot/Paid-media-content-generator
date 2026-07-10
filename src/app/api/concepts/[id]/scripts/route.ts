import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { insertNextScriptVersion } from "@/lib/scripts";
import { getGoldenExamples, findDuplicateScript } from "@/lib/loop/golden";

// POST /api/concepts/:id/scripts  { body, approve?, allow_duplicate? }
// Staff writes a human script version (e.g. editing an AI draft). New version,
// source = 'human', approved immediately if approve = true. The output
// diversity gate applies here too: a hand-pasted near-copy of a golden script
// must not reach persistence (or approval) — the generate/revise routes gate
// their output, and this is the manual path into the same table.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: conceptId } = await params;
  const { body, approve, allow_duplicate } = await req.json();
  if (!body || typeof body !== "string") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const supabase = await createClient();

  if (!allow_duplicate) {
    const { data: c } = await supabase.from("creatives").select("org_id").eq("id", conceptId).single();
    if (c?.org_id) {
      const { examples } = await getGoldenExamples(supabase, c.org_id, 50);
      const dup = findDuplicateScript(body, examples);
      if (dup) {
        return NextResponse.json(
          {
            error: `This script near-duplicates a golden example ("${dup}"). Vary it, or resubmit with allow_duplicate:true to override.`,
            duplicate_of: dup,
          },
          { status: 422 },
        );
      }
    }
  }

  const { data, error } = await insertNextScriptVersion(supabase, conceptId, {
    body,
    source: "human",
    status: approve ? "approved" : "draft",
    created_by: user!.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ script: data }, { status: 201 });
}
