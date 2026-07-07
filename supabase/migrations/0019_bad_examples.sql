-- ============================================================================
-- 0019_bad_examples.sql — the Bad-Example store: what NOT to make again.
-- ============================================================================
-- Two kinds of negative example, one table:
--   * kind='proven_loser'     — a creative whose real CPT verdict is bad enough
--                               to trust: it must be MATURE (past the
--                               measurement window), VOLUME-GATED (enough
--                               trials that the CPT isn't small-sample luck),
--                               and its CPT must be over target by the
--                               configured multiplier. All three gates are
--                               re-checked inside apply_bad_refresh(); a
--                               candidate failing any gate ABORTS the refresh
--                               (a leak is an upstream bug, not data).
--   * kind='review_rejection' — a script the reviewer failed on compliance,
--                               a free pre-spend negative. It MUST carry the
--                               compliance reason: reason is NOT NULL and
--                               non-empty for every row, so a reasonless
--                               rejection cannot be persisted.
--
-- Threshold VALUES (maturity window, volume floor, over-target multiplier)
-- are product calls — they live in config (src/lib/loop/bad.ts env-backed
-- getters) and are passed INTO apply_bad_refresh, never hardcoded here. Each
-- proven-loser row snapshots the gates it was judged by in `gates` for audit.
-- ============================================================================

create table public.bad_examples (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('proven_loser', 'review_rejection')),
  creative_id      uuid not null references public.creatives (id) on delete cascade,
  client_org       org_type not null,
  script           text not null,
  script_version   integer,
  reason           text not null,   -- why it lost / the compliance reason
  dimensions       jsonb not null,
  -- performance snapshot (proven_loser only)
  cpt_cents        integer,
  target_cents     integer,
  results          integer,
  spend_cents      integer,
  first_spend_date date,
  gates            jsonb,           -- thresholds in force at capture
  review_id        uuid references public.script_reviews (id) on delete cascade,
  captured_at      timestamptz not null default now(),
  constraint be_script_nonempty check (length(btrim(script)) > 0),
  constraint be_reason_nonempty check (length(btrim(reason)) > 0),
  constraint be_dimensions_keys check (
    dimensions ?& array['family', 'hook_line', 'hook_angle', 'archetype', 'sport', 'format']
  ),
  -- a proven loser always carries the full snapshot that convicted it, the
  -- gates it was judged by, and is structurally over target
  constraint be_loser_snapshot check (
    kind <> 'proven_loser' or (
      cpt_cents is not null and target_cents is not null and results is not null
      and spend_cents is not null and first_spend_date is not null and gates is not null
      and cpt_cents > target_cents
    )
  ),
  -- a review rejection always points at the review that produced its reason
  constraint be_rejection_review check (kind <> 'review_rejection' or review_id is not null)
);
create unique index be_one_loser_per_creative on public.bad_examples (creative_id)
  where kind = 'proven_loser';
create unique index be_one_rejection_per_review on public.bad_examples (review_id)
  where kind = 'review_rejection';
create index on public.bad_examples (kind, captured_at desc);

alter table public.bad_examples enable row level security;

-- Staff manage; creators may read (what to avoid is as useful as what to copy).
-- No client policy: rows embed internal scripts.
create policy be_staff_all on public.bad_examples for all
  using (public.is_staff()) with check (public.is_staff());
create policy be_creator_read on public.bad_examples for select
  using (public.is_creator());

-- ----------------------------------------------------------------------------
-- apply_bad_refresh(candidates, thresholds) — the ONLY proven-loser write path.
-- Thresholds come from app config; the function re-enforces all three gates on
-- every candidate and raises if any fails, so nothing under-gated can land no
-- matter what the caller computed. Then: upsert qualifying losers, prune
-- proven_loser rows that no longer qualify. review_rejection rows are
-- point-in-time records and are never touched by the refresh.
-- ----------------------------------------------------------------------------
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

  -- Gate enforcement: mature AND volume-gated AND CPT over target*multiplier.
  select c into offender
  from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
  where (c ->> 'first_spend_date') is null
     or (c ->> 'first_spend_date')::date > current_date - mature_days       -- immature
     or coalesce((c ->> 'results')::int, 0) < min_results                    -- under-volumed
     or coalesce((c ->> 'cpt_cents')::numeric, 0)
        < (c ->> 'target_cents')::numeric * cpt_multiplier                   -- not over target enough
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
      (c ->> 'client_org')::org_type     as client_org,
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
    (kind, creative_id, client_org, script, script_version, reason, dimensions,
     cpt_cents, target_cents, results, spend_cents, first_spend_date, gates, captured_at)
  select
    'proven_loser', creative_id, client_org, script, script_version, reason, dimensions,
    cpt_cents, target_cents, results, spend_cents, first_spend_date,
    jsonb_build_object('min_results', min_results, 'cpt_multiplier', cpt_multiplier, 'mature_days', mature_days),
    now()
  from cand
  on conflict (creative_id) where kind = 'proven_loser' do update set
    client_org       = excluded.client_org,
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

-- Only the server (service role) may run the refresh; it is not a user action.
revoke all on function public.apply_bad_refresh(jsonb, int, numeric, int) from public, anon, authenticated;
grant execute on function public.apply_bad_refresh(jsonb, int, numeric, int) to service_role;
