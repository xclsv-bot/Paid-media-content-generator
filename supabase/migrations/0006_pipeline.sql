-- ============================================================================
-- 0006_pipeline.sql — Cycles, Deliverables, Scripts, References, Idea status,
--                     hook normalization, and RLS (incl. creator scoping).
-- See docs/CREATIVE_PIPELINE.md.
-- ============================================================================

-- ---------- enums ----------
create type cycle_status       as enum ('Planning', 'Active', 'Closed');
create type production_status  as enum ('Assigned', 'In production', 'Submitted', 'In revision', 'Approved', 'Delivered');
create type idea_status        as enum ('Backlog', 'Testing', 'Winner', 'Parked');
create type script_source      as enum ('ai', 'human');
create type script_status      as enum ('draft', 'approved');

-- ---------- helper: is the current user a content creator? ----------
create or replace function public.is_creator()
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.users where id = auth.uid() and role = 'creator') $$;

-- helper: does the current user have a deliverable for this concept? (creator scope)
create or replace function public.creator_has_concept(c_id uuid)
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.deliverables d
     where d.concept_id = c_id and d.assignee_id = auth.uid()
   ) $$;
revoke execute on function public.is_creator()             from anon;
revoke execute on function public.creator_has_concept(uuid) from anon;

-- ---------- hook angle lookup (FK-backed filtering) ----------
create table public.hook_angles (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);
-- Seed from current distinct values so the filter works immediately.
insert into public.hook_angles (name)
  select distinct hook_angle from public.creatives
  where hook_angle is not null and btrim(hook_angle) <> ''
on conflict (name) do nothing;

-- ---------- concept (creatives) additions ----------
alter table public.creatives add column if not exists idea_status   idea_status not null default 'Backlog';
alter table public.creatives add column if not exists script_doc_url text;
alter table public.creatives add column if not exists hook_angle_id  uuid references public.hook_angles (id);
update public.creatives c
  set hook_angle_id = h.id
  from public.hook_angles h
  where c.hook_angle = h.name and c.hook_angle_id is null;
-- Proven concepts seed as winners; everything else stays Backlog.
update public.creatives set idea_status = 'Winner' where is_proven and idea_status = 'Backlog';

-- ---------- cycles (the weekly drop) ----------
create table public.cycles (
  id           uuid primary key default gen_random_uuid(),
  label        text not null,
  starts_on    date not null,
  ends_on      date not null,
  target_count integer not null default 15,
  status       cycle_status not null default 'Planning',
  client_org   org_type not null default 'Outlier',
  created_at   timestamptz not null default now()
);
create index on public.cycles (client_org);

-- ---------- deliverables (a concept scheduled into a cycle) ----------
create table public.deliverables (
  id                uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references public.cycles (id) on delete cascade,
  concept_id        uuid not null references public.creatives (id) on delete cascade,
  assignee_id       uuid references public.users (id),
  due_date          date,
  production_status production_status not null default 'Assigned',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (cycle_id, concept_id)
);
create index on public.deliverables (cycle_id);
create index on public.deliverables (concept_id);
create index on public.deliverables (assignee_id);

-- Uploaded videos attach to the week's deliverable (still resolve to a concept).
alter table public.video_assets
  add column if not exists deliverable_id uuid references public.deliverables (id) on delete set null;
create index on public.video_assets (deliverable_id);

-- ---------- scripts (AI-generated, versioned) ----------
create table public.scripts (
  id         uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.creatives (id) on delete cascade,
  body       text not null,
  source     script_source not null default 'ai',
  status     script_status not null default 'draft',
  version    integer not null default 1,
  model      text,
  context    jsonb,
  created_by uuid references public.users (id),
  created_at timestamptz not null default now(),
  unique (concept_id, version)
);
create index on public.scripts (concept_id);

-- ---------- references (manual uploads + links) ----------
create table public.concept_references (
  id           uuid primary key default gen_random_uuid(),
  concept_id   uuid not null references public.creatives (id) on delete cascade,
  kind         text not null default 'link',   -- 'file' | 'link'
  url          text not null,                   -- external url, or signed-path target
  storage_path text,                            -- set when kind = 'file'
  label        text,
  uploaded_by  uuid references public.users (id),
  created_at   timestamptz not null default now()
);
create index on public.concept_references (concept_id);

-- ---------- references storage bucket (private) ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('references', 'references', false, 524288000)   -- 500 MB
on conflict (id) do nothing;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.hook_angles        enable row level security;
alter table public.cycles             enable row level security;
alter table public.deliverables       enable row level security;
alter table public.scripts            enable row level security;
alter table public.concept_references enable row level security;

-- hook_angles: any authenticated user reads; staff write.
create policy ha_read  on public.hook_angles for select using (auth.uid() is not null);
create policy ha_write on public.hook_angles for all using (public.is_staff()) with check (public.is_staff());

-- cycles: staff full; client reads its own org; creator reads cycles they have work in.
create policy cycles_staff_all on public.cycles for all using (public.is_staff()) with check (public.is_staff());
create policy cycles_client_read on public.cycles for select using (client_org = public.current_org());
create policy cycles_creator_read on public.cycles for select using (
  public.is_creator() and exists (
    select 1 from public.deliverables d where d.cycle_id = cycles.id and d.assignee_id = auth.uid()
  )
);

-- deliverables: staff full; creator reads + updates own; client reads delivered ones in its org.
create policy deliverables_staff_all on public.deliverables for all using (public.is_staff()) with check (public.is_staff());
create policy deliverables_creator_read on public.deliverables for select
  using (public.is_creator() and assignee_id = auth.uid());
create policy deliverables_creator_update on public.deliverables for update
  using (public.is_creator() and assignee_id = auth.uid())
  with check (public.is_creator() and assignee_id = auth.uid());
create policy deliverables_client_read on public.deliverables for select using (
  production_status = 'Delivered' and exists (
    select 1 from public.creatives c
    where c.id = deliverables.concept_id and c.client_org = public.current_org()
  )
);

-- scripts: internal only. Staff full; creator reads scripts for concepts they're assigned.
create policy scripts_staff_all on public.scripts for all using (public.is_staff()) with check (public.is_staff());
create policy scripts_creator_read on public.scripts for select
  using (public.is_creator() and public.creator_has_concept(concept_id));

-- concept_references: internal production material. Staff full; creator reads for assigned concepts.
create policy refs_staff_all on public.concept_references for all using (public.is_staff()) with check (public.is_staff());
create policy refs_creator_read on public.concept_references for select
  using (public.is_creator() and public.creator_has_concept(concept_id));

-- Let creators read the concepts (and their videos) they're assigned to produce.
create policy creatives_creator_read on public.creatives for select
  using (public.is_creator() and public.creator_has_concept(id));
create policy va_creator_read on public.video_assets for select
  using (public.is_creator() and public.creator_has_concept(creative_id));
-- Creators upload videos for their assigned concepts.
create policy va_creator_write on public.video_assets for insert
  with check (public.is_creator() and public.creator_has_concept(creative_id));
