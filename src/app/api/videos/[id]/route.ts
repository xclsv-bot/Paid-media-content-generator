import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteStoredVideo } from "@/lib/storage";

// DELETE /api/videos/:id — remove a video asset (row + stored master file).
// Staff delete anything; a creator deletes only their OWN upload on an
// assigned concept, and only before the concept is published — all enforced
// by RLS (va_write / va_creator_delete, migration 0025), which is why the
// row goes first: the delete's affected-row count IS the authorization
// check. Only after the row is gone do we touch the file, so a refused
// delete can never leave a row pointing at a missing object.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || (!isStaff(user) && user.role !== "creator")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: deleted, error } = await supabase
    .from("video_assets")
    .delete()
    .eq("id", id)
    .select("id, storage_path");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!deleted || deleted.length === 0) {
    // RLS refused (not yours / not assigned / already published) or no row.
    return NextResponse.json(
      { error: "Not found — or this cut is already published, so removing it is a staff call." },
      { status: 404 },
    );
  }

  // Row is gone; clear the object best-effort (an orphaned file is invisible).
  try {
    await deleteStoredVideo(deleted[0].storage_path);
  } catch {
    // Storage cleanup failure shouldn't fail the request.
  }

  return NextResponse.json({ ok: true });
}
