-- ============================================================================
-- 0014_production_notes.sql — internal creator ↔ staff discussion on a concept.
-- ============================================================================
-- Separate from the client-facing `comments` (which clients can read). These
-- production notes are INTERNAL: staff and the assigned creator only. There is
-- deliberately NO client policy, so client_viewers never see them.
-- author_name/role are denormalized so the thread renders without needing to
-- read other users' rows (which users-table RLS would block for a creator).
-- ============================================================================

create table public.production_notes (
  id          uuid primary key default gen_random_uuid(),
  concept_id  uuid not null references public.creatives (id) on delete cascade,
  author_id   uuid references public.users (id),
  author_name text,
  author_role text,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on public.production_notes (concept_id);

alter table public.production_notes enable row level security;

-- Staff manage all. A creator reads/writes only on concepts assigned to them.
create policy pn_staff_all on public.production_notes for all
  using (public.is_staff()) with check (public.is_staff());
create policy pn_creator_read on public.production_notes for select
  using (public.is_creator() and public.creator_has_concept(concept_id));
create policy pn_creator_insert on public.production_notes for insert
  with check (public.is_creator() and author_id = auth.uid() and public.creator_has_concept(concept_id));
