// ────────────────────────────────────────────────────────────────────────────
// Content categorization for the client library.
//
// The client's Meta ad/file naming convention is a ` _ `-delimited taxonomy:
//   Brand _ Advertiser _ Sport _ Format _ Talent _ Theme _ Date
//   e.g. "XCLSV _ XCLSV _ MLB _ Video _ NoFace _ Information _ 6.25.26"
// `parseNamingConvention()` decodes it into facets; `categorize()` layers those
// over the structured DB fields (name wins where present). This is the ONLY
// place that needs to change if the convention evolves.
// ────────────────────────────────────────────────────────────────────────────

export type Facets = {
  family: string | null;
  angle: string | null;
  theme: string | null; // from the naming convention (Information / Winning / …)
  sport: string | null;
  format: string | null;
  talent: string | null; // Face / NoFace
  archetype: string | null;
};

// The dimensions the library filter bar exposes, in display order.
export const FACET_KEYS = ["family", "angle", "theme", "sport", "format", "talent", "archetype"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

export const FACET_LABELS: Record<FacetKey, string> = {
  family: "Concept",
  angle: "Angle",
  theme: "Theme",
  sport: "Sport",
  format: "Format",
  talent: "Talent",
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

// What the encoded name can reveal (a subset of Facets).
type NamedFacets = Partial<Pick<Facets, "sport" | "format" | "talent" | "theme">>;

// Decode the ` _ `-delimited convention. Tokens by position (0-indexed):
//   0 Brand · 1 Advertiser · 2 Sport · 3 Format · 4 Talent · 5 Theme · 6 Date
// Date is optional (some cuts omit it), so we key off the fixed left tokens.
export function parseNamingConvention(name: string | null | undefined): NamedFacets {
  if (!name) return {};
  const parts = name.split(/\s*_\s*/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 6) return {}; // not enough tokens to trust the encoding
  const [, , sport, format, talent, theme] = parts;
  return { sport, format, talent, theme };
}

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

// Resolve a creative's facets: the encoded name wins for the dimensions it
// carries (sport/format/talent/theme); the structured DB fields fill the rest
// and back up any token the name doesn't encode.
export function categorize(c: Categorizable): Facets {
  const n = parseNamingConvention(c.ad_name ?? c.file_name);
  return {
    family: clean(c.concept_family),
    angle: clean(c.hook_angle),
    theme: clean(n.theme),
    sport: clean(n.sport) ?? clean(c.sport),
    format: clean(n.format) ?? clean(c.format),
    talent: clean(n.talent),
    archetype: clean(c.archetype),
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

// ---------------------------------------------------------------------------
// Encoder — the single source of truth for building a convention ad name.
// The name is the join key between concepts and the weekly report, so every
// surface that mints one (ConceptForm, Ideate) MUST go through this. Date
// token matches the slate's existing names: M.D.YY (e.g. "7.8.26").
// ---------------------------------------------------------------------------
export function adNameDateToken(d: Date = new Date()): string {
  return `${d.getMonth() + 1}.${d.getDate()}.${String(d.getFullYear()).slice(2)}`;
}

export function composeAdName(parts: {
  sport?: string | null;
  format?: string | null;
  talent?: string | null;
  theme?: string | null;
  date?: string | null;
}): string {
  return [
    "XCLSV",
    "XCLSV",
    (parts.sport ?? "").trim() || "All",
    (parts.format ?? "").trim() || "Video",
    (parts.talent ?? "").trim() || "NoFace",
    (parts.theme ?? "").trim() || "Information",
    (parts.date ?? "").trim() || adNameDateToken(),
  ].join(" _ ");
}
