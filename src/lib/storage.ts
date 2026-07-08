import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = process.env.SUPABASE_VIDEO_BUCKET || "creative-videos";

// Build a collision-proof key: <creativeId>/<version>/<uid>_<filename>.
// The short uid means re-submitting "v1" of the same file never collides with
// the existing object (signed uploads refuse to overwrite).
export function buildStoragePath(
  creativeId: string,
  versionLabel: string,
  fileName: string,
): string {
  const safeVersion = versionLabel.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const safeName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const uid = crypto.randomUUID().slice(0, 8);
  return `${creativeId}/${safeVersion}/${uid}_${safeName}`;
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
// to download (Content-Disposition: attachment) for hand-off to the ad platform.
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

// Remove a stored master file. Best-effort — a missing object is not fatal to
// the caller (the DB row is the source of truth we care about clearing).
export async function deleteStoredVideo(path: string) {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(BUCKET).remove([path]);
  if (error) throw error;
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
