import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { deleteStoredVideo } from "@/lib/storage";

// DELETE /api/videos/:id — staff removes a video asset: the stored master file
// and its row. RLS (va_write) also gates the row delete to staff.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  const { data: asset } = await supabase
    .from("video_assets")
    .select("id, storage_path")
    .eq("id", id)
    .single();
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Remove the file first (best-effort), then the row so nothing dangles.
  try {
    await deleteStoredVideo(asset.storage_path);
  } catch {
    // A missing/failed storage delete shouldn't block clearing the row.
  }

  const { error } = await supabase.from("video_assets").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
