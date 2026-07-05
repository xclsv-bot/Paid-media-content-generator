-- ============================================================================
-- 0012_organic_signals.sql — Organic content signal: staff-curated market
-- intelligence (what's trending organically on social, outside paid Meta
-- spend) that widens Ideate's hypothesis pool. See docs/MEETING_INSIGHTS_2026-06-25.md.
--
-- Global (no client_org column) — matches concept_families/hook_angles/learnings,
-- all already unscoped. No enum types for platform/format/sport/review_status/
-- source — matches concept_references.kind / script_reviews.verdict, neither of
-- which has a DB-level constraint; org_type and user_role have both needed
-- their own migration to add a value, and these fields need to grow freely.
-- ============================================================================

create table public.organic_signals (
  id                  uuid primary key default gen_random_uuid(),
  platform            text not null,                   -- e.g. 'tiktok' | 'instagram' | 'youtube_shorts' | 'other'
  platform_url        text,
  creator_handle      text,
  format              text,                             -- free text, same convention as creatives.format
  sport               text,                             -- free text, same convention as creatives.sport
  hook_summary        text not null,                    -- the observed hook/opening line or pattern
  content_notes       text,                             -- why it's working / structure / pacing
  engagement_snapshot jsonb,                             -- {views, likes, comments, shares, captured_at, ...}
  concept_family_id   uuid references public.concept_families (id),
  hook_angle_id       uuid references public.hook_angles (id),
  review_status       text not null default 'pending',   -- 'pending' | 'approved' | 'rejected' (app-validated)
  source              text not null default 'manual',    -- 'manual' | 'agent'
  external_ref        text,                              -- idempotency key for agent re-ingestion
  submitted_by        uuid references public.users (id),
  reviewed_by         uuid references public.users (id),
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now()
);

create index on public.organic_signals (review_status);
create index on public.organic_signals (concept_family_id);
create index on public.organic_signals (created_at desc);
create unique index organic_signals_platform_external_ref_key
  on public.organic_signals (platform, external_ref)
  where external_ref is not null;

-- ---------- RLS: staff-only in v1 (not creator- or client-facing) ----------
alter table public.organic_signals enable row level security;

create policy os_staff_all on public.organic_signals for all
  using (public.is_staff()) with check (public.is_staff());
