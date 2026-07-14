import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sourceRef } from "@/lib/loop/sourceRef";

// Winner Breakdowns — structural teardowns of winning content, the layer
// between the golden set (WHAT won, verbatim) and ideation (what to make
// next). Each row decomposes one winner into reusable mechanics: hook device,
// beats, proof, CTA, delivery rationale, the replicable pattern, and what to
// vary next. Rows are written ONLY by refreshBreakdowns
// (src/lib/loop/breakdowns-refresh.ts) on the service-role client; consumers
// read through getWinnerBreakdowns + breakdownsPromptBlock. See
// 0030_winner_breakdowns.sql for the schema and lifecycle.

// The caps live with the rest of the loop thresholds in src/lib/loop/config.ts;
// re-exported here so call sites keep one import.
import { breakdownsMax } from "@/lib/loop/config";
export { breakdownsMax };

// The structured teardown the analyst model emits. Every field is grounded in
// the winner's script/transcript — see BREAKDOWN_SCHEMA in breakdowns-refresh.
export type Breakdown = {
  hook: { device: string; first_three_seconds: string; why_it_works: string };
  beats: { beat: string; purpose: string }[];
  proof_device: string;
  cta: { text: string; placement: string; style: string };
  delivery: { pacing: string; format_rationale: string; talent_rationale: string; theme: string };
  replicable_pattern: string;
  vary_next: string[];
};

export type BreakdownDimensions = {
  family: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  format: string | null;
};

// A winner_breakdowns row as consumers read it.
export type WinnerBreakdown = {
  creative_id: string;
  org_id: string;
  source: "performance" | "editorial";
  status: "active" | "inactive";
  breakdown: Breakdown;
  dimensions: BreakdownDimensions;
  input_hash: string;
  script_version: number | null;
  why_it_won: string | null;
  cpt_cents: number | null;
  results: number | null;
  target_cents: number | null;
  generated_at: string;
};

// What the refresher assembles per winner before planning/generating.
export type BreakdownTarget = {
  creative_id: string;
  org_id: string;
  source: "performance" | "editorial";
  input_hash: string;
  script: string | null;
  script_version: number | null;
  transcript: string | null;
  dims: BreakdownDimensions;
  family: { name: string | null; narrative: string | null; proven_hook_formula: string | null } | null;
  why_it_won: string | null;
  cpt_cents: number | null;
  results: number | null;
  target_cents: number | null;
};

// ---------------------------------------------------------------------------
// Staleness key — sha256 over everything a re-analysis would actually change
// on: the script (and its version), the winning transcript, and the dimension
// snapshot. Metrics (CPT/results) are deliberately EXCLUDED: they drift on
// every refresh and must only update the snapshot columns, never burn a model
// call on an unchanged creative.
export function breakdownInputHash(
  script: string | null,
  scriptVersion: number | null,
  transcript: string | null,
  dims: BreakdownDimensions,
): string {
  const dimKeys = Object.keys(dims).sort() as (keyof BreakdownDimensions)[];
  const dimStr = dimKeys.map((k) => `${k}=${dims[k] ?? ""}`).join("|");
  // Length-prefix each part so field boundaries stay unambiguous — content
  // inside the script can never collide with the joins between fields.
  return createHash("sha256")
    .update([String(scriptVersion ?? ""), script ?? "", transcript ?? "", dimStr].map((p) => `${p.length}:${p}`).join("|"))
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Structural validation of a model response. Returns null on anything
// malformed — the caller counts it as a failure and moves on (never persists
// a partial teardown; the DB CHECK would reject it anyway).
export function parseBreakdown(raw: unknown): Breakdown | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

  const hookRaw = (o.hook ?? {}) as Record<string, unknown>;
  const device = str(hookRaw.device);
  const firstThree = str(hookRaw.first_three_seconds);
  const whyItWorks = str(hookRaw.why_it_works);
  if (!device || !firstThree || !whyItWorks) return null;

  if (!Array.isArray(o.beats)) return null;
  const beats: { beat: string; purpose: string }[] = [];
  for (const b of o.beats) {
    const beat = str((b as Record<string, unknown>)?.beat);
    const purpose = str((b as Record<string, unknown>)?.purpose);
    if (!beat || !purpose) return null;
    beats.push({ beat, purpose });
  }
  if (beats.length === 0) return null;

  const proof = str(o.proof_device);
  const ctaRaw = (o.cta ?? {}) as Record<string, unknown>;
  const ctaText = str(ctaRaw.text);
  const ctaPlacement = str(ctaRaw.placement);
  const ctaStyle = str(ctaRaw.style);
  const dRaw = (o.delivery ?? {}) as Record<string, unknown>;
  const pacing = str(dRaw.pacing);
  const formatRationale = str(dRaw.format_rationale);
  const talentRationale = str(dRaw.talent_rationale);
  const theme = str(dRaw.theme);
  const pattern = str(o.replicable_pattern);
  if (!proof || !ctaText || !ctaPlacement || !ctaStyle || !pacing || !formatRationale || !talentRationale || !theme || !pattern) {
    return null;
  }

  if (!Array.isArray(o.vary_next)) return null;
  const varyNext = o.vary_next.map(str).filter((v): v is string => !!v);
  if (varyNext.length === 0) return null;

  return {
    hook: { device, first_three_seconds: firstThree, why_it_works: whyItWorks },
    beats,
    proof_device: proof,
    cta: { text: ctaText, placement: ctaPlacement, style: ctaStyle },
    delivery: { pacing, format_rationale: formatRationale, talent_rationale: talentRationale, theme },
    replicable_pattern: pattern,
    vary_next: varyNext,
  };
}

