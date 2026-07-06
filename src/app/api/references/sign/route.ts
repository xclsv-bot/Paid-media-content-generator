import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createSignedReferenceUpload } from "@/lib/storage";

// Allow-list for reference uploads. Keep in sync with migration
// 0008_references_mime.sql (the bucket enforces the same set). image/svg+xml is
// intentionally excluded — it can carry script and is served inline.
const ALLOWED_REFERENCE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
]);
const ALLOWED_REFERENCE_EXTS = new Set([
  "pdf", "png", "jpg", "jpeg", "gif", "webp", "mp4", "mov",
]);

// POST /api/references/sign  { conceptId, fileName, contentType? }
// Staff-only. Signed upload target in the private 'references' bucket, gated to
// an allow-list of file types before any URL is minted.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { conceptId, fileName, contentType } = await req.json();
  if (!conceptId || !fileName) {
    return NextResponse.json(
      { error: "conceptId and fileName are required" },
      { status: 400 },
    );
  }

  const ext = String(fileName).split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_REFERENCE_EXTS.has(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type ".${ext}". Allowed: PDF, PNG, JPG, GIF, WEBP, MP4, MOV.` },
      { status: 400 },
    );
  }
  if (contentType && !ALLOWED_REFERENCE_TYPES.has(String(contentType))) {
    return NextResponse.json(
      { error: `Unsupported content type "${contentType}".` },
      { status: 400 },
    );
  }

  const safe = String(fileName).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = `${conceptId}/${Date.now()}_${safe}`;
  try {
    const signed = await createSignedReferenceUpload(path);
    return NextResponse.json({ path: signed.path, token: signed.token });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to sign upload" },
      { status: 500 },
    );
  }
}
