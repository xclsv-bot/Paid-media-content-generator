-- ============================================================================
-- 0001_init.sql — Creative Dashboard core schema + RLS
-- ============================================================================
-- Security model (PRD §9):
--   * Org-scoping enforced at the DB via RLS, in one place — not per-query.
--   * Internal financials live in a SEPARATE table (creative_financials) gated
--     to XCLSV staff, so a client role can never select the column at all.
--   * Roles: admin/editor are XCLSV staff; client_viewer is the Outlier team.
-- ============================================================================

-- ---------- enums ----------
create type org_type        as enum ('XCLSV', 'Outlier');
create type user_role       as enum ('admin', 'editor', 'client_viewer');
create type archetype_type  as enum ('Qualifier', 'Broad-appeal', 'Mixed');
create type creative_status as enum ('Planned', 'In production', 'Delivered', 'Live', 'Paused');
create type approval_state  as enum ('Pending', 'Approved', 'Changes requested');

-- ---------- users (mirror of auth.users with role + org) ----------
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text,
  email      text not null,
  role       user_role not null default 'client_viewer',
  org        org_type  not null default 'Outlier',
  created_at timestamptz not null default now()
);

-- Helper functions. SECURITY DEFINER so they read public.users WITHOUT tripping
-- that table's own RLS (which would otherwise recurse). search_path pinned for safety.
create or replace function public.current_role()
  returns user_role language sql stable security definer set search_path = public as
$$ select role from public.users where id = auth.uid() $$;

create or replace function public.current_org()
  returns org_type language sql stable security definer set search_path = public as
$$ select org from public.users where id = auth.uid() $$;

create or replace function public.is_staff()
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.users
     where id = auth.uid() and org = 'XCLSV' and role in ('admin','editor')
   ) $$;

