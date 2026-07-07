import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio, TranscribeNotConfigured, WHISPER_MAX_BYTES } from "@/lib/transcribe";

export const maxDuration = 300;

const REFERENCES_BUCKET = process.env.SUPABASE_REFERENCES_BUCKET || "references";

// GET /api/ideation-references — staff: the reference library (recent first).
export async function GET() {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("ideation_references")
    .select("id, title, file_name, transcript, transcript_status, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  return NextResponse.json({ references: data ?? [] });
}

// POST /api/ideation-references  { fileName, storagePath, title? }
// Staff-only. Registers an uploaded reference clip and transcribes it (Whisper),
// returning the transcript so Ideate can add it as a source.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { fileName, storagePath, title } = await req.json();
  if (!fileName || !storagePath) {
    return NextResponse.json({ error: "fileName and storagePath are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("ideation_references")
    .insert({ file_name: fileName, storage_path: storagePath, title: title || null, transcript_status: "pending", created_by: user!.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const admin = createAdminClient();
  try {
    const { data: blob, error: dlErr } = await admin.storage.from(REFERENCES_BUCKET).download(storagePath);
    if (dlErr || !blob) throw new Error(dlErr?.message ?? "Could not read the file");
    if (blob.size > WHISPER_MAX_BYTES) {
      await admin.from("ideation_references").update({ transcript_status: "failed" }).eq("id", row.id);
      return NextResponse.json({ error: "Clip is over Whisper's 25 MB limit." }, { status: 413 });
    }

    const transcript = await transcribeAudio(blob, fileName);
    await admin.from("ideation_references").update({ transcript, transcript_status: "done" }).eq("id", row.id);
    return NextResponse.json({ id: row.id, fileName, transcript });
  } catch (e) {
    await admin.from("ideation_references").update({ transcript_status: "failed" }).eq("id", row.id);
    if (e instanceof TranscribeNotConfigured) return NextResponse.json({ error: e.message, id: row.id }, { status: 503 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Transcription failed", id: row.id }, { status: 500 });
  }
}
