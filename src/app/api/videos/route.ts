import { NextResponse } from "next/server";
import { getCurrentUser, canUploadVideo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/videos  — register a VideoAsset row AFTER the browser finished the
// direct upload to storage. Staff or an assigned creator; RLS (va_creator_write)
// enforces per-row that a creator can only insert for an assigned concept.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!canUploadVideo(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    creativeId,
    storagePath,
    fileName,
    versionLabel = "v1",
    sizeBytes = null,
    durationS = null,
    contentType = "video/mp4",
  } = body;

  if (!creativeId || !storagePath || !fileName) {
    return NextResponse.json(
      { error: "creativeId, storagePath and fileName are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("video_assets")
    .insert({
      creative_id: creativeId,
      storage_path: storagePath,
      file_name: fileName,
      version_label: versionLabel,
      size_bytes: sizeBytes,
      duration_s: durationS,
      content_type: contentType,
      uploaded_by: user!.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ video: data }, { status: 201 });
}
