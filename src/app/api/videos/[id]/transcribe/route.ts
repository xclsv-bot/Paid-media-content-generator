import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio, TranscribeNotConfigured, WHISPER_MAX_BYTES } from "@/lib/transcribe";

export const maxDuration = 300; // transcription can take a bit; capped to plan max

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "creative-videos";

// POST /api/videos/:id/transcribe — transcribe the stored clip with Whisper and
// save it on the video_asset. Staff or the creator who can see the video. Runs
// after upload (VideoUploader fires it); safe to re-run.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || (!isStaff(user) && user.role !== "creator")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const supabase = await createClient();

  // RLS: only returns the row if the caller may see it.
  const { data: asset } = await supabase
    .from("video_assets")
    .select("id, storage_path, file_name, size_bytes")
    .eq("id", id)
    .single();
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();

  if (asset.size_bytes && Number(asset.size_bytes) > WHISPER_MAX_BYTES) {
    await admin.from("video_assets").update({ transcript_status: "failed" }).eq("id", id);
    return NextResponse.json({ error: "Clip is over Whisper's 25 MB limit." }, { status: 413 });
  }

  await admin.from("video_assets").update({ transcript_status: "pending" }).eq("id", id);

  try {
    const { data: blob, error: dlErr } = await admin.storage.from(BUCKET).download(asset.storage_path);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Could not read the file");

    const transcript = await transcribeAudio(blob, asset.file_name);

    await admin
      .from("video_assets")
      .update({ transcript, transcript_status: "done", transcribed_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ transcript });
  } catch (e) {
    await admin.from("video_assets").update({ transcript_status: "failed" }).eq("id", id);
    if (e instanceof TranscribeNotConfigured) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Transcription failed" }, { status: 500 });
  }
}
