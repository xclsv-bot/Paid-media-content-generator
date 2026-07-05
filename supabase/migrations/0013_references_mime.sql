-- 0008_references_mime.sql
-- Restrict the `references` bucket to a known set of content types.
--
-- The bucket (created in 0006) had a 500 MB size limit but NO allowed_mime_types,
-- so any file type could be uploaded and is then served *inline* via a signed
-- view URL — a stored-content risk (e.g. HTML/SVG served from the storage
-- domain). This mirrors the restriction the creative-videos bucket already has
-- (0002). image/svg+xml is intentionally excluded (it can carry script).
--
-- Keep this list in sync with ALLOWED_REFERENCE_TYPES in
-- src/app/api/references/sign/route.ts.
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/quicktime'
]
where id = 'references';
