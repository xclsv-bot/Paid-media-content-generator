-- ============================================================================
-- 0010_learnings.sql — persisted "what's winning" narrative (Phase 3b).
-- An analyst agent reads the deterministic scoreboard + winning/losing scripts
-- and writes a structured learning snapshot. The latest one feeds the reviewer
-- rubric and Ideate so generation reflects what's actually working.
-- ============================================================================

create table public.learnings (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null default 'global',
  narrative   text not null,
  do_more     jsonb,   -- string[]
  do_less     jsonb,   -- string[]
  watchouts   jsonb,   -- string[]
  attribution jsonb,   -- the scoreboard summary the agent reasoned from
  model       text,
  created_by  uuid references public.users (id),
  created_at  timestamptz not null default now()
);
create index on public.learnings (created_at desc);

alter table public.learnings enable row level security;

-- Staff manage; creators may read the current learnings (helps them produce).
create policy learnings_staff_all on public.learnings for all
  using (public.is_staff()) with check (public.is_staff());
create policy learnings_creator_read on public.learnings for select
  using (public.is_creator());
