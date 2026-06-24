-- ============================================================================
-- 0002_storage.sql — private bucket for creative videos
-- ============================================================================
-- The bucket is PRIVATE. We never expose it to the browser directly:
--   * Editor upload  -> server mints a signed UPLOAD url (service role) -> browser
--     uploads straight to storage. Keeps large files off the Next API route
--     (Vercel's ~4.5MB body limit) and off the DB.
--   * Partner download -> server mints a signed DOWNLOAD url with a forced
--     attachment filename so the original master file downloads for Meta upload.
-- Because signed URLs are minted with the service role (which bypasses RLS),
-- we don't need per-row storage.objects policies for the authenticated role.
-- Authorization is enforced in the API routes against creatives/RLS first.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'creative-videos',
  'creative-videos',
  false,
  2147483648,                                  -- 2 GB ceiling per file
  array['video/mp4','video/quicktime','video/webm']
)
on conflict (id) do nothing;
