-- ci/rls_tests.sql
-- Authorization (RLS) tests. Run AFTER the shim + all migrations, as the
-- postgres superuser, with `psql -v ON_ERROR_STOP=1` so any failed assertion
-- (a RAISE EXCEPTION) fails CI. Each check runs inside a DO block that switches
-- to the `authenticated` role and sets request.jwt.claims per fixture user, so
-- the REAL policies from the migrations decide visibility.
--
-- Fixtures are inserted as the superuser (RLS is bypassed for the table owner),
-- and users are created by inserting into auth.users — the on_auth_user_created
-- trigger copies them into public.users with the role/org_id from
-- raw_user_meta_data (org_id must resolve to a real public.organizations row —
-- the seeded xclsv/outlier orgs from 0016_organizations.sql).

-- ---- fixture users (trigger -> public.users) ----
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@xclsv.test',  '{"role":"admin","org_id":"99999999-9999-9999-9999-999999999991"}'),
  ('22222222-2222-2222-2222-222222222222', 'client@outlier.test','{"role":"client_viewer","org_id":"99999999-9999-9999-9999-999999999992"}'),
  ('33333333-3333-3333-3333-333333333333', 'creator1@xclsv.test','{"role":"creator","org_id":"99999999-9999-9999-9999-999999999991"}'),
  ('44444444-4444-4444-4444-444444444444', 'creator2@xclsv.test','{"role":"creator","org_id":"99999999-9999-9999-9999-999999999991"}');

-- ---- fixture domain data (as superuser => bypasses RLS) ----
-- One concept_family per org (org-scoped since 0016 — a shared row across
-- orgs no longer makes sense).
insert into public.concept_families (id, org_id, name) values
  ('ffffffff-ffff-ffff-ffff-ffffffff0001', '99999999-9999-9999-9999-999999999992', 'Test Family Outlier'),
  ('ffffffff-ffff-ffff-ffff-ffffffff0002', '99999999-9999-9999-9999-999999999991', 'Test Family XCLSV');

insert into public.creatives (id, org_id, concept_family_id, hook_line) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999992', 'ffffffff-ffff-ffff-ffff-ffffffff0001', 'Outlier concept'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999991', 'ffffffff-ffff-ffff-ffff-ffffffff0002', 'XCLSV-only concept'),
  ('abababab-abab-abab-abab-abababababab', '99999999-9999-9999-9999-999999999992', 'ffffffff-ffff-ffff-ffff-ffffffff0001', 'Outlier concept 2');

insert into public.creative_financials (creative_id, internal_cost_cents) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5000);

insert into public.cycles (id, label, starts_on, ends_on, org_id) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Week', '2026-01-01', '2026-01-07', '99999999-9999-9999-9999-999999999992');

-- deliverable assigned to creator1 only
insert into public.deliverables (id, cycle_id, concept_id, assignee_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   '33333333-3333-3333-3333-333333333333');

-- content_cache fixtures: one Outlier winner, one XCLSV winner (org isolation)
insert into public.content_cache (creative_id, org_id, score, results, spend_cents) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999992', 5.0, 50, 500000),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999991', 4.0, 40, 400000);

-- cross_client_patterns fixtures: one draft, one published (staff-only asset —
-- neither should ever be visible to a client/creator, regardless of status).
insert into public.cross_client_patterns (id, title, generalized_summary, source_org_id, authored_by, status) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', 'Draft pattern', 'A draft cross-client pattern.', '99999999-9999-9999-9999-999999999992', '11111111-1111-1111-1111-111111111111', 'draft'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', 'Published pattern', 'A published cross-client pattern.', '99999999-9999-9999-9999-999999999992', '11111111-1111-1111-1111-111111111111', 'published');

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

-- 8) content_cache: a client sees only its own org's winners.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.content_cache where creative_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  if n <> 1 then raise exception 'FAIL: client cannot see its own winner (got %)', n; end if;
  select count(*) into n from public.content_cache where creative_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if n <> 0 then raise exception 'FAIL: client can see another org''s winner (got %)', n; end if;
  raise notice 'ok - content_cache: winners are org-scoped';
end $$;

