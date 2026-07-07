-- ============================================================================
-- 0021_organizations.sql — replace the org_type enum with a real organizations
-- table + org_id FK, so a new client can be added without an ALTER TYPE ...
-- ADD VALUE migration. See docs/MEETING_INSIGHTS_2026-06-25.md backlog item 3.
--
-- The two seed orgs get FIXED ids (not gen_random_uuid()) so this migration,
-- ci/rls_tests.sql, and any manual ops SQL can reference them as stable
-- literals. Future orgs get a random id via the column default.
--
-- Ordering matters: every policy/function that references client_org/
-- current_org()/org_type must be dropped BEFORE the columns/type they
-- depend on are altered or dropped, then recreated afterward against org_id.
-- ============================================================================

create table public.organizations (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  display_name text not null,                   -- interpolated into LLM system prompts
  is_agency    boolean not null default false,   -- true ONLY for XCLSV — drives is_staff()
  voice_note   text,                             -- short client-voice/product descriptor for prompts
  created_at   timestamptz not null default now()
);

insert into public.organizations (id, slug, display_name, is_agency, voice_note) values
  ('99999999-9999-9999-9999-999999999991', 'xclsv',   'XCLSV Media', true,  null),
  ('99999999-9999-9999-9999-999999999992', 'outlier', 'Outlier',     false, 'the Outlier sportsbook research app');
-- RLS for this table is set up further below, after users.org_id and
-- current_org() exist — see "organizations RLS" near the end of this file.

