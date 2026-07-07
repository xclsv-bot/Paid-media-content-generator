-- ============================================================================
-- 0014_ideation_references.sql — reference clips for Ideate.
-- ============================================================================
-- A staff-only library of reference videos dropped into the Ideate workspace.
-- Each is transcribed (Whisper) so the agent can ideate off what was actually
-- said in the reference. Files live in the existing private 'references' bucket.
-- ============================================================================

create table public.ideation_references (
  id                uuid primary key default gen_random_uuid(),
  title             text,
  file_name         text not null,
  storage_path      text not null,
  transcript        text,
  transcript_status text,          -- 'pending' | 'done' | 'failed'
  created_by        uuid references public.users (id),
  created_at        timestamptz not null default now()
);
create index on public.ideation_references (created_at desc);

alter table public.ideation_references enable row level security;

-- Ideation is staff-only.
create policy iref_staff_all on public.ideation_references for all
  using (public.is_staff()) with check (public.is_staff());
