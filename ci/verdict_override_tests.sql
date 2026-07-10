-- ci/verdict_override_tests.sql
-- Verdict-override selection tests. Run AFTER the shim + all migrations, as the
-- postgres superuser, with `psql -v ON_ERROR_STOP=1` so any failed assertion
-- aborts the job.
--
-- These lock the query semantics refreshAll relies on to pick the "current human
-- override" per ad name (src/lib/loop/refresh.ts). The rule the loop encodes:
--   * only rows a human or the report explicitly set (verdict_source user/report)
--     count as an override; 'auto' rows never do;
--   * among a name's override rows the most RECENTLY WRITTEN one wins (updated_at),
--     independent of flight_start — quick-entry rows carry no flight date, so
--     ordering by flight_start would wrongly rank them last.
-- The bugs these guard against: a null-flight quick-entry KILL being shadowed by
-- an older dated flight, and a fresh 'auto' row silently clearing a human KILL.

-- ---- fixtures: one ad name, three flights written at different times ----
-- AD_X: an older dated report GRADUATE, a newer null-flight user KILL, and a
-- still-newer 'auto' row (which must NOT count as an override).
-- org_id is NOT NULL since 0026_metrics_org; use the seeded client org 'outlier'.
insert into public.creative_metrics (org_id, ad_name, flight_label, flight_start, verdict, verdict_source, updated_at) values
  ('99999999-9999-9999-9999-999999999992', 'OVR_AD_X', 'Week of Jul 1',  '2026-07-01', 'GRADUATE',     'report', '2026-07-01T00:00:00Z'),
  ('99999999-9999-9999-9999-999999999992', 'OVR_AD_X', 'default',         null,         'KILL',         'user',   '2026-07-08T00:00:00Z'),
  ('99999999-9999-9999-9999-999999999992', 'OVR_AD_X', 'Week of Jul 13', '2026-07-13', 'KEEP_TESTING', 'auto',   '2026-07-13T00:00:00Z');
-- AD_Y: only an 'auto' row — must yield no override at all.
insert into public.creative_metrics (org_id, ad_name, flight_label, flight_start, verdict, verdict_source, updated_at) values
  ('99999999-9999-9999-9999-999999999992', 'OVR_AD_Y', 'Week of Jul 1', '2026-07-01', 'GRADUATE', 'auto', '2026-07-01T00:00:00Z');

-- The exact override-map query refreshAll issues (.in + .not + two .order calls).
create or replace function pg_temp.override_for(p_ad text)
returns text language sql as $$
  select verdict
  from public.creative_metrics
  where verdict_source in ('user', 'report') and verdict is not null
    and ad_name = p_ad
  order by updated_at desc, flight_start desc nulls last
  limit 1;
$$;

do $$
declare v text;
begin
  -- 1) The newer null-flight user KILL beats the older dated report GRADUATE,
  --    and the still-newer 'auto' row is excluded entirely.
  v := pg_temp.override_for('OVR_AD_X');
  if v is distinct from 'KILL' then
    raise exception 'FAIL: expected KILL override for OVR_AD_X, got %', coalesce(v, '<none>');
  end if;
  raise notice 'ok - newest human verdict wins over older dated report; auto excluded';

  -- 2) An ad whose only row is 'auto' produces no override (gates decide).
  v := pg_temp.override_for('OVR_AD_Y');
  if v is not null then
    raise exception 'FAIL: expected no override for auto-only OVR_AD_Y, got %', v;
  end if;
  raise notice 'ok - an auto-only ad name yields no override';
end $$;

-- cleanup so re-runs and later suites see a clean table
delete from public.creative_metrics where ad_name in ('OVR_AD_X', 'OVR_AD_Y');
