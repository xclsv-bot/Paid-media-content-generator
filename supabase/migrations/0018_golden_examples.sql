-- ============================================================================
-- 0018_golden_examples.sql — the Golden Set: proven winning creative, with the
-- script snapshot, as reusable examples for Ideate / the reviewer / creators.
-- ============================================================================
-- Where content_cache answers "WHO is winning" (performance snapshot), a
-- golden_example carries WHAT won: the full script at capture time, the
-- creative's dimensions, and a why-it-won rationale. Rows are auto-populated
-- by /api/winners/refresh and curated by staff (pin / remove).
--
-- Trust rules this schema enforces:
--   * Completeness — a consumable row can never lack the script, the
--     why-it-won, the dimensions keys, or the auto/curated flag (NOT NULL +
--     CHECK constraints, enforced at insert time for every write path).
--   * Curation survives refresh — apply_golden_refresh() only ever writes
--     rows with status='active'. 'pinned' rows are never updated or pruned;
--     'removed' rows are tombstones the refresh can neither update nor
--     delete, so auto-populate can never resurrect a curator's removal.
--
-- State machine:
--   status='active'  — auto-managed: refresh re-snapshots it and prunes it
--                      the run it stops qualifying (source is always 'auto').
--   status='pinned'  — curator keeps it regardless of performance drift
--                      (source flips to 'curated'; why_it_won editable).
--   status='removed' — curator tombstone; excluded from consumers and
--                      immune to auto-populate. Only a curator restore
--                      (back to 'active') lets the refresh manage it again.
-- ============================================================================

create table public.golden_examples (
  creative_id    uuid primary key references public.creatives (id) on delete cascade,
  client_org     org_type not null,
  script         text not null,
  script_version integer,
  why_it_won     text not null,
  -- dimension snapshot at capture time; keys are mandatory, values may be
  -- null when the creative genuinely lacks that metadata.
  dimensions     jsonb not null,
  source         text not null check (source in ('auto', 'curated')),
  status         text not null default 'active' check (status in ('active', 'pinned', 'removed')),
  -- performance snapshot that justified the row
  score          numeric not null,
  cpt_cents      integer not null,
  results        integer not null,
  target_cents   integer not null,
  captured_at    timestamptz not null default now(),
  curated_by     uuid references public.users (id),
  curated_at     timestamptz,
  constraint ge_script_nonempty check (length(btrim(script)) > 0),
  constraint ge_why_nonempty check (length(btrim(why_it_won)) > 0),
  constraint ge_dimensions_keys check (
    dimensions ?& array['family', 'hook_line', 'hook_angle', 'archetype', 'sport', 'format']
  )
);
create index on public.golden_examples (client_org, score desc);
create index on public.golden_examples (status);

alter table public.golden_examples enable row level security;

-- Staff manage everything; creators may read non-removed examples (they show
-- what "good" looks like). No client policy: rows carry internal scripts.
create policy ge_staff_all on public.golden_examples for all
  using (public.is_staff()) with check (public.is_staff());
create policy ge_creator_read on public.golden_examples for select
  using (public.is_creator() and status <> 'removed');

-- ----------------------------------------------------------------------------
-- apply_golden_refresh(candidates) — the ONLY auto-populate write path.
-- `candidates` is a jsonb array of fully-formed rows (the route derives
-- why_it_won and the dimension snapshot before calling). Runs as one
-- statement-level transaction:
--   1. upsert candidates as source='auto'; the ON CONFLICT update is gated on
--      status='active', so pinned/removed rows are silently left alone;
--   2. prune status='active' rows that stopped qualifying. Pinned and removed
--      rows are never pruned.
-- Table constraints re-check every candidate, so a malformed candidate aborts
-- the whole refresh rather than half-writing.
-- ----------------------------------------------------------------------------
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
      (c ->> 'client_org')::org_type    as client_org,
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
    (creative_id, client_org, script, script_version, why_it_won, dimensions,
     source, status, score, cpt_cents, results, target_cents, captured_at)
  select
    creative_id, client_org, script, script_version, why_it_won, dimensions,
    'auto', 'active', score, cpt_cents, results, target_cents, now()
  from cand
  on conflict (creative_id) do update set
    client_org     = excluded.client_org,
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

-- Only the server (service role) may run the refresh; it is not a user action.
revoke all on function public.apply_golden_refresh(jsonb) from public, anon, authenticated;
grant execute on function public.apply_golden_refresh(jsonb) to service_role;
