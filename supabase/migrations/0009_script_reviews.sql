-- ============================================================================
-- 0009_script_reviews.sql — the checker half of the inner script-quality loop.
-- A reviewer agent scores a script version against the rubric; each review is
-- persisted so we keep the maker/checker history and can attribute later.
-- ============================================================================

create table public.script_reviews (
  id               uuid primary key default gen_random_uuid(),
  script_id        uuid not null references public.scripts (id) on delete cascade,
  concept_id       uuid not null references public.creatives (id) on delete cascade,
  scores           jsonb not null,          -- { hook, angle_fit, compliance, structure, clarity }
  overall          integer not null,        -- 1..10
  verdict          text not null,           -- 'pass' | 'revise'
  weaknesses       jsonb,                   -- string[]
  suggestions      jsonb,                   -- string[]
  compliance_flags jsonb,                   -- string[]
  model            text,
  created_at       timestamptz not null default now()
);
create index on public.script_reviews (script_id);
create index on public.script_reviews (concept_id);

alter table public.script_reviews enable row level security;

-- Staff manage reviews; a creator can read reviews for concepts they're assigned.
create policy sr_staff_all on public.script_reviews for all
  using (public.is_staff()) with check (public.is_staff());
create policy sr_creator_read on public.script_reviews for select
  using (public.is_creator() and public.creator_has_concept(concept_id));
