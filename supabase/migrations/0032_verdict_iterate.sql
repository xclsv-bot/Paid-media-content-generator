-- ============================================================================
-- 0032_verdict_iterate.sql — ITERATE is a legal verdict value.
-- ============================================================================
-- The report vocabulary is 4-valued: the paid team's sheet says ITERATE for
-- "1.5–2x BAU: new hook/edit, don't promote as-is", and the parser
-- (src/lib/metrics/report.ts) + the Performance page treat it as first-class.
-- But 0029's cm_verdict_values check only allowed GRADUATE/KEEP_TESTING/KILL,
-- so any weekly-report import containing an Iterate row fails the whole
-- upsert batch. Widen the constraint to match what the importers write.
--
-- Rows 0029 already normalized (ITERATE → KEEP_TESTING) are not recoverable —
-- this is forward-looking; re-importing a report restores the distinction.

alter table public.creative_metrics drop constraint cm_verdict_values;
alter table public.creative_metrics
  add constraint cm_verdict_values
  check (verdict is null or verdict in ('GRADUATE', 'ITERATE', 'KEEP_TESTING', 'KILL'));
