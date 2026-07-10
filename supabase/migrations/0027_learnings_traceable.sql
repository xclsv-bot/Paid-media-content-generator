-- ============================================================================
-- 0027_learnings_traceable.sql — every learnings recommendation cites its
-- backing rows.
--
-- The weekly cron used to emit do_more/do_less/watchouts as bare string[] — free
-- text a reader could not trace to a row. They now hold a Rec[]:
--   { directive: text, sources: text[], metric: text }
-- where `sources` are the exact backing-row IDs (golden/loser/rejection
-- creative_ids, or the family name of an explore/validating slot) a cold reader
-- retrieves to verify the rec, and `metric` is the authoritative figure stamped
-- from those rows at write time. See src/lib/loop/generate.ts (traceableRecs).
--
-- The columns are already jsonb, so the shape change needs no DDL; legacy
-- string[] rows are normalized on read (src/lib/loop/learnings.ts). We add the
-- new `explore` category (unfilled explore slots, cited by family name).
-- ============================================================================

alter table public.learnings add column if not exists explore jsonb;

-- sources are self-describing refs `<kind>:<key>` so a cold reader knows which
-- store to query from the ref alone: golden|loser|rejection:<creative_id>,
-- explore|validating:<family name>.
comment on column public.learnings.do_more   is 'Rec[] { directive, sources:text[] (golden:<creative_id>), metric } — variant the proven winner';
comment on column public.learnings.do_less   is 'Rec[] { directive, sources:text[] (loser:<creative_id>), metric } — stop repeating the proven loser';
comment on column public.learnings.explore   is 'Rec[] { directive, sources:text[] (explore:<family>), metric } — fill the named unfilled slot';
comment on column public.learnings.watchouts is 'Rec[] { directive, sources:text[] (rejection:<creative_id> or validating:<family>), metric }';
