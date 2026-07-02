-- ci/rls_tests.sql
-- Authorization (RLS) tests. Run AFTER the shim + all migrations, as the
-- postgres superuser, with `psql -v ON_ERROR_STOP=1` so any failed assertion
-- (a RAISE EXCEPTION) fails CI. Each check runs inside a DO block that switches
-- to the `authenticated` role and sets request.jwt.claims to a specific user,
-- so the REAL policies from the migrations decide visibility.
--
-- Fixtures are inserted as the superuser (RLS is bypassed for the table owner),
-- and users are created by inserting into auth.users — the on_auth_user_created
-- trigger copies them into public.users with the role/org from raw_user_meta_data.

-- ---- fixture users (trigger -> public.users) ----
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@xclsv.test',  '{"role":"admin","org":"XCLSV"}'),
  ('22222222-2222-2222-2222-222222222222', 'client@outlier.test','{"role":"client_viewer","org":"Outlier"}'),
  ('33333333-3333-3333-3333-333333333333', 'creator1@xclsv.test','{"role":"creator","org":"XCLSV"}'),
  ('44444444-4444-4444-4444-444444444444', 'creator2@xclsv.test','{"role":"creator","org":"XCLSV"}');

-- ---- fixture domain data (as superuser => bypasses RLS) ----
insert into public.concept_families (id, name) values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Test Family');

insert into public.creatives (id, client_org, concept_family_id, hook_line) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Outlier', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Outlier concept'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'XCLSV',   'ffffffff-ffff-ffff-ffff-ffffffffffff', 'XCLSV-only concept');

insert into public.creative_financials (creative_id, internal_cost_cents) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5000);

insert into public.cycles (id, label, starts_on, ends_on, client_org) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Week', '2026-01-01', '2026-01-07', 'Outlier');

-- deliverable assigned to creator1 only
insert into public.deliverables (id, cycle_id, concept_id, assignee_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '33333333-3333-3333-3333-333333333333');

-- ============================================================================
-- Assertions
-- ============================================================================

-- 1) client_viewer: cost is isolated + org-scoping holds.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.creative_financials;
  if n <> 0 then raise exception 'FAIL: client_viewer sees % financial rows, expected 0', n; end if;
  select count(*) into n from public.creatives where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 1 then raise exception 'FAIL: client cannot see its own-org creative (got %)', n; end if;
  select count(*) into n from public.creatives where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if n <> 0 then raise exception 'FAIL: client can see another org''s creative (got %)', n; end if;
  raise notice 'ok - client_viewer: cost isolated + org-scoping enforced';
end $$;

-- 2) staff (admin) CAN see cost (contrast to #1).
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  select count(*) into n from public.creative_financials;
  if n <> 1 then raise exception 'FAIL: staff cannot see financials (got %)', n; end if;
  raise notice 'ok - staff sees financials';
end $$;

-- 3) creator1 sees only their own deliverable.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  select count(*) into n from public.deliverables where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  if n <> 1 then raise exception 'FAIL: creator1 cannot see own deliverable (got %)', n; end if;
  raise notice 'ok - creator1 sees own deliverable';
end $$;

-- 4) creator2 cannot SEE creator1's deliverable.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
  set local role authenticated;
  select count(*) into n from public.deliverables where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  if n <> 0 then raise exception 'FAIL: creator2 can see another creator''s deliverable (got %)', n; end if;
  raise notice 'ok - creator2 cannot see another creator''s deliverable';
end $$;

-- 5) creator2 cannot UPDATE creator1's deliverable (RLS hides the row => 0 rows).
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
  set local role authenticated;
  update public.deliverables set production_status = 'Submitted'
    where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
end $$;
do $$
declare st text;
begin
  select production_status into st from public.deliverables
    where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  if st <> 'Assigned' then
    raise exception 'FAIL: creator2 changed another creator''s deliverable to %', st;
  end if;
  raise notice 'ok - creator2 cannot update another creator''s deliverable';
end $$;

-- 6) creator1 CAN upload a video for their assigned concept.
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  insert into public.video_assets (creative_id, storage_path, file_name)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a/ok.mp4', 'ok.mp4');
  raise notice 'ok - creator1 can upload video for assigned concept';
end $$;

-- 7) creator2 CANNOT upload a video for a concept not assigned to them
--    (va_creator_write WITH CHECK => 42501 insufficient_privilege).
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444"}', true);
  set local role authenticated;
  begin
    insert into public.video_assets (creative_id, storage_path, file_name)
      values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a/bad.mp4', 'bad.mp4');
    raise exception 'FAIL: creator2 uploaded a video for an unassigned concept';
  exception
    when insufficient_privilege then
      raise notice 'ok - creator2 blocked from uploading video for unassigned concept';
  end;
end $$;

\echo 'All RLS assertions passed.'
