-- ============================================================================
-- 0028_ideation_conversations.sql — persist Ideate chats.
-- ============================================================================
-- The Ideate workspace lived only in page memory: navigate away and the whole
-- brainstorm (messages, draft concepts, attached sources) was gone. Store each
-- conversation per org so staff can pick a session back up.
-- ============================================================================

create table public.ideation_conversations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id),
  title       text,
  -- Message array as the UI holds it (role/text/concepts), and the attached
  -- sources — both replayed verbatim when a conversation is reopened.
  messages    jsonb not null default '[]'::jsonb,
  sources     jsonb not null default '[]'::jsonb,
  created_by  uuid references public.users (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on public.ideation_conversations (org_id, updated_at desc);

alter table public.ideation_conversations enable row level security;

-- Ideation is a staff workspace; clients and creators never see it.
create policy ic_staff_all on public.ideation_conversations for all
  using (public.is_staff()) with check (public.is_staff());
