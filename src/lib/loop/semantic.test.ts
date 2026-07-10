import { describe, it, expect, vi } from "vitest";

// Mock only the embedding I/O; keep the real cosine + threshold. embed() maps a
// few known texts to hand-picked vectors so the orchestration's decision
// (catch a paraphrase, admit a distinct hook) is deterministic and offline.
const VECTORS: Record<string, number[]> = {
  "Stop guessing your parlays": [1, 0, 0],
  "Quit playing your slips blind": [0.97, 0.24, 0], // ~0.97 cosine → paraphrase
  "Meet the creators behind the community": [0, 1, 0], // orthogonal → distinct
};
vi.mock("@/lib/embeddings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/embeddings")>();
  return {
    ...actual, // real cosine + semanticDupThreshold (0.9)
    embeddingsEnabled: () => true,
    embed: async (t: string) => VECTORS[t.trim()] ?? null,
  };
});

import { findSemanticDuplicateHook } from "./semantic";
import type { GoldenExample } from "./golden";

// Supabase stub: the lazy-cache write is best-effort; just let it resolve.
const supa = { from: () => ({ update: () => ({ eq: async () => ({}) }) }) } as never;

function golden(hook: string): GoldenExample {
  return {
    creative_id: "c-1", org_id: "o-1", script: "s", script_version: 1, why_it_won: "w",
    dimensions: { family: null, hook_line: hook, hook_angle: null, archetype: null, sport: null, format: null },
    source: "auto", status: "active", transcript: null, embedding: null, embedding_of: null,
    score: 1, cpt_cents: 2000, results: 40, target_cents: 3000, captured_at: "2026-07-01T00:00:00Z",
  };
}

describe("findSemanticDuplicateHook", () => {
  const goldenSet = [golden("Stop guessing your parlays")];

  it("catches a reworded paraphrase the lexical gate would miss", async () => {
    expect(await findSemanticDuplicateHook(supa, "Quit playing your slips blind", goldenSet))
      .toBe("Stop guessing your parlays");
  });

  it("admits a semantically distinct hook", async () => {
    expect(await findSemanticDuplicateHook(supa, "Meet the creators behind the community", goldenSet))
      .toBeNull();
  });

  it("returns null for an empty candidate or empty golden set", async () => {
    expect(await findSemanticDuplicateHook(supa, "", goldenSet)).toBeNull();
    expect(await findSemanticDuplicateHook(supa, "Stop guessing your parlays", [])).toBeNull();
  });
});
