import type { SupabaseClient } from "@supabase/supabase-js";

// Insert a new versioned script for a concept, computing the next sequential
// version number (max + 1).
//
// `scripts` enforces `unique (concept_id, version)`, so two concurrent inserts
// for the same concept can compute the same version and the second would fail
// the unique constraint (Postgres code 23505). When that happens we re-read the
// max and retry, bounded — so concurrent callers each get a distinct sequential
// version instead of a 500. Any other error is returned to the caller as-is.
//
// Returns the Supabase `{ data, error }` of the insert (the same shape both
// routes already expect).
export async function insertNextScriptVersion(
  client: SupabaseClient,
  conceptId: string,
  fields: Record<string, unknown>,
  maxAttempts = 5,
) {
  let result = await tryInsert(client, conceptId, fields);
  let attempts = 1;
  while (result.error?.code === "23505" && attempts < maxAttempts) {
    result = await tryInsert(client, conceptId, fields);
    attempts++;
  }
  return result;
}

async function tryInsert(
  client: SupabaseClient,
  conceptId: string,
  fields: Record<string, unknown>,
) {
  const { data: latest } = await client
    .from("scripts")
    .select("version")
    .eq("concept_id", conceptId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = ((latest?.version as number | undefined) ?? 0) + 1;

  return client
    .from("scripts")
    .insert({ concept_id: conceptId, version, ...fields })
    .select()
    .single();
}
