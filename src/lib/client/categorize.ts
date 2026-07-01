// ────────────────────────────────────────────────────────────────────────────
// Content categorization for the client library.
//
// The client gave (will give) us a naming convention for their asset files/ad
// names. Until that lands, we categorize off the structured fields we already
// hold on each creative (family, angle, format, sport, archetype). When the
// convention arrives, fill in `parseNamingConvention()` — it's the ONLY place
// that needs to change; the rest of the library reads `categorize()`.
// ────────────────────────────────────────────────────────────────────────────

export type Facets = {
  family: string | null;
  angle: string | null;
  format: string | null;
  sport: string | null;
  archetype: string | null;
};

// The dimensions the library filter bar exposes, in display order.
export const FACET_KEYS = ["family", "angle", "format", "sport", "archetype"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export const FACET_LABELS: Record<FacetKey, string> = {
  family: "Concept",
  angle: "Angle",
  format: "Format",
  sport: "Sport",
  archetype: "Audience",
};

// Raw shape we categorize from — the joined creative row (+ optional file name).
export type Categorizable = {
  concept_family?: string | null;
  hook_angle?: string | null;
  format?: string | null;
  sport?: string | null;
  archetype?: string | null;
  ad_name?: string | null;
  file_name?: string | null;
};

// Placeholder for the client's file/ad naming convention. Returns whatever
// facets the encoded name reveals; today it's a no-op (nothing encoded yet).
// Example future convention: "PARLAY_UNDERDOG_NBA_UGC_v3" → tokens by "_".
export function parseNamingConvention(_name: string | null | undefined): Partial<Facets> {
  return {};
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

// Resolve a creative's facets: the encoded name (once we parse it) wins, then
// we fall back to the structured DB fields.
export function categorize(c: Categorizable): Facets {
  const fromName = parseNamingConvention(c.ad_name ?? c.file_name);
  return {
    family: clean(fromName.family) ?? clean(c.concept_family),
    angle: clean(fromName.angle) ?? clean(c.hook_angle),
    format: clean(fromName.format) ?? clean(c.format),
    sport: clean(fromName.sport) ?? clean(c.sport),
    archetype: clean(fromName.archetype) ?? clean(c.archetype),
  };
}

// Distinct, sorted values for one facet across a set of items — powers the
// filter chips. "—" (uncategorized) sorts last.
export function facetValues(items: Facets[], key: FacetKey): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const v = it[key];
    if (v) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}
