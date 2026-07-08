import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/concepts/:id/references
//   link: { kind:'link', url, label? }
//   file: { kind:'file', storagePath, label? }  (after uploading via /api/references/sign)
// Staff-only.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: conceptId } = await params;
  const { kind = "link", url, storagePath, label } = await req.json();

  if (kind === "file" && !storagePath) {
    return NextResponse.json({ error: "storagePath required for file" }, { status: 400 });
  }
  // Bind stored paths to this concept's prefix (what /api/references/sign
  // mints) so a reference row can't alias another object in the bucket.
  if (
    kind === "file" &&
    (String(storagePath).includes("..") || !String(storagePath).startsWith(`${conceptId}/`))
  ) {
    return NextResponse.json({ error: "Invalid storagePath" }, { status: 400 });
  }
  if (kind === "link" && !url) {
    return NextResponse.json({ error: "url required for link" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("concept_references")
    .insert({
      concept_id: conceptId,
      kind,
      url: kind === "file" ? storagePath : url,
      storage_path: kind === "file" ? storagePath : null,
      label: label || null,
      uploaded_by: user!.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reference: data }, { status: 201 });
}
