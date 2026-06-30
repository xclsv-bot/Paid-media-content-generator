import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { insertNextScriptVersion } from "@/lib/scripts";

// POST /api/concepts/:id/scripts  { body, approve? }
// Staff writes a human script version (e.g. editing an AI draft). New version,
// source = 'human', approved immediately if approve = true.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: conceptId } = await params;
  const { body, approve } = await req.json();
  if (!body || typeof body !== "string") {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await insertNextScriptVersion(supabase, conceptId, {
    body,
    source: "human",
    status: approve ? "approved" : "draft",
    created_by: user!.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ script: data }, { status: 201 });
}
