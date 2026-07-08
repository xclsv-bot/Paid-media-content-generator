import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultTargetCents, rollupBy, type CreativePerf } from "@/lib/metrics/perf";
import { isMature, minTrials, slotStatus, type SlotStatus } from "@/lib/loop/attribution";

// Portfolio slots — every concept family for an org, labeled by what its
// matured performance has proven (see docs/LEARNING_LOOP.md, "portfolio of
// proven, diverse formats"):
//   Proven     — exploit: keep producing variants
//   Validating — has matured, trial-gated data but hasn't cleared the bar yet
//   Untested   — no matured cohort at all: the explore slots to fill
// Consumed by the This Week slot strip so the weekly planning conversation is
// "which slots need filling", grounded in the same gated math as learnings.

export type FamilySlot = {
  family: string;
  status: SlotStatus;
  judged: number; // matured, trial-gated creatives we could judge
  hits: number; // of those, how many beat their CPT target
  cpt: number | null; // ratio-of-sums CPT across the matured cohort (dollars)
};

type PerfRow = CreativePerf & { first_date: string | null };
type Dim = { family: string | null; targetCents: number | null };

const STATUS_ORDER: Record<SlotStatus, number> = { Proven: 0, Validating: 1, Untested: 2 };

// Pure and unit-tested: matured + trial-gated rows roll up per family
// (ratio-of-sums, same math as the learnings scoreboard), then every family —
// including ones with zero matured data — gets a slot verdict.
export function computeFamilySlots(
  familyNames: string[],
  perf: PerfRow[],
  dimById: Map<string, Dim>,
  now: Date,
): FamilySlot[] {
  const bar = minTrials();
  const fallback = defaultTargetCents();
  const matured = perf.filter((p) => isMature(p.first_date, now) && Number(p.results ?? 0) >= bar);
  const rollups = rollupBy(
    matured.map((p) => ({ ...p, dimension: dimById.get(p.creative_id)?.family ?? null })),
    (id) => dimById.get(id)?.targetCents ?? fallback,
  );
  const byFamily = new Map(rollups.map((r) => [r.key, r]));
  return familyNames
    .map((family) => {
      const r = byFamily.get(family);
      return {
        family,
        status: slotStatus(r),
        judged: r?.judged ?? 0,
        hits: r?.hits ?? 0,
        cpt: r?.cpt ?? null,
      };
    })
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.family.localeCompare(b.family));
}

// The org's slot board. orgId filters every query explicitly (same rule as the
// other loop reads: don't lean on RLS — service-role callers bypass it).
export async function getFamilySlots(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ slots: FamilySlot[]; error: string | null }> {
  const [famRes, perfRes, dimRes] = await Promise.all([
    supabase.from("concept_families").select("name").eq("org_id", orgId).order("name"),
    supabase
      .from("creative_performance")
      .select("creative_id, spend, impressions, clicks, results, ctr, cpt, last_updated, first_date")
      .eq("org_id", orgId),
    supabase
      .from("creatives")
      .select("id, cpt_target_cents, concept_families(name)")
      .eq("org_id", orgId),
  ]);
  const error = famRes.error ?? perfRes.error ?? dimRes.error;
  if (error) return { slots: [], error: error.message };

  const dimById = new Map<string, Dim>();
  for (const c of (dimRes.data ?? []) as unknown as Array<{
    id: string;
    cpt_target_cents: number | null;
    concept_families: { name: string } | { name: string }[] | null;
  }>) {
    const famRaw = c.concept_families;
    const family = !famRaw ? null : Array.isArray(famRaw) ? famRaw[0]?.name ?? null : famRaw.name;
    dimById.set(c.id, { family, targetCents: c.cpt_target_cents });
  }

  return {
    slots: computeFamilySlots(
      ((famRes.data ?? []) as { name: string }[]).map((f) => f.name),
      (perfRes.data ?? []) as unknown as PerfRow[],
      dimById,
      new Date(),
    ),
    error: null,
  };
}