// ---------------------------------------------------------------------------
// The refresh planner — pure, unit-tested. Diffs the current winner target set
// against existing rows and buckets the work:
//   generate   — no row yet, or the inputs changed (hash mismatch). The only
//                bucket that costs a model call; capped by maxGenerate, the
//                overflow counted in skippedCap (next run picks it up).
//   reactivate — inactive row whose hash still matches: the winner re-entered
//                with unchanged inputs, so the cached teardown comes back free.
//   retag      — active row, hash match, but the metadata snapshot moved
//                (source flipped performance<->editorial, or metrics drifted).
//   deactivate — active rows whose creative left the winner set (soft — the
//                cached breakdown survives for free re-entry).
export type BreakdownPlan = {
  generate: BreakdownTarget[];
  reactivate: BreakdownTarget[];
  retag: BreakdownTarget[];
  deactivate: string[];
  skippedCap: number;
};

export type ExistingBreakdownRow = {
  creative_id: string;
  input_hash: string;
  status: "active" | "inactive";
  source: "performance" | "editorial";
  why_it_won: string | null;
  cpt_cents: number | null;
  results: number | null;
  target_cents: number | null;
};

export function planBreakdownRefresh(
  targets: BreakdownTarget[],
  existing: ExistingBreakdownRow[],
  maxGenerate: number,
): BreakdownPlan {
  const byId = new Map(existing.map((e) => [e.creative_id, e]));
  const targetIds = new Set(targets.map((t) => t.creative_id));
  const plan: BreakdownPlan = { generate: [], reactivate: [], retag: [], deactivate: [], skippedCap: 0 };

  for (const t of targets) {
    const row = byId.get(t.creative_id);
    if (!row || row.input_hash !== t.input_hash) {
      if (plan.generate.length < maxGenerate) plan.generate.push(t);
      else plan.skippedCap++;
      continue;
    }
    if (row.status === "inactive") {
      plan.reactivate.push(t);
      continue;
    }
    const metaChanged =
      row.source !== t.source ||
      (row.why_it_won ?? null) !== (t.why_it_won ?? null) ||
      (row.cpt_cents ?? null) !== (t.cpt_cents ?? null) ||
      (row.results ?? null) !== (t.results ?? null) ||
      (row.target_cents ?? null) !== (t.target_cents ?? null);
    if (metaChanged) plan.retag.push(t);
  }

  for (const e of existing) {
    if (e.status === "active" && !targetIds.has(e.creative_id)) plan.deactivate.push(e.creative_id);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Read path — org-scoped explicitly (service-role callers bypass RLS; same
// rule as every other loop store). Performance-proven rows lead, editorial
// picks follow ('performance' > 'editorial' happens to sort that way — the
// descending order below is load-bearing).
export const EMPTY_BREAKDOWNS_NOTE =
  "(no winner breakdowns yet — the refresh generates them for golden-set winners and staff-marked Winner concepts)";

export async function getWinnerBreakdowns(
  supabase: SupabaseClient,
  orgId: string,
  limit: number,
): Promise<{ breakdowns: WinnerBreakdown[]; error: string | null }> {
  const { data, error } = await supabase
    .from("winner_breakdowns")
    .select(
      "creative_id, org_id, source, status, breakdown, dimensions, input_hash, script_version, why_it_won, cpt_cents, results, target_cents, generated_at",
    )
    .eq("org_id", orgId)
    .eq("status", "active")
    .order("source", { ascending: false })
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (error) return { breakdowns: [], error: error.message };
  return { breakdowns: (data ?? []) as unknown as WinnerBreakdown[], error: null };
}

// ---------------------------------------------------------------------------
// Prompt rendering. Performance rows cite [golden:<id>] so a learnings
// directive citing the same ref resolves to both the raw golden script and its
// teardown in one prompt; editorial rows cite [winner:<id>] and carry an
// explicit "not performance-proven" disclaimer so the model weighs them below
// the CPT-proven rows.
const cap = (v: string | null | undefined, n: number) => (v ?? "").slice(0, n);

export function breakdownLine(b: WinnerBreakdown): string {
  const d = b.dimensions ?? ({} as BreakdownDimensions);
  const ref = sourceRef(b.source === "performance" ? "golden" : "winner", b.creative_id);
  const evidence =
    b.source === "performance"
      ? b.cpt_cents != null && b.target_cents != null
        ? `performance-proven: CPT $${(b.cpt_cents / 100).toFixed(2)} vs $${(b.target_cents / 100).toFixed(2)} target${b.results != null ? ` (${b.results} trials)` : ""}`
        : "performance-proven"
      : "EDITORIAL pick by staff — no gated performance data; weigh below the CPT-proven rows";
  const bd = b.breakdown;
  const beats = bd.beats.map((x) => `${cap(x.beat, 120)} (${cap(x.purpose, 80)})`).join(" → ");
  return [
    `• [${ref}] "${d.hook_line ?? "?"}" — ${d.family ?? "?"} / ${d.hook_angle ?? "?"} / ${d.sport ?? "?"} · ${evidence}`,
    `  Hook: ${cap(bd.hook.device, 120)} — first 3s: ${cap(bd.hook.first_three_seconds, 160)} (why: ${cap(bd.hook.why_it_works, 160)})`,
    `  Beats: ${beats}`,
    `  Proof: ${cap(bd.proof_device, 160)} · CTA: "${cap(bd.cta.text, 100)}" (${cap(bd.cta.placement, 60)}, ${cap(bd.cta.style, 60)})`,
    `  Delivery: ${cap(bd.delivery.pacing, 100)} · ${cap(bd.delivery.format_rationale, 120)} · ${cap(bd.delivery.talent_rationale, 120)} · ${cap(bd.delivery.theme, 60)}`,
    `  Replicable pattern: ${cap(bd.replicable_pattern, 300)}`,
    `  Vary next: ${bd.vary_next.map((v) => cap(v, 100)).join("; ")}`,
  ].join("\n");
}

export function breakdownsPromptBlock(result: { breakdowns: WinnerBreakdown[]; error: string | null }): string {
  if (result.error) return `(winner breakdowns unavailable: ${result.error})`;
  if (result.breakdowns.length === 0) return EMPTY_BREAKDOWNS_NOTE;
  return `WINNER BREAKDOWNS (structural teardowns of what won — build NEW concepts from these patterns and the "vary next" leads; never restate the original):\n${result.breakdowns.map(breakdownLine).join("\n")}`;
}
