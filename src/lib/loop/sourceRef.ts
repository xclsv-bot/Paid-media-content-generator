// The ONE definition of a learnings source ref — the `<kind>:<key>` token a
// recommendation stores in its `sources`, the analyst is told to cite, and a
// reader traces back to a row. Every write site (scoreboard candidate ids), read
// site (validator, prompt block, UI), and cross-reference (Ideate/reviewer
// example labels) goes through here so the format cannot drift — an earlier
// drift (prompt said `golden:x`, validator keyed on bare `x`) silently dropped
// every recommendation. No imports: pure + safe for client components.

export const SOURCE_KINDS = ["golden", "loser", "rejection", "explore", "validating"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

// Build a self-describing ref. Creative-kind refs (golden/loser/rejection) take a
// creative_id; slot-kind refs (explore/validating) take a concept-family name.
export function sourceRef(kind: SourceKind, key: string): string {
  return `${kind}:${key}`;
}

export type SourceRef = { kind: SourceKind; key: string; raw: string };

// Split a stored ref back into its kind + key. Returns null for anything that
// isn't a known `<kind>:<key>` token (legacy bare strings, malformed input).
// Splits on the FIRST colon only — family names may themselves contain colons.
export function parseSourceRef(ref: string): SourceRef | null {
  const idx = ref.indexOf(":");
  if (idx <= 0) return null;
  const kind = ref.slice(0, idx) as SourceKind;
  const key = ref.slice(idx + 1);
  if (!key || !(SOURCE_KINDS as readonly string[]).includes(kind)) return null;
  return { kind, key, raw: ref };
}

// Durability contract: the DURABLE retrieval target is not the golden/bad
// example store (those are rebuilt daily by /api/winners/refresh and are
// prunable/curator-removable) but the immutable rows a ref's key points at —
// a creative_id in `creatives`, or a family name in `concept_families`. The
// rec's own `metric` snapshot is the durable evidence of what that row showed at
// write time, so a directive stays traceable even after its golden row is pruned.
export function sourceRefTable(kind: SourceKind): "creatives" | "concept_families" {
  return kind === "explore" || kind === "validating" ? "concept_families" : "creatives";
}

// Short human label for the ref's kind (UI chips).
export const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  golden: "winner",
  loser: "loser",
  rejection: "rejected",
  explore: "slot",
  validating: "validating",
};
