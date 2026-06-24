import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedDownload } from "@/lib/storage";

// GET /api/videos/:id/download
// Any user who can SEE the parent creative (RLS) — including the Outlier client —
// gets a short-lived signed URL that downloads the original master file.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = await createClient();

  // RLS: returns the row only if the user is allowed to see its creative.
  const { data: asset } = await supabase
    .from("video_assets")
    .select("id, storage_path, file_name")
    .eq("id", id)
    .single();

  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const url = await createSignedDownload(asset.storage_path, asset.file_name);
    return NextResponse.json({ url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to sign download" },
      { status: 500 },
    );
  }
}
