-- ============================================================================
-- 0009_content_cache.sql — Winners Cache
-- ============================================================================
-- A durable, sport-keyed store of "strong performing" creatives (proven content)
-- so the team can reuse them as templates for the next slate without re-running
-- the all-time performance aggregation each time.
--
-- A creative earns a row here when it is a Hit (CPT <= target) AND has cleared a
-- minimum-volume bar (see src/lib/winners.ts). The row is a SNAPSHOT of its
-- performance at capture time plus a rank `score`; POST /api/winners/refresh
-- recomputes the set (upsert winners, prune the rest).
-- ============================================================================

create table if not exists public.content_cache (
  creative_id       uuid primary key references public.creatives (id) on delete cascade,
  client_org        org_type not null,            -- scoping (sportsbook client)
  score             numeric not null,             -- rank key, higher = better
  cpt_cents         integer,                      -- snapshot: cost per trial
  results           integer not null,             -- snapshot: trials
  spend_cents       integer not null,             -- snapshot: spend
  ctr               numeric,
  target_cents      integer,                      -- target it beat
  sport             text,                         -- primary reuse dimension
  concept_family_id uuid references public.concept_families (id),
  hook_angle        text,
  archetype         archetype_type,
  captured_at       timestamptz not null default now()
);
create index on public.content_cache (client_org, score desc);
create index on public.content_cache (sport);

alter table public.content_cache enable row level security;

-- Staff manage/read everything; a client reads only its own org's winners.
create policy cc_staff_all on public.content_cache for all
  using (public.is_staff()) with check (public.is_staff());
create policy cc_client_read on public.content_cache for select
  using (client_org = public.current_org());