-- ---------- concept families (the second sheet tab — a real entity) ----------
create table public.concept_families (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,                 -- Parlay, Don't Use, ...
  archetype       archetype_type,
  narrative       text,
  audience        text,
  strategic_intent text,
  proven_hook_formula text,
  is_proven       boolean not null default false,
  compliance_note text,                                 -- e.g. PrizePicks naming, EV gating
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- creatives (the slate; NO tier, NO cost here) ----------
create table public.creatives (
  id                     uuid primary key default gen_random_uuid(),
  sheet_id               text,                          -- original '01'..'40' for traceability
  client_org             org_type not null default 'Outlier',  -- who this slate is for
  concept_family_id      uuid references public.concept_families (id),
  content_summary        text,
  hook_line              text,
  hook_angle             text,                          -- controlled vocab normalization is a follow-up
  archetype              archetype_type,
  feature_pillar         text,
  sport                  text,
  format                 text,
  variant_differentiator text,
  is_proven              boolean not null default false,
  cta                    text,
  status                 creative_status not null default 'Planned',
  delivery_date          date,
  compliance_note        text,
  ad_name                text,                          -- structured Meta join key (PRD §6.3)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (sheet_id, client_org)                          -- idempotent re-seeding
);
create index on public.creatives (client_org);
create index on public.creatives (concept_family_id);

-- ---------- internal financials (XCLSV-only; physically separate) ----------
create table public.creative_financials (
  creative_id        uuid primary key references public.creatives (id) on delete cascade,
  internal_cost_cents integer,
  margin_note        text,
  updated_at         timestamptz not null default now()
);

-- ---------- video assets ----------
create table public.video_assets (
  id            uuid primary key default gen_random_uuid(),
  creative_id   uuid not null references public.creatives (id) on delete cascade,
  storage_path  text not null,                          -- key within the bucket
  file_name     text not null,                          -- original filename for download
  version_label text not null default 'v1',
  size_bytes    bigint,
  duration_s    numeric,
  content_type  text default 'video/mp4',
  source_url    text,                                   -- e.g. original Google Drive link, if migrated
  uploaded_by   uuid references public.users (id),
  uploaded_at   timestamptz not null default now()
);
create index on public.video_assets (creative_id);

-- ---------- Meta integration tables ----------
create table public.meta_ads (
  id            uuid primary key default gen_random_uuid(),
  creative_id   uuid not null references public.creatives (id) on delete cascade,
  meta_ad_id    text,                                   -- exact join once live (preferred)
  ad_name       text,                                   -- fallback join key
  ad_account_id text,
  created_at    timestamptz not null default now()
);
create index on public.meta_ads (creative_id);
create index on public.meta_ads (meta_ad_id);

create table public.meta_insights_daily (
  id              uuid primary key default gen_random_uuid(),
  meta_ad_id      text not null,
  date            date not null,
  spend           numeric,
  impressions     bigint,
  clicks          bigint,
  ctr             numeric,
  results         integer,                              -- trials
  cost_per_result numeric,                              -- CPT as reported by Meta (matches their window)
  attribution_window text,
  fetched_at      timestamptz not null default now(),
  unique (meta_ad_id, date)
);

-- ---------- comments & approvals ----------
create table public.comments (
  id          uuid primary key default gen_random_uuid(),
  creative_id uuid not null references public.creatives (id) on delete cascade,
  author_id   uuid not null references public.users (id),
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on public.comments (creative_id);

create table public.approvals (
  creative_id uuid primary key references public.creatives (id) on delete cascade,
  state       approval_state not null default 'Pending',
  actor_id    uuid references public.users (id),
  updated_at  timestamptz not null default now()
);

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.users               enable row level security;
alter table public.concept_families    enable row level security;
alter table public.creatives           enable row level security;
alter table public.creative_financials enable row level security;
alter table public.video_assets        enable row level security;
alter table public.meta_ads            enable row level security;
alter table public.meta_insights_daily enable row level security;
alter table public.comments            enable row level security;
alter table public.approvals           enable row level security;

-- users: read own row; staff read all; only staff manage roles.
create policy users_self_read   on public.users for select using (id = auth.uid() or public.is_staff());
create policy users_staff_write on public.users for all
  using (public.is_staff()) with check (public.is_staff());

-- concept_families: any authenticated user reads; staff write.
create policy cf_read  on public.concept_families for select using (auth.uid() is not null);
create policy cf_write on public.concept_families for all
  using (public.is_staff()) with check (public.is_staff());

-- creatives: staff full access; client reads only its own org's slate.
create policy creatives_staff_all on public.creatives for all
  using (public.is_staff()) with check (public.is_staff());
create policy creatives_client_read on public.creatives for select
  using (client_org = public.current_org());

-- creative_financials: XCLSV staff ONLY. No client policy exists => clients get zero rows.
create policy financials_staff_all on public.creative_financials for all
  using (public.is_staff()) with check (public.is_staff());

-- helper: can the current user see this creative at all?
create or replace function public.can_see_creative(c_id uuid)
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.creatives c
     where c.id = c_id and (public.is_staff() or c.client_org = public.current_org())
   ) $$;

-- video_assets: visible if you can see the creative; only staff write.
create policy va_read  on public.video_assets for select using (public.can_see_creative(creative_id));
create policy va_write on public.video_assets for all
  using (public.is_staff()) with check (public.is_staff());

-- meta tables: visible if you can see the creative; staff write.
create policy ma_read  on public.meta_ads for select using (public.can_see_creative(creative_id));
create policy ma_write on public.meta_ads for all
  using (public.is_staff()) with check (public.is_staff());
create policy mid_read on public.meta_insights_daily for select using (
  public.is_staff() or exists (
    select 1 from public.meta_ads a
    where a.meta_ad_id = meta_insights_daily.meta_ad_id and public.can_see_creative(a.creative_id)
  )
);
create policy mid_write on public.meta_insights_daily for all
  using (public.is_staff()) with check (public.is_staff());

-- comments: read if you can see the creative; author writes own.
create policy comments_read   on public.comments for select using (public.can_see_creative(creative_id));
create policy comments_insert on public.comments for insert with check (author_id = auth.uid() and public.can_see_creative(creative_id));
create policy comments_modify on public.comments for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete using (author_id = auth.uid() or public.is_staff());

-- approvals: read if you can see the creative; client sets state on its own slate; staff too.
create policy approvals_read  on public.approvals for select using (public.can_see_creative(creative_id));
create policy approvals_write on public.approvals for all
  using (public.can_see_creative(creative_id)) with check (public.can_see_creative(creative_id));

-- ---------- new-user trigger: copy auth metadata into public.users ----------
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as
$$
begin
  insert into public.users (id, email, name, role, org)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'client_viewer'),
    coalesce((new.raw_user_meta_data->>'org')::org_type, 'Outlier')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