-- ============================================================================
-- Drop every policy/function that references current_org()/org_type/client_org
-- BEFORE touching any column or type — Postgres will not let you alter/drop a
-- column while a policy's USING/WITH CHECK clause references it, and
-- current_org()'s return type is changing (org_type -> uuid), which requires
-- drop+recreate. is_staff()'s signature is unchanged (still `() returns
-- boolean`), so it's handled via CREATE OR REPLACE further down without
-- needing a drop — policies that only reference is_staff() are left alone.
-- ============================================================================
drop policy users_self_read        on public.users;
drop policy users_staff_write      on public.users;
drop policy cf_write               on public.concept_families;
drop policy creatives_staff_all    on public.creatives;
drop policy creatives_client_read  on public.creatives;
drop policy financials_staff_all   on public.creative_financials;
drop policy va_read                on public.video_assets;
drop policy va_write               on public.video_assets;
drop policy comments_read          on public.comments;
drop policy comments_insert        on public.comments;
drop policy comments_delete        on public.comments;
drop policy approvals_read         on public.approvals;
drop policy approvals_write        on public.approvals;
drop policy ha_write               on public.hook_angles;
drop policy cycles_staff_all       on public.cycles;
drop policy cycles_client_read     on public.cycles;
drop policy deliverables_staff_all on public.deliverables;
drop policy deliverables_client_read on public.deliverables;
drop policy scripts_staff_all      on public.scripts;
drop policy refs_staff_all         on public.concept_references;
drop policy sr_staff_all           on public.script_reviews;
drop policy learnings_staff_all    on public.learnings;
drop policy learnings_creator_read on public.learnings;
drop policy cm_staff_all           on public.creative_metrics;
drop policy cm_read                on public.creative_metrics;
drop policy os_staff_all           on public.organic_signals;
drop policy cc_staff_all           on public.content_cache;
drop policy cc_client_read         on public.content_cache;

drop function public.can_see_creative(uuid);
drop function public.current_org();

-- ---------- users.org -> users.org_id ----------
alter table public.users add column org_id uuid references public.organizations (id);
update public.users u set org_id = o.id from public.organizations o where o.slug = lower(u.org::text);
alter table public.users alter column org_id set not null;
-- Deliberately NO default — handle_new_user() below is rewritten to REQUIRE
-- org_id in metadata: a user created without it must fail, not silently land
-- on one org.
alter table public.users drop column org;

-- ---------- creatives.client_org -> creatives.org_id ----------
alter table public.creatives add column org_id uuid references public.organizations (id);
update public.creatives c set org_id = o.id from public.organizations o where o.slug = lower(c.client_org::text);
alter table public.creatives alter column org_id set not null;
alter table public.creatives drop constraint creatives_sheet_id_client_org_key;
drop index if exists creatives_client_org_idx;
alter table public.creatives drop column client_org;
alter table public.creatives add constraint creatives_sheet_id_org_id_key unique (sheet_id, org_id);
create index on public.creatives (org_id);
-- No default on org_id — the DB-level backstop that makes the "silent
-- client_org default" bug class impossible: an insert omitting org_id now
-- fails NOT NULL instead of silently picking one org.

-- ---------- cycles.client_org -> cycles.org_id ----------
alter table public.cycles add column org_id uuid references public.organizations (id);
update public.cycles c set org_id = o.id from public.organizations o where o.slug = lower(c.client_org::text);
alter table public.cycles alter column org_id set not null;
drop index if exists cycles_one_active;         -- partial unique index on client_org (0012_single_active_cycle.sql)
drop index if exists cycles_client_org_idx;
alter table public.cycles drop column client_org;
create index on public.cycles (org_id);
create unique index cycles_one_active on public.cycles (org_id) where status = 'Active';

-- ---------- content_cache.client_org -> content_cache.org_id (Winners Cache) ----------
alter table public.content_cache add column org_id uuid references public.organizations (id);
update public.content_cache c set org_id = o.id from public.organizations o where o.slug = lower(c.client_org::text);
alter table public.content_cache alter column org_id set not null;
drop index if exists content_cache_client_org_score_idx;
alter table public.content_cache drop column client_org;
create index on public.content_cache (org_id, score desc);

-- ---------- learnings gains org_id (was fully org-agnostic — the actual
-- contamination surface: raw CPT figures + quoted script bodies with no
-- client boundary at all) ----------
alter table public.learnings add column org_id uuid references public.organizations (id);
update public.learnings set org_id = '99999999-9999-9999-9999-999999999992'; -- outlier — all existing rows
alter table public.learnings alter column org_id set not null;
create index on public.learnings (org_id, created_at desc);

-- ---------- golden_examples.client_org -> org_id (Golden Set, 0018) ----------
-- Policies (staff/creator-only) and CHECK constraints don't reference the
-- column, so only the column itself moves; dropping it auto-drops its index.
alter table public.golden_examples add column org_id uuid references public.organizations (id);
update public.golden_examples g set org_id = o.id from public.organizations o where o.slug = lower(g.client_org::text);
alter table public.golden_examples alter column org_id set not null;
alter table public.golden_examples drop column client_org;
create index on public.golden_examples (org_id, score desc);

-- ---------- bad_examples.client_org -> org_id (Bad-Example store, 0019) ----------
alter table public.bad_examples add column org_id uuid references public.organizations (id);
update public.bad_examples b set org_id = o.id from public.organizations o where o.slug = lower(b.client_org::text);
alter table public.bad_examples alter column org_id set not null;
alter table public.bad_examples drop column client_org;
create index on public.bad_examples (org_id, kind);

-- Last of the org_type-dependent drops — nothing references the type anymore.
drop type public.org_type;

-- ---------- recreate the example-store refresh functions, org_id-typed ----------
-- Their bodies cast candidate JSON through the org_type enum; a body isn't
-- validated at DROP TYPE time, so without this they'd apply cleanly and then
-- fail at the next refresh run. Same signatures => existing grants survive.
create or replace function public.apply_golden_refresh(candidates jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n_upserted int;
  n_pruned   int;
begin
  with cand as (
    select
      (c ->> 'creative_id')::uuid       as creative_id,
      (c ->> 'org_id')::uuid            as org_id,
      c ->> 'script'                    as script,
      (c ->> 'script_version')::int     as script_version,
      c ->> 'why_it_won'                as why_it_won,
      c -> 'dimensions'                 as dimensions,
      (c ->> 'score')::numeric          as score,
      (c ->> 'cpt_cents')::int          as cpt_cents,
      (c ->> 'results')::int            as results,
      (c ->> 'target_cents')::int       as target_cents
    from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
  )
  insert into golden_examples
    (creative_id, org_id, script, script_version, why_it_won, dimensions,
     source, status, score, cpt_cents, results, target_cents, captured_at)
  select
    creative_id, org_id, script, script_version, why_it_won, dimensions,
    'auto', 'active', score, cpt_cents, results, target_cents, now()
  from cand
  on conflict (creative_id) do update set
    org_id         = excluded.org_id,
    script         = excluded.script,
    script_version = excluded.script_version,
    why_it_won     = excluded.why_it_won,
    dimensions     = excluded.dimensions,
    source         = 'auto',
    score          = excluded.score,
    cpt_cents      = excluded.cpt_cents,
    results        = excluded.results,
    target_cents   = excluded.target_cents,
    captured_at    = now()
  where golden_examples.status = 'active';
  get diagnostics n_upserted = row_count;

  delete from golden_examples g
  where g.status = 'active'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
      where (c ->> 'creative_id')::uuid = g.creative_id
    );
  get diagnostics n_pruned = row_count;

  return jsonb_build_object('upserted', n_upserted, 'pruned', n_pruned);
end;
$$;

create or replace function public.apply_bad_refresh(
  candidates     jsonb,
  min_results    int,
  cpt_multiplier numeric,
  mature_days    int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  offender  jsonb;
  n_upserted int;
  n_pruned   int;
begin
  if min_results is null or min_results < 1
     or cpt_multiplier is null or cpt_multiplier < 1
     or mature_days is null or mature_days < 0 then
    raise exception 'apply_bad_refresh: invalid thresholds (min_results=%, cpt_multiplier=%, mature_days=%)',
      min_results, cpt_multiplier, mature_days;
  end if;

  select c into offender
  from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
  where (c ->> 'first_spend_date') is null
     or (c ->> 'first_spend_date')::date > current_date - mature_days
     or coalesce((c ->> 'results')::int, 0) < min_results
     or coalesce((c ->> 'cpt_cents')::numeric, 0)
        < (c ->> 'target_cents')::numeric * cpt_multiplier
  limit 1;
  if offender is not null then
    raise exception 'apply_bad_refresh: candidate % fails a loser gate (need first spend <= %, results >= %, cpt >= % x target); got first_spend=%, results=%, cpt_cents=%, target_cents=%',
      offender ->> 'creative_id', current_date - mature_days, min_results, cpt_multiplier,
      offender ->> 'first_spend_date', offender ->> 'results',
      offender ->> 'cpt_cents', offender ->> 'target_cents';
  end if;

  with cand as (
    select
      (c ->> 'creative_id')::uuid        as creative_id,
      (c ->> 'org_id')::uuid             as org_id,
      c ->> 'script'                     as script,
      (c ->> 'script_version')::int      as script_version,
      c ->> 'reason'                     as reason,
      c -> 'dimensions'                  as dimensions,
      (c ->> 'cpt_cents')::int           as cpt_cents,
      (c ->> 'target_cents')::int        as target_cents,
      (c ->> 'results')::int             as results,
      (c ->> 'spend_cents')::int         as spend_cents,
      (c ->> 'first_spend_date')::date   as first_spend_date
    from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
  )
  insert into bad_examples
    (kind, creative_id, org_id, script, script_version, reason, dimensions,
     cpt_cents, target_cents, results, spend_cents, first_spend_date, gates, captured_at)
  select
    'proven_loser', creative_id, org_id, script, script_version, reason, dimensions,
    cpt_cents, target_cents, results, spend_cents, first_spend_date,
    jsonb_build_object('min_results', min_results, 'cpt_multiplier', cpt_multiplier, 'mature_days', mature_days),
    now()
  from cand
  on conflict (creative_id) where kind = 'proven_loser' do update set
    org_id           = excluded.org_id,
    script           = excluded.script,
    script_version   = excluded.script_version,
    reason           = excluded.reason,
    dimensions       = excluded.dimensions,
    cpt_cents        = excluded.cpt_cents,
    target_cents     = excluded.target_cents,
    results          = excluded.results,
    spend_cents      = excluded.spend_cents,
    first_spend_date = excluded.first_spend_date,
    gates            = excluded.gates,
    captured_at      = now();
  get diagnostics n_upserted = row_count;

  delete from bad_examples b
  where b.kind = 'proven_loser'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
      where (c ->> 'creative_id')::uuid = b.creative_id
    );
  get diagnostics n_pruned = row_count;

  return jsonb_build_object('upserted', n_upserted, 'pruned', n_pruned);
end;
$$;

-- ---------- repoint creative_performance view to expose org_id (additive) ----------
create or replace view public.creative_performance
with (security_invoker = on) as
select
  c.id                                       as creative_id,
  coalesce(sum(m.spend), 0)                  as spend,
  null::bigint                               as impressions,
  null::bigint                               as clicks,
  coalesce(sum(m.conversions), 0)::bigint    as results,
  avg(m.ctr)                                 as ctr,
  case when coalesce(sum(m.conversions), 0) > 0
       then sum(m.spend)::numeric / sum(m.conversions)
       else null end                         as cpt,
  max(m.created_at)                          as last_updated,
  min(m.flight_start)                        as first_date,
  max(m.flight_start)                        as last_date,
  c.org_id                                   as org_id
from public.creatives c
left join public.creative_metrics m on m.ad_name = c.ad_name
group by c.id, c.org_id;

-- ---------- recreate the two dropped helpers, uuid-typed ----------
create or replace function public.current_org()
  returns uuid language sql stable security definer set search_path = public as
$$ select org_id from public.users where id = auth.uid() $$;

create or replace function public.is_staff()
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.users u join public.organizations o on o.id = u.org_id
     where u.id = auth.uid() and o.is_agency and u.role in ('admin','editor')
   ) $$;

create or replace function public.can_see_creative(c_id uuid)
  returns boolean language sql stable security definer set search_path = public as
$$ select exists (
     select 1 from public.creatives c
     where c.id = c_id and (public.is_staff() or c.org_id = public.current_org())
   ) $$;

-- current_org()/can_see_creative() were DROP+CREATE, resetting their grants —
-- redo the 0004/0007 hardening or anon regains RPC access. is_staff() was
-- CREATE OR REPLACE (same signature) — its existing grants survive untouched.
revoke execute on function public.current_org()         from public, anon;
revoke execute on function public.can_see_creative(uuid) from public, anon;
grant  execute on function public.current_org()          to authenticated;
grant  execute on function public.can_see_creative(uuid)  to authenticated;

-- ---------- recreate every dropped policy, org_id-based ----------
create policy users_self_read   on public.users for select using (id = auth.uid() or public.is_staff());
create policy users_staff_write on public.users for all
  using (public.is_staff()) with check (public.is_staff());

create policy cf_write on public.concept_families for all
  using (public.is_staff()) with check (public.is_staff());

create policy creatives_staff_all on public.creatives for all
  using (public.is_staff()) with check (public.is_staff());
create policy creatives_client_read on public.creatives for select
  using (org_id = public.current_org());

create policy financials_staff_all on public.creative_financials for all
  using (public.is_staff()) with check (public.is_staff());

create policy va_read  on public.video_assets for select using (public.can_see_creative(creative_id));
create policy va_write on public.video_assets for all
  using (public.is_staff()) with check (public.is_staff());

create policy comments_read   on public.comments for select using (public.can_see_creative(creative_id));
create policy comments_insert on public.comments for insert with check (author_id = auth.uid() and public.can_see_creative(creative_id));
create policy comments_delete on public.comments for delete using (author_id = auth.uid() or public.is_staff());

create policy approvals_read  on public.approvals for select using (public.can_see_creative(creative_id));
create policy approvals_write on public.approvals for all
  using (public.can_see_creative(creative_id)) with check (public.can_see_creative(creative_id));

create policy ha_write on public.hook_angles for all using (public.is_staff()) with check (public.is_staff());

create policy cycles_staff_all on public.cycles for all using (public.is_staff()) with check (public.is_staff());
create policy cycles_client_read on public.cycles for select using (org_id = public.current_org());

create policy deliverables_staff_all on public.deliverables for all using (public.is_staff()) with check (public.is_staff());
create policy deliverables_client_read on public.deliverables for select using (
  production_status = 'Delivered' and exists (
    select 1 from public.creatives c
    where c.id = deliverables.concept_id and c.org_id = public.current_org()
  )
);

create policy scripts_staff_all on public.scripts for all using (public.is_staff()) with check (public.is_staff());
create policy refs_staff_all    on public.concept_references for all using (public.is_staff()) with check (public.is_staff());
create policy sr_staff_all      on public.script_reviews for all using (public.is_staff()) with check (public.is_staff());

-- TIGHTENED vs. the original (`using (is_creator())` — zero org gate; every
-- creator saw every org's learnings, harmless only because there was one org).
create policy learnings_staff_all on public.learnings for all
  using (public.is_staff()) with check (public.is_staff());
create policy learnings_creator_read on public.learnings for select
  using (public.is_creator() and org_id = public.current_org());

create policy cm_staff_all on public.creative_metrics for all
  using (public.is_staff()) with check (public.is_staff());
create policy cm_read on public.creative_metrics for select using (
  exists (
    select 1 from public.creatives c
    where c.ad_name = creative_metrics.ad_name
      and (c.org_id = public.current_org() or (public.is_creator() and public.creator_has_concept(c.id)))
  )
);

create policy os_staff_all on public.organic_signals for all
  using (public.is_staff()) with check (public.is_staff());

create policy cc_staff_all on public.content_cache for all
  using (public.is_staff()) with check (public.is_staff());
create policy cc_client_read on public.content_cache for select
  using (org_id = public.current_org());

-- ---------- organizations RLS ----------
-- Every other table in this schema is RLS-gated; this one holds every
-- client's display name, so a client_viewer/creator must not be able to
-- enumerate other clients XCLSV serves. Staff see all (for the org
-- selectors on concept/cycle creation, Ideate, and pattern promotion); a
-- non-staff user only ever sees their own org's row.
alter table public.organizations enable row level security;
create policy orgs_staff_all on public.organizations for all
  using (public.is_staff()) with check (public.is_staff());
create policy orgs_self_read on public.organizations for select
  using (id = public.current_org());

-- ---------- handle_new_user(): require org_id, no silent default ----------
-- Was: coalesce((raw_user_meta_data->>'org')::org_type, 'Outlier') — a
-- mis-provisioned user (no org set) silently became an Outlier user. Now that
-- a wrong default is a real cross-client-visibility risk, fail loudly instead:
-- the insert (and so the whole auth.users row creation) rolls back if org_id
-- is missing.
create or replace function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if new.raw_user_meta_data->>'org_id' is null then
    raise exception
      'org_id is required in auth user metadata — set raw_user_meta_data.org_id to a public.organizations.id before creating this user (select id, slug, display_name from public.organizations to find it)';
  end if;
  insert into public.users (id, email, name, role, org_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'client_viewer'),
    (new.raw_user_meta_data->>'org_id')::uuid
  );
  return new;
end;
$$;
