import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/concepts/:id/notes  { body }
// Internal production discussion (creator ↔ staff). RLS scopes creators to their
// assigned concepts; clients have no policy and can't post or read.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || (!isStaff(user) && user.role !== "creator")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: conceptId } = await params;
  const { body } = await req.json();
  if (!body || !String(body).trim()) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_notes")
    .insert({
      concept_id: conceptId,
      author_id: user.id,
      author_name: user.name ?? user.email,
      author_role: user.role,
      body: String(body).trim(),
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data }, { status: 201 });
}
