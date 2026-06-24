import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedReferenceView } from "@/lib/storage";

// GET /api/references/:id/view — signed URL for a stored reference file.
// RLS on concept_references decides visibility (staff / assigned creator).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = await createClient();
  const { data: ref } = await supabase
    .from("concept_references")
    .select("id, kind, storage_path")
    .eq("id", id)
    .single();

  if (!ref || ref.kind !== "file" || !ref.storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const url = await createSignedReferenceView(ref.storage_path);
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 },
    );
  }
}
