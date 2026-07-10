// Text embeddings for the semantic near-duplication gate. Kept tiny and
// dependency-free (fetch, no SDK) like src/lib/transcribe.ts, and reuses the
// same OPENAI_API_KEY. The lexical gate (src/lib/loop/golden.ts) catches
// near-verbatim copies; embeddings add paraphrase resistance (same idea, fresh
// words). Everything degrades gracefully: with no key, embed() returns null and
// callers fall back to the lexical gate alone.

const EMBED_MODEL = "text-embedding-3-small";

export function embeddingsEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// Cosine-similarity threshold above which two texts are "the same idea".
// Flagged + tunable: 0.9 is deliberately high — text-embedding-3-small puts
// genuine paraphrases of a short hook near ~0.9–0.97 and distinct hooks well
// below ~0.6. Env-overridable via SEMANTIC_DUP_THRESHOLD.
export function semanticDupThreshold(): number {
  const n = Number(process.env.SEMANTIC_DUP_THRESHOLD);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.9;
}

// Embed a single string. Returns the vector, or null when embeddings are not
// configured or the API fails (callers must treat null as "unavailable", not
// "not a duplicate"). Never throws.
export async function embed(text: string): Promise<number[] | null> {
  const key = process.env.OPENAI_API_KEY;
  const input = (text ?? "").trim();
  if (!key || !input) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { embedding?: number[] }[] };
    const vec = json.data?.[0]?.embedding;
    return Array.isArray(vec) && vec.length > 0 ? vec : null;
  } catch {
    return null;
  }
}

// Cosine similarity of two equal-length vectors, in [-1, 1]. Returns 0 for a
// missing/empty/mismatched pair rather than throwing.
export function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
