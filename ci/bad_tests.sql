-- ci/bad_tests.sql
-- Bad-Example gate tests. Run AFTER the shim + all migrations (+ rls_tests),
-- as the postgres superuser, with `psql -v ON_ERROR_STOP=1`.
--
-- The scenario mirrors the acceptance check for bad_examples: construct
-- boundary cases — immature + high CPT, low-volume + high CPT, and
-- mature + high-volume + just-under-target — and verify NONE lands in the
-- table; then verify a reasonless rejection fails to insert. Thresholds are
-- passed in (min_results=20, cpt_multiplier=1.5, mature_days=21), mirroring
-- how the route passes config values.

-- ---- fixtures ----
insert into public.concept_families (id, name) values
  ('88888888-0000-0000-0000-00000000000f', 'Loser Family')
on conflict do nothing;

insert into public.creatives (id, client_org, concept_family_id, hook_line, hook_angle, archetype, sport, format) values
  ('88888888-0000-0000-0000-000000000001', 'Outlier', '88888888-0000-0000-0000-00000000000f', 'Loser A', 'Angle A', 'Qualifier', 'NFL', '9:16'),
  ('88888888-0000-0000-0000-000000000002', 'Outlier', '88888888-0000-0000-0000-00000000000f', 'Loser B', 'Angle B', 'Mixed', 'NBA', '9:16');

insert into public.scripts (id, concept_id, body, version) values
  ('88888888-1111-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'Losing script A', 1),
  ('88888888-1111-0000-0000-000000000002', '88888888-0000-0000-0000-000000000002', 'Losing script B', 1);

insert into public.script_reviews (id, script_id, concept_id, scores, overall, verdict, compliance_flags) values
  ('88888888-2222-0000-0000-000000000001', '88888888-1111-0000-0000-000000000001',
   '88888888-0000-0000-0000-000000000001', '{"compliance":3}'::jsonb, 3, 'revise',
   '["names a competitor app"]'::jsonb);

-- Candidate builder: first_spend is `days_ago` days before today.
create or replace function pg_temp.bcand(
  cid uuid, days_ago int, res int, cpt int, tgt int, why text
) returns jsonb language sql as $$
  select jsonb_build_object(
    'creative_id', cid,
    'client_org', 'Outlier',
    'script', 'Losing script A',
    'script_version', 1,
    'reason', why,
    'dimensions', jsonb_build_object(
      'family', 'Loser Family', 'hook_line', 'Loser A', 'hook_angle', 'Angle A',
      'archetype', 'Qualifier', 'sport', 'NFL', 'format', '9:16'),
    'cpt_cents', cpt,
    'target_cents', tgt,
    'results', res,
    'spend_cents', 100000,
    'first_spend_date', (current_date - days_ago)::text
  );
$$;

create or replace function pg_temp.expect_gate_reject(cand jsonb, label text)
returns void language plpgsql as $$
declare ok boolean := false; n int;
begin
  begin
    perform public.apply_bad_refresh(jsonb_build_array(cand),
                                     20, 1.5::numeric, 21);
  exception when others then ok := true;
  end;
  if not ok then
    raise exception 'FAIL: % candidate was accepted by apply_bad_refresh', label;
  end if;
  select count(*) into n from public.bad_examples
   where creative_id = (cand ->> 'creative_id')::uuid and kind = 'proven_loser';
  if n <> 0 then
    raise exception 'FAIL: % candidate landed in bad_examples', label;
  end if;
end;
$$;

-- ---- boundary cases: none may land ----
-- 1) immature (first spend 5 days ago) + high volume + high CPT
select pg_temp.expect_gate_reject(
  pg_temp.bcand('88888888-0000-0000-0000-000000000001', 5, 40, 9000, 3000, 'over target'),
  'immature');
-- boundary: 20 days ago is still immature at a 21-day window
select pg_temp.expect_gate_reject(
  pg_temp.bcand('88888888-0000-0000-0000-000000000001', 20, 40, 9000, 3000, 'over target'),
  'immature-boundary');
-- 2) low volume (5 trials) + mature + high CPT
select pg_temp.expect_gate_reject(
  pg_temp.bcand('88888888-0000-0000-0000-000000000001', 30, 5, 9000, 3000, 'over target'),
  'low-volume');
-- boundary: 19 trials is under a floor of 20
select pg_temp.expect_gate_reject(
  pg_temp.bcand('88888888-0000-0000-0000-000000000001', 30, 19, 9000, 3000, 'over target'),
  'volume-boundary');
-- 3) mature + high volume + just-UNDER-target CPT
select pg_temp.expect_gate_reject(
  pg_temp.bcand('88888888-0000-0000-0000-000000000001', 30, 40, 2999, 3000, 'under target'),
  'just-under-target');
-- boundary: over target but under the 1.5x multiplier (4499 < 4500)
select pg_temp.expect_gate_reject(
  pg_temp.bcand('88888888-0000-0000-0000-000000000001', 30, 40, 4499, 3000, 'over target, under multiplier'),
  'under-multiplier');
-- 4) reasonless proven loser: gates pass, but the empty reason must abort
select pg_temp.expect_gate_reject(
  pg_temp.bcand('88888888-0000-0000-0000-000000000001', 30, 40, 9000, 3000, '   '),
  'reasonless-loser');

