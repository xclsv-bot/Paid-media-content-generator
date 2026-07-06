-- ============================================================================
-- 0012_transcripts.sql — store a speech-to-text transcript per uploaded video.
-- ============================================================================
-- On upload we transcribe the clip (OpenAI Whisper) so we capture what was
-- actually said — the real hook/delivery — for later hook-level analysis
-- against performance. Written by the server (service role); readable by anyone
-- who can already see the video_asset (existing va_read/va_creator_read RLS).
-- ============================================================================

alter table public.video_assets
  add column if not exists transcript        text,
  add column if not exists transcript_status text,   -- 'pending' | 'done' | 'failed'
  add column if not exists transcribed_at     timestamptz;
