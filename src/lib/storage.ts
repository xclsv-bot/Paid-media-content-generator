import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "creative-videos";

// Build a stable, collision-resistant key: <creativeId>/<version>/<filename>
export function buildStoragePath(
  creativeId: string,
  versionLabel: string,
  fileName: string,
): string {
  const safeVersion = versionLabel.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return `${creativeId}/${safeVersion}/${safeName}`;
}

// Editor flow: mint a one-time signed URL the browser uploads straight to.
export async function createSignedUpload(path: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return data; // { signedUrl, token, path }
}

// Partner flow: mint a time-limited download URL that forces the original file
// to download (Content-Disposition: attachment) so it can be uploaded to Meta.
export async function createSignedDownload(
  path: string,
  fileName: string,
  expiresInSeconds = 60 * 10,
) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds, { download: fileName });
  if (error) throw error;
  return data.signedUrl;
}

// Streaming URL for in-app playback (inline, not forced download).
export async function createSignedStream(path: string, expiresInSeconds = 60 * 60) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

// ---------- references bucket (production materials: PDFs, clips, images) ----------
const REFERENCES_BUCKET =
  process.env.SUPABASE_REFERENCES_BUCKET || "references";

export async function createSignedReferenceUpload(path: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(REFERENCES_BUCKET)
    .createSignedUploadUrl(path);
  if (error) throw error;
  return data; // { signedUrl, token, path }
}

// Inline view URL for a stored reference file.
export async function createSignedReferenceView(
  path: string,
  expiresInSeconds = 60 * 60,
) {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(REFERENCES_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}
