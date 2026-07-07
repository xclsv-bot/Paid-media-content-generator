-- ci/golden_tests.sql
-- Golden Set trust tests. Run AFTER the shim + all migrations (+ rls_tests),
-- as the postgres superuser, with `psql -v ON_ERROR_STOP=1` so any failed
-- assertion (RAISE EXCEPTION) fails CI.
--
-- The scenario mirrors the acceptance check for golden_examples:
--   seed -> refresh run 1 -> curator pins one row + removes another ->
--   refresh run 2 (candidates still include both) ->
--   refresh run 3 (candidates include NEITHER, plus one stale active row) ->
--   assert: pinned survives untouched, removed stays gone, stale active row
--   is pruned, and no consumable row is missing a required field.

-- ---- fixtures: three winners with scripts ----
insert into public.concept_families (id, name) values
  ('99999999-0000-0000-0000-00000000000f', 'Golden Family')
on conflict do nothing;

insert into public.creatives (id, client_org, concept_family_id, hook_line, hook_angle, archetype, sport, format) values
  ('99999999-0000-0000-0000-000000000001', 'Outlier', '99999999-0000-0000-0000-00000000000f', 'Winner A', 'Angle A', 'Qualifier', 'NFL', '9:16'),
  ('99999999-0000-0000-0000-000000000002', 'Outlier', '99999999-0000-0000-0000-00000000000f', 'Winner B', 'Angle B', 'Broad-appeal', 'NBA', '9:16'),
  ('99999999-0000-0000-0000-000000000003', 'Outlier', '99999999-0000-0000-0000-00000000000f', 'Winner C', 'Angle C', 'Mixed', 'MLB', '9:16');

insert into public.scripts (concept_id, body, version) values
  ('99999999-0000-0000-0000-000000000001', 'Script A v1', 1),
  ('99999999-0000-0000-0000-000000000002', 'Script B v1', 1),
  ('99999999-0000-0000-0000-000000000003', 'Script C v1', 1);

-- Reusable candidate payloads (what /api/winners/refresh builds).
create or replace function pg_temp.cand(cid uuid, hook text, script text, sc numeric)
returns jsonb language sql as $$
  select jsonb_build_object(
    'creative_id', cid,
    'client_org', 'Outlier',
    'script', script,
    'script_version', 1,
    'why_it_won', 'Hit: CPT $20.00 <= $30.00 over 40 trials',
    'dimensions', jsonb_build_object(
      'family', 'Golden Family', 'hook_line', hook, 'hook_angle', 'Angle',
      'archetype', 'Qualifier', 'sport', 'NFL', 'format', '9:16'),
    'score', sc,
    'cpt_cents', 2000,
    'results', 40,
    'target_cents', 3000
  );
$$;

-- ---- refresh run 1: all three qualify ----
do $$
declare res jsonb;
begin
  res := public.apply_golden_refresh(jsonb_build_array(
    pg_temp.cand('99999999-0000-0000-0000-000000000001', 'Winner A', 'Script A v1', 3.0),
    pg_temp.cand('99999999-0000-0000-0000-000000000002', 'Winner B', 'Script B v1', 2.0),
    pg_temp.cand('99999999-0000-0000-0000-000000000003', 'Winner C', 'Script C v1', 1.0)
  ));
  if (res->>'upserted')::int <> 3 then
    raise exception 'FAIL: run 1 expected 3 upserts, got %', res;
  end if;
end $$;

-- ---- curator: pin A (with a custom why), remove B ----
update public.golden_examples
   set status = 'pinned', source = 'curated', why_it_won = 'Curator: the hook pattern to copy'
 where creative_id = '99999999-0000-0000-0000-000000000001';
update public.golden_examples
   set status = 'removed', source = 'curated'
 where creative_id = '99999999-0000-0000-0000-000000000002';

-- ---- refresh run 2: candidates STILL include the pinned + removed rows ----
do $$
declare n int; w text; s text;
begin
  perform public.apply_golden_refresh(jsonb_build_array(
    pg_temp.cand('99999999-0000-0000-0000-000000000001', 'Winner A', 'Script A v2 DRIFTED', 9.9),
    pg_temp.cand('99999999-0000-0000-0000-000000000002', 'Winner B', 'Script B v1', 2.0),
    pg_temp.cand('99999999-0000-0000-0000-000000000003', 'Winner C', 'Script C v1', 1.5)
  ));
  -- pinned row: neither overwritten nor re-scored
  select why_it_won, script into w, s from public.golden_examples
   where creative_id = '99999999-0000-0000-0000-000000000001';
  if w <> 'Curator: the hook pattern to copy' or s <> 'Script A v1' then
    raise exception 'FAIL: refresh overwrote a pinned row (why=%, script=%)', w, s;
  end if;
  -- removed row: not resurrected
  select count(*) into n from public.golden_examples
   where creative_id = '99999999-0000-0000-0000-000000000002' and status <> 'removed';
  if n <> 0 then raise exception 'FAIL: refresh resurrected a removed row'; end if;
