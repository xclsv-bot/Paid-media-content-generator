import type { SupabaseClient } from "@supabase/supabase-js";
import { cosine, embed, embeddingsEnabled, semanticDupThreshold } from "@/lib/embeddings";
import type { GoldenExample } from "@/lib/loop/golden";

// The SEMANTIC half of the diversity gate: does a proposed hook mean the same
// thing as a golden hook, even if it's reworded? The lexical gate
// (findDuplicateHook) catches shared words; this catches shared MEANING.
//
// Golden hook embeddings are cached on the row (golden_examples.embedding, keyed
// by embedding_of = the text embedded) and populated LAZILY here: any example
// whose cache is missing or stale (hook edited) is embedded once and written
// back, so we never re-embed unchanged hooks. Returns the matching golden hook
// (for the error message) or null. Degrades to null — never a false "duplicate"
// — when embeddings aren't configured or an API call fails; the lexical gate
// still applies at the call site.
export async function findSemanticDuplicateHook(
  supabase: SupabaseClient,
  hookLine: string | null | undefined,
  examples: GoldenExample[],
  threshold: number = semanticDupThreshold(),
): Promise<string | null> {
  const candidate = (hookLine ?? "").trim();
  if (!candidate || !embeddingsEnabled() || examples.length === 0) return null;

  // Freshen the cache: embed any golden hook whose stored vector is absent or
  // was built from different text, and persist it (best-effort — a failed
  // write just means we re-embed next time, never a wrong verdict).
  const withVectors: { hook: string; vector: number[] }[] = [];
  for (const e of examples) {
    const hook = e.dimensions?.hook_line?.trim();
    if (!hook) continue;
    let vector = e.embedding && e.embedding_of === hook ? e.embedding : null;
    if (!vector) {
      vector = await embed(hook);
      if (vector) {
        await supabase
          .from("golden_examples")
          .update({ embedding: vector, embedding_of: hook })
          .eq("creative_id", e.creative_id);
      }
    }
    if (vector) withVectors.push({ hook, vector });
  }
  if (withVectors.length === 0) return null;

  const candidateVec = await embed(candidate);
  if (!candidateVec) return null;

  let best: { hook: string; score: number } | null = null;
  for (const { hook, vector } of withVectors) {
    const score = cosine(candidateVec, vector);
    if (!best || score > best.score) best = { hook, score };
  }
  return best && best.score >= threshold ? best.hook : null;
}
