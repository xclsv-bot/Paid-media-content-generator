import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createSignedReferenceUpload } from "@/lib/storage";

const ALLOWED_EXTS = new Set(["mp4", "mov", "webm", "m4a", "mp3", "wav"]);

// POST /api/ideation-references/sign  { fileName }
// Staff-only. Signed upload target for a reference clip in the private
// 'references' bucket (under an ideation/ prefix). Whisper accepts video/audio.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { fileName } = await req.json();
  if (!fileName) return NextResponse.json({ error: "fileName is required" }, { status: 400 });

  const ext = String(fileName).split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTS.has(ext)) {
    return NextResponse.json({ error: `Unsupported file type: .${ext}` }, { status: 415 });
  }

  const safeName = String(fileName).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = `ideation/${crypto.randomUUID()}/${safeName}`;
  try {
    const signed = await createSignedReferenceUpload(path);
    return NextResponse.json({ path: signed.path, token: signed.token });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to sign upload" }, { status: 500 });
  }
}