-- 9) 0017 (single_active_cycle): at most one Active cycle PER ORG; a different
-- org may also be Active.
do $$
begin
  insert into public.cycles (label, starts_on, ends_on, org_id, status)
    values ('Active-Outlier', '2026-02-01', '2026-02-07', '99999999-9999-9999-9999-999999999992', 'Active');
  -- A different org can be Active at the same time (per-org, not global).
  insert into public.cycles (label, starts_on, ends_on, org_id, status)
    values ('Active-XCLSV', '2026-02-01', '2026-02-07', '99999999-9999-9999-9999-999999999991', 'Active');
  -- A SECOND Active cycle in the SAME org must be rejected by cycles_one_active.
  begin
    insert into public.cycles (label, starts_on, ends_on, org_id, status)
      values ('Active-Outlier-2', '2026-02-08', '2026-02-14', '99999999-9999-9999-9999-999999999992', 'Active');
    raise exception 'FAIL: two Active cycles allowed in the same org';
  exception when unique_violation then
    raise notice 'ok - at most one Active cycle per org (cross-org Active allowed)';
  end;
end $$;

-- 10) concept_families: a client sees only its own org's family (0016 —
-- previously ANY authenticated user could read every org's family, leaking
-- another client's proven_hook_formula/compliance_note).
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.concept_families where id = 'ffffffff-ffff-ffff-ffff-ffffffff0001';
  if n <> 1 then raise exception 'FAIL: client cannot see its own-org family (got %)', n; end if;
  select count(*) into n from public.concept_families where id = 'ffffffff-ffff-ffff-ffff-ffffffff0002';
  if n <> 0 then raise exception 'FAIL: client can see another org''s family (got %)', n; end if;
  raise notice 'ok - concept_families: org-scoping enforced';
end $$;

-- 11) cross_client_patterns (0017): staff-only, regardless of status — a
-- client/creator gets zero rows even for a 'published' pattern.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.cross_client_patterns;
  if n <> 0 then raise exception 'FAIL: client_viewer sees % cross_client_patterns rows, expected 0', n; end if;
  raise notice 'ok - cross_client_patterns hidden from client_viewer';
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  select count(*) into n from public.cross_client_patterns;
  if n <> 0 then raise exception 'FAIL: creator sees % cross_client_patterns rows, expected 0', n; end if;
  raise notice 'ok - cross_client_patterns hidden from creator';
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  select count(*) into n from public.cross_client_patterns;
  if n <> 2 then raise exception 'FAIL: staff sees % cross_client_patterns rows, expected 2', n; end if;
  raise notice 'ok - staff sees all cross_client_patterns regardless of status';
end $$;

-- 12) organizations (0015): a client_viewer sees only their own org's row;
-- staff sees all.
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.organizations;
  if n <> 1 then raise exception 'FAIL: client_viewer sees % organizations rows, expected 1', n; end if;
  select count(*) into n from public.organizations where slug = 'outlier';
  if n <> 1 then raise exception 'FAIL: client_viewer cannot see its own org row (got %)', n; end if;
  raise notice 'ok - organizations: client_viewer sees only its own org';
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  select count(*) into n from public.organizations;
  if n <> 2 then raise exception 'FAIL: staff sees % organizations rows, expected 2', n; end if;
  raise notice 'ok - organizations: staff sees all orgs';
end $$;

-- 17) creator upload deletion (0025): a creator may delete their OWN upload on
-- an assigned, UNPUBLISHED concept — never someone else's upload, never a
-- published cut.
do $$
declare n int;
begin
  insert into public.video_assets (id, creative_id, storage_path, file_name, version_label, uploaded_by) values
    ('deadbeef-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/v1/own.mp4',   'own.mp4',   'v1', '33333333-3333-3333-3333-333333333333'),
    ('deadbeef-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/v1/staff.mp4', 'staff.mp4', 'v1', '11111111-1111-1111-1111-111111111111');

  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  delete from public.video_assets where id = 'deadbeef-0000-0000-0000-000000000001';
  delete from public.video_assets where id = 'deadbeef-0000-0000-0000-000000000002';
  reset role;

  select count(*) into n from public.video_assets where id = 'deadbeef-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL: creator could not delete own upload on unpublished concept'; end if;
  select count(*) into n from public.video_assets where id = 'deadbeef-0000-0000-0000-000000000002';
  if n <> 1 then raise exception 'FAIL: creator deleted another user''s upload'; end if;

  -- publish the concept; the creator's own re-upload must now be undeletable
  update public.deliverables set production_status = 'Delivered'
   where concept_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  insert into public.video_assets (id, creative_id, storage_path, file_name, version_label, uploaded_by) values
    ('deadbeef-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/v1/pub.mp4', 'pub.mp4', 'v1', '33333333-3333-3333-3333-333333333333');

  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  delete from public.video_assets where id = 'deadbeef-0000-0000-0000-000000000003';
  reset role;

  select count(*) into n from public.video_assets where id = 'deadbeef-0000-0000-0000-000000000003';
  if n <> 1 then raise exception 'FAIL: creator deleted a published cut'; end if;
  raise notice 'ok - creator deletes own unpublished upload only (0025)';

  -- restore fixture state for downstream suites
  delete from public.video_assets where id in
    ('deadbeef-0000-0000-0000-000000000002', 'deadbeef-0000-0000-0000-000000000003');
  update public.deliverables set production_status = 'Assigned'
   where concept_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