-- ---- a fully-gated loser DOES land, and prune works ----
do $$
declare res jsonb; n int;
begin
  res := public.apply_bad_refresh(jsonb_build_array(
    pg_temp.bcand('88888888-0000-0000-0000-000000000001', 30, 40, 9000, 3000,
                  'Proven loser: CPT $90.00 is 3.0x the $30.00 target over 40 trials')),
    20, 1.5::numeric, 21);
  if (res->>'upserted')::int <> 1 then
    raise exception 'FAIL: valid loser was not upserted (%)', res;
  end if;
  -- boundary: exactly-at-multiplier (4500 = 1.5 x 3000) and exactly-mature (21d)
  -- and exactly-at-volume-floor (20) is accepted
  res := public.apply_bad_refresh(jsonb_build_array(
    pg_temp.bcand('88888888-0000-0000-0000-000000000002', 21, 20, 4500, 3000,
                  'Proven loser: at every gate boundary')),
    20, 1.5::numeric, 21);
  if (res->>'upserted')::int <> 1 then
    raise exception 'FAIL: at-boundary loser was not upserted (%)', res;
  end if;
  -- prune: a run without A drops A, keeps B
  perform public.apply_bad_refresh(jsonb_build_array(
    pg_temp.bcand('88888888-0000-0000-0000-000000000002', 21, 20, 4500, 3000,
                  'Proven loser: at every gate boundary')),
    20, 1.5::numeric, 21);
  select count(*) into n from public.bad_examples
   where creative_id = '88888888-0000-0000-0000-000000000001' and kind = 'proven_loser';
  if n <> 0 then raise exception 'FAIL: stale proven loser was not pruned'; end if;
end $$;

-- ---- review rejections: the reason is mandatory ----
do $$
declare ok boolean := false; n int;
begin
  -- reasonless rejection fails to insert
  begin
    insert into public.bad_examples
      (kind, creative_id, client_org, script, script_version, reason, dimensions, review_id)
    values
      ('review_rejection', '88888888-0000-0000-0000-000000000001', 'Outlier',
       'Losing script A', 1, '', '{"family":null,"hook_line":null,"hook_angle":null,"archetype":null,"sport":null,"format":null}'::jsonb,
       '88888888-2222-0000-0000-000000000001');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: reasonless rejection was inserted'; end if;

  -- a rejection without its review is also refused
  ok := false;
  begin
    insert into public.bad_examples
      (kind, creative_id, client_org, script, script_version, reason, dimensions)
    values
      ('review_rejection', '88888888-0000-0000-0000-000000000001', 'Outlier',
       'Losing script A', 1, 'Compliance: names a competitor app',
       '{"family":null,"hook_line":null,"hook_angle":null,"archetype":null,"sport":null,"format":null}'::jsonb);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL: rejection without review_id was inserted'; end if;

  -- a rejection WITH its compliance reason inserts fine
  insert into public.bad_examples
    (kind, creative_id, client_org, script, script_version, reason, dimensions, review_id)
  values
    ('review_rejection', '88888888-0000-0000-0000-000000000001', 'Outlier',
     'Losing script A', 1, 'Compliance: names a competitor app',
     '{"family":"Loser Family","hook_line":"Loser A","hook_angle":"Angle A","archetype":"Qualifier","sport":"NFL","format":"9:16"}'::jsonb,
     '88888888-2222-0000-0000-000000000001');
  select count(*) into n from public.bad_examples where kind = 'review_rejection';
  if n <> 1 then raise exception 'FAIL: valid rejection did not insert (got %)', n; end if;
end $$;

-- ---- completeness: every stored row carries its reason + snapshot rules ----
do $$
declare n int;
begin
  select count(*) into n from public.bad_examples
   where reason is null or length(btrim(reason)) = 0
      or script is null or length(btrim(script)) = 0
      or not (dimensions ?& array['family','hook_line','hook_angle','archetype','sport','format'])
      or (kind = 'proven_loser' and (cpt_cents is null or target_cents is null
          or results is null or first_spend_date is null or gates is null
          or cpt_cents <= target_cents))
      or (kind = 'review_rejection' and review_id is null);
  if n <> 0 then raise exception 'FAIL: % bad_examples rows violate completeness', n; end if;
end $$;

-- ---- RLS + execution rights ----
do $$
declare n int; ok boolean := false;
begin
  -- creator may read
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  select count(*) into n from public.bad_examples;
  if n < 1 then raise exception 'FAIL: creator cannot read bad_examples'; end if;
  -- creator cannot write
  begin
    insert into public.bad_examples
      (kind, creative_id, client_org, script, reason, dimensions, cpt_cents, target_cents,
       results, spend_cents, first_spend_date, gates)
    values ('proven_loser', '88888888-0000-0000-0000-000000000002', 'Outlier', 's', 'r',
       '{"family":null,"hook_line":null,"hook_angle":null,"archetype":null,"sport":null,"format":null}'::jsonb,
       9000, 3000, 40, 100000, current_date - 30, '{}'::jsonb);
  exception when others then ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL: creator INSERT on bad_examples succeeded'; end if;
end $$;

do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.bad_examples;
  if n <> 0 then raise exception 'FAIL: client_viewer sees % bad_examples rows', n; end if;
  reset role;
end $$;

do $$
declare ok boolean := false;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  begin
    perform public.apply_bad_refresh('[]'::jsonb, 20, 1.5::numeric, 21);
  exception when insufficient_privilege then ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL: authenticated role can execute apply_bad_refresh'; end if;
end $$;

select 'All Bad-Example assertions passed.' as result;
