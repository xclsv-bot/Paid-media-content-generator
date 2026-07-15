import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import WeekBoard, {
  type Cycle,
  type Deliverable,
  type Person,
  type Available,
  type Organization,
} from "@/components/WeekBoard";
import { getFamilySlots, type FamilySlot } from "@/lib/loop/slots";

const SLOT_CHIP: Record<FamilySlot["status"], string> = {
  Proven: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  Validating: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  Untested: "border-white/15 bg-white/[0.04] text-white/55",
};

export const dynamic = "force-dynamic";

function famName(f: unknown): string | null {
  if (!f) return null;
  const v = Array.isArray(f) ? f[0] : f;
  return (v as { name?: string })?.name ?? null;
}

export default async function ThisWeekPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string }>;
}) {
  const user = await requireStaff();

  const { cycle: cycleParam } = await searchParams;
  const supabase = await createClient();

  const { data: cyclesData } = await supabase
    .from("cycles")
    .select("id, label, starts_on, ends_on, target_count, status, org_id")
    .order("starts_on", { ascending: false });
  const cycles = (cyclesData ?? []) as Cycle[];

  const selected =
    cycles.find((c) => c.id === cycleParam) ??
    cycles.find((c) => c.status === "Active") ??
    cycles[0] ??
    null;

  let deliverables: Deliverable[] = [];
  let available: Available[] = [];
  let slots: FamilySlot[] = [];

  if (selected) {
    // Portfolio slots for the selected cycle's org: which families are proven
    // (variant them), which are mid-validation, which explore slots are empty.
    slots = (await getFamilySlots(supabase, selected.org_id)).slots;
    const { data: delivData } = await supabase
      .from("deliverables")
      .select(
        "id, concept_id, assignee_id, due_date, production_status, creatives(sheet_id, ad_name, hook_line, hook_angle, concept_families(name))",
      )
      .eq("cycle_id", selected.id)
      // Deterministic board order (bulk-added rows share one created_at, so the
      // id tiebreak matters) — the concept page's prev/next pager sorts the same
      // way so "Next" always means the row below this one.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    const rows = (delivData ?? []) as unknown as Array<{
      id: string;
      concept_id: string;
      assignee_id: string | null;
      due_date: string | null;
      production_status: string;
      creatives: {
        sheet_id: string | null;
        ad_name: string | null;
        hook_line: string | null;
        hook_angle: string | null;
        concept_families: unknown;
      } | null;
    }>;

    // Which concepts already have a video?
    const conceptIds = rows.map((r) => r.concept_id);
    const videoSet = new Set<string>();
    if (conceptIds.length) {
      const { data: vids } = await supabase
        .from("video_assets")
        .select("creative_id")
        .in("creative_id", conceptIds);
      (vids ?? []).forEach((v: { creative_id: string }) => videoSet.add(v.creative_id));
    }

    deliverables = rows.map((r) => ({
      id: r.id,
      concept_id: r.concept_id,
      sheet_id: r.creatives?.sheet_id ?? null,
      ad_name: r.creatives?.ad_name ?? null,
      family: famName(r.creatives?.concept_families),
      hook_line: r.creatives?.hook_line ?? null,
      hook_angle: r.creatives?.hook_angle ?? null,
      assignee_id: r.assignee_id,
      due_date: r.due_date,
      production_status: r.production_status,
      has_video: videoSet.has(r.concept_id),
    }));

    // Concepts not yet in this cycle (for the picker) — scoped to the cycle's
    // own org, so staff can't accidentally schedule another client's concept
    // into this cycle.
    const { data: allConcepts } = await supabase
      .from("creatives")
      .select("id, sheet_id, hook_line, concept_families(name)")
      .eq("org_id", selected.org_id)
      .order("sheet_id", { ascending: true });
    const inCycle = new Set(conceptIds);
    available = ((allConcepts ?? []) as unknown as Array<{
      id: string;
      sheet_id: string | null;
      hook_line: string | null;
      concept_families: unknown;
    }>)
      .filter((c) => !inCycle.has(c.id))
      .map((c) => ({
        id: c.id,
        sheet_id: c.sheet_id,
        hook_line: c.hook_line,
        family: famName(c.concept_families),
      }));
  }

  const { data: peopleData } = await supabase
    .from("users")
    .select("id, name, role")
    .in("role", ["creator", "editor", "admin"]);
  const people = (peopleData ?? []) as Person[];

  const { data: orgsData } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .eq("is_agency", false)
    .order("display_name");
  const organizations = (orgsData ?? []) as Organization[];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">This Week</h1>
        <p className="text-sm text-white/50">
          The active weekly drop — assign creators, set due dates, track production.
        </p>
      </header>

      {slots.length > 0 && selected && (
        <section className="mb-5 rounded-[14px] border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-2.5 flex items-baseline gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wider text-white/45">Portfolio slots</span>
            <span className="text-[11.5px] text-white/40">
              matured, trial-gated verdicts per family — fill the empty slots, variant the proven ones
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {slots.map((s) => {
              const label = `${s.family}${s.judged > 0 ? ` · ${s.hits}/${s.judged} hit` : ""}`;
              return s.status === "Proven" ? (
                <span key={s.family} className={`rounded-full border px-2.5 py-1 text-[12px] ${SLOT_CHIP[s.status]}`} title={s.cpt != null ? `Cohort CPT $${s.cpt.toFixed(2)}` : undefined}>
                  {label} · Proven
                </span>
              ) : (
                <Link
                  key={s.family}
                  // Carry the cycle's org and the slot into Ideate — a bare
                  // /ideate link would open the FIRST org's session, losing
                  // both which client and which family the click meant.
                  href={`/ideate?org=${selected.org_id}&seed=${encodeURIComponent(
                    `Fill the ${s.family} slot (currently ${s.status}) — propose fresh concepts for this family.`,
                  )}`}
                  className={`rounded-full border px-2.5 py-1 text-[12px] hover:border-white/40 ${SLOT_CHIP[s.status]}`}
                  title={`${s.status} — ideate to fill this slot`}
                >
                  {label} · {s.status} →
                </Link>
              );
            })}
          </div>
        </section>
      )}
      <WeekBoard
        cycles={cycles}
        selected={selected}
        deliverables={deliverables}
        people={people}
        available={available}
        organizations={organizations}
      />
    </main>
  );
}
