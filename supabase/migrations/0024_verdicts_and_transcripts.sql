-- ============================================================================
-- 0024_verdicts_and_transcripts.sql — one verdict vocabulary, honored by the loop.
-- ============================================================================
-- Until now creative_metrics.verdict (GRADUATE|KEEP_TESTING|KILL) only ever
-- arrived with imported report rows — nothing computed it, and the loop's
-- example stores ignored it. This migration makes the verdict a first-class,
-- loop-connected signal:
--
--   * verdict_source records WHO decided: 'auto' (derived in app code from the
--     same gates the loop uses — src/lib/metrics/verdict.ts), 'user' (staff set
--     it in the UI), 'report' (came in with the paid team's sheet). An auto
--     recompute never overwrites a user/report verdict.
--   * A user/report KILL flows into the bad-example store as an honest new
--     kind, 'manual_kill' — distinct from 'proven_loser', whose triple gate
--     (mature + volume + CPT over target) a hand-killed ad may not clear.
--     apply_manual_kills() is its only write path (upsert + prune, so flipping
--     the verdict away removes the row on the next refresh).
--   * golden_examples.transcript snapshots what the winning cut actually SAID
--     (from video_assets via Whisper), so ideation can quote the winning
--     delivery, not just the written script.
-- ============================================================================

-- ---------- creative_metrics: verdict provenance + value check ----------
alter table public.creative_metrics
  add column verdict_source text not null default 'report'
    check (verdict_source in ('auto', 'user', 'report'));

-- Normalize any legacy casing before constraining the value set.
update public.creative_metrics set verdict = upper(btrim(verdict))
  where verdict is not null and verdict <> upper(btrim(verdict));
alter table public.creative_metrics
  add constraint cm_verdict_values
  check (verdict is null or verdict in ('GRADUATE', 'KEEP_TESTING', 'KILL'));

-- ---------- bad_examples: the manual-kill kind ----------
alter table public.bad_examples drop constraint bad_examples_kind_check;
alter table public.bad_examples
  add constraint bad_examples_kind_check
  check (kind in ('proven_loser', 'review_rejection', 'manual_kill'));

-- One manual kill per creative (mirrors be_one_loser_per_creative); the
-- partial index is also what apply_manual_kills' upsert conflicts on.
create unique index be_one_manual_kill_per_creative on public.bad_examples (creative_id)
  where kind = 'manual_kill';

-- ---------- golden_examples: the winning cut's transcript ----------
alter table public.golden_examples add column transcript text;

-- ----------------------------------------------------------------------------
-- apply_manual_kills(candidates) — the ONLY manual-kill write path. A manual
-- kill is a human verdict, not a computed one, so there are no threshold gates
-- to re-enforce — but every row still carries a non-empty reason and script
-- plus full dimensions (table constraints), so it reads like every other bad
-- example. Upsert current kills, prune manual_kill rows no longer killed —
-- a verdict flipped back to testing un-kills automatically. proven_loser and
-- review_rejection rows are never touched here.
-- ----------------------------------------------------------------------------
create or replace function public.apply_manual_kills(candidates jsonb)
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
     cpt_cents, target_cents, results, spend_cents, first_spend_date, captured_at)
  select
    'manual_kill', creative_id, org_id, script, script_version, reason, dimensions,
    cpt_cents, target_cents, results, spend_cents, first_spend_date, now()
  from cand
  on conflict (creative_id) where kind = 'manual_kill' do update set
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
    captured_at      = now();
  get diagnostics n_upserted = row_count;

  delete from bad_examples b
  where b.kind = 'manual_kill'
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
      where (c ->> 'creative_id')::uuid = b.creative_id
    );
  get diagnostics n_pruned = row_count;

  return jsonb_build_object('upserted', n_upserted, 'pruned', n_pruned);
end;
$$;

-- Server-only, like the other refresh RPCs: not a user action.
revoke all on function public.apply_manual_kills(jsonb) from public, anon, authenticated;
grant execute on function public.apply_manual_kills(jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- apply_golden_refresh — same signature (grants survive), now also snapshots
-- the winning cut's transcript from the candidate JSON. Pinned/removed rows
-- stay curator-owned: the update remains gated on status='active'.
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
      (c ->> 'org_id')::uuid            as org_id,
      c ->> 'script'                    as script,
      (c ->> 'script_version')::int     as script_version,
      c ->> 'why_it_won'                as why_it_won,
      c -> 'dimensions'                 as dimensions,
      (c ->> 'score')::numeric          as score,
      (c ->> 'cpt_cents')::int          as cpt_cents,
      (c ->> 'results')::int            as results,
      (c ->> 'target_cents')::int       as target_cents,
      c ->> 'transcript'                as transcript
    from jsonb_array_elements(coalesce(candidates, '[]'::jsonb)) as c
  )
  insert into golden_examples
    (creative_id, org_id, script, script_version, why_it_won, dimensions,
     source, status, score, cpt_cents, results, target_cents, transcript, captured_at)
  select
    creative_id, org_id, script, script_version, why_it_won, dimensions,
    'auto', 'active', score, cpt_cents, results, target_cents, transcript, now()
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
    transcript     = excluded.transcript,
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
