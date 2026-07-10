-- ============================================================================
-- 0026_golden_embeddings.sql — cache a golden example's hook embedding.
-- ============================================================================
-- The semantic near-duplication gate (src/lib/embeddings.ts + the concept
-- persist boundary) compares a proposed hook's embedding to each golden hook's
-- embedding. Embeddings are cached HERE, lazily populated at gate time, so we
-- don't re-embed unchanged hooks on every refresh:
--   * embedding    — the hook_line's vector, as a jsonb float array (no pgvector;
--                    the golden set is tiny, cosine is computed in JS).
--   * embedding_of — the exact text the vector was built from, so a later hook
--                    edit invalidates the cache (embedding_of <> hook_line).
-- Both nullable: a row with no cached embedding (or a stale one) is embedded on
-- demand the next time a gate runs, and the vector written back.
-- ============================================================================

alter table public.golden_examples add column embedding    jsonb;
alter table public.golden_examples add column embedding_of  text;