end $$;

-- 18) winner_breakdowns (0030): staff see all; creators see ACTIVE rows only
-- and only for orgs they are assigned to (creator_in_org, per 0024); clients
-- see none (the teardown derives from internal scripts).
-- Fixture layout makes the cross-tenant case load-bearing: the org-991 row is
-- ACTIVE, so a policy missing creator_in_org() would leak it to creator1
-- (assigned only in org 992) and fail the assertion below.
insert into public.winner_breakdowns
  (creative_id, org_id, source, status, breakdown, dimensions, model, input_hash) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999992', 'performance', 'active',
   '{"hook":{"device":"d","first_three_seconds":"f","why_it_works":"w"},"beats":[{"beat":"b","purpose":"p"}],"proof_device":"pd","cta":{"text":"t","placement":"end","style":"spoken"},"delivery":{"pacing":"fast","format_rationale":"fr","talent_rationale":"tr","theme":"Information"},"replicable_pattern":"rp","vary_next":["v1"]}',
   '{"family":"Test Family Outlier","hook_line":"Outlier concept","hook_angle":null,"archetype":null,"sport":null,"format":null}',
   'test-model', 'hash-own-org-active'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999991', 'editorial', 'active',
   '{"hook":{"device":"d","first_three_seconds":"f","why_it_works":"w"},"beats":[{"beat":"b","purpose":"p"}],"proof_device":"pd","cta":{"text":"t","placement":"end","style":"spoken"},"delivery":{"pacing":"fast","format_rationale":"fr","talent_rationale":"tr","theme":"Information"},"replicable_pattern":"rp","vary_next":["v1"]}',
   '{"family":"Test Family XCLSV","hook_line":"XCLSV-only concept","hook_angle":null,"archetype":null,"sport":null,"format":null}',
   'test-model', 'hash-other-org-active'),
  ('abababab-abab-abab-abab-abababababab', '99999999-9999-9999-9999-999999999992', 'performance', 'inactive',
   '{"hook":{"device":"d","first_three_seconds":"f","why_it_works":"w"},"beats":[{"beat":"b","purpose":"p"}],"proof_device":"pd","cta":{"text":"t","placement":"end","style":"spoken"},"delivery":{"pacing":"fast","format_rationale":"fr","talent_rationale":"tr","theme":"Information"},"replicable_pattern":"rp","vary_next":["v1"]}',
   '{"family":"Test Family Outlier","hook_line":"Outlier concept 2","hook_angle":null,"archetype":null,"sport":null,"format":null}',
   'test-model', 'hash-own-org-inactive');
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111"}', true);
  set local role authenticated;
  select count(*) into n from public.winner_breakdowns;
  if n <> 3 then raise exception 'FAIL: staff sees % winner_breakdowns rows, expected 3', n; end if;
  raise notice 'ok - winner_breakdowns: staff sees all rows incl. inactive';
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333"}', true);
  set local role authenticated;
  select count(*) into n from public.winner_breakdowns;
  if n <> 1 then raise exception 'FAIL: creator sees % winner_breakdowns rows, expected 1 (active + own assigned org only)', n; end if;
  select count(*) into n from public.winner_breakdowns
    where creative_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  if n <> 0 then raise exception 'FAIL: creator sees an ACTIVE breakdown for an org they are not assigned to'; end if;
  select count(*) into n from public.winner_breakdowns where status = 'inactive';
  if n <> 0 then raise exception 'FAIL: creator sees % inactive winner_breakdowns rows, expected 0', n; end if;
  raise notice 'ok - winner_breakdowns: creator reads active rows in assigned orgs only';
end $$;
do $$
declare n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222"}', true);
  set local role authenticated;
  select count(*) into n from public.winner_breakdowns;
  if n <> 0 then raise exception 'FAIL: client_viewer sees % winner_breakdowns rows, expected 0', n; end if;
  raise notice 'ok - winner_breakdowns hidden from client_viewer';
end $$;

\echo 'All RLS assertions passed.'
