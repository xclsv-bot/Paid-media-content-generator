-- ============================================================================
-- 0008_hypothesis.sql — the test hypothesis for a concept.
-- The redesigned Concept brief is organized around "what we're testing"; this
-- column holds that one-sentence hypothesis. Nullable; older rows stay blank.
-- ============================================================================

alter table public.creatives add column if not exists hypothesis text;