end $$;

-- ---- refresh run 3: candidates include NEITHER curated row, and drop C ----
do $$
declare n int;
begin
  perform public.apply_golden_refresh('[]'::jsonb);
  -- pinned row survives an empty candidate set (never pruned)
  select count(*) into n from public.golden_examples
   where creative_id = '99999999-0000-0000-0000-000000000001' and status = 'pinned';
  if n <> 1 then raise exception 'FAIL: prune deleted a pinned row'; end if;
  -- removed tombstone survives (still immune to future auto-populate)
  select count(*) into n from public.golden_examples
   where creative_id = '99999999-0000-0000-0000-000000000002' and status = 'removed';
  if n <> 1 then raise exception 'FAIL: prune deleted a removed tombstone'; end if;
  -- the stale ACTIVE row (C) is pruned
  select count(*) into n from public.golden_examples
   where creative_id = '99999999-0000-0000-0000-000000000003';
  if n <> 0 then raise exception 'FAIL: stale active row was not pruned'; end if;
end $$;

-- ---- completeness: no row is missing a required field ----
do $$
declare n int;
begin
  select count(*) into n from public.golden_examples
   where script is null or length(btrim(script)) = 0
      or why_it_won is null or length(btrim(why_it_won)) = 0
      or dimensions is null
      or not (dimensions ?& array['family','hook_line','hook_angle','archetype','sport','format'])
      or source is null or status is null
      or score is null or cpt_cents is null or results is null or target_cents is null;
  if n <> 0 then raise exception 'FAIL: % golden rows missing required fields', n; end if;
end $$;

-- ---- constraints reject incomplete candidates (whole refresh aborts) ----
do $$
declare ok boolean := false;
begin
  begin
    perform public.apply_golden_refresh(jsonb_build_array(
      (pg_temp.cand('99999999-0000-0000-0000-000000000003', 'Winner C', '   ', 1.0))
    ));
  exception when check_violation or not_null_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: empty-script candidate was accepted'; end if;

  ok := false;
  begin
    perform public.apply_golden_refresh(jsonb_build_array(
      (pg_temp.cand('99999999-0000-0000-0000-000000000003', 'Winner C', 'Script C v1', 1.0))
        - 'why_it_won'
    ));
  exception when check_violation or not_null_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: candidate without why_it_won was accepted'; end if;

  ok := false;
  begin
    insert into public.golden_examples
      (creative_id, client_org, script, why_it_won, dimensions, source, status,
       score, cpt_cents, results, target_cents)
    values
      ('99999999-0000-0000-0000-000000000003', 'Outlier', 'Script C', 'why',
       '{"family":"x"}'::jsonb, 'auto', 'active', 1, 2000, 40, 3000);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: dimensions missing required keys was accepted'; end if;
end $$;

-- ---- RLS: creator reads non-removed only; client sees nothing; creator cannot write ----
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  select count(*) into n from public.golden_examples where status = 'removed';
  if n <> 0 then raise exception 'FAIL: creator can see removed golden rows'; end if;
  select count(*) into n from public.golden_examples;
  if n <> 1 then raise exception 'FAIL: creator should see exactly the pinned row, got %', n; end if;
  update public.golden_examples set why_it_won = 'hacked' where status = 'pinned';
  reset role;
  select count(*) into n from public.golden_examples where why_it_won = 'hacked';
  if n <> 0 then raise exception 'FAIL: creator UPDATE on golden_examples was applied'; end if;
end $$;

do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.golden_examples;
  if n <> 0 then raise exception 'FAIL: client_viewer sees % golden rows, expected 0', n; end if;
  reset role;
end $$;

-- ---- non-service roles cannot execute the refresh function ----
do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  begin
    perform public.apply_golden_refresh('[]'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL: authenticated role can execute apply_golden_refresh'; end if;
end $$;

select 'All Golden Set assertions passed.' as result;
