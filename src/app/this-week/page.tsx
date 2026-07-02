import { redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import WeekBoard, {
  type Cycle,
  type Deliverable,
  type Person,
  type Available,
} from "@/components/WeekBoard";

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
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect("/ideas");

  const { cycle: cycleParam } = await searchParams;
  const supabase = await createClient();

  const { data: cyclesData } = await supabase
    .from("cycles")
    .select("id, label, starts_on, ends_on, target_count, status")
    .order("starts_on", { ascending: false });
  const cycles = (cyclesData ?? []) as Cycle[];

  const selected =
    cycles.find((c) => c.id === cycleParam) ??
    cycles.find((c) => c.status === "Active") ??
    cycles[0] ??
    null;

  let deliverables: Deliverable[] = [];
  let available: Available[] = [];

  if (selected) {
    const { data: delivData } = await supabase
      .from("deliverables")
      .select(
        "id, concept_id, assignee_id, due_date, production_status, creatives(sheet_id, ad_name, hook_line, hook_angle, concept_families(name))",
      )
      .eq("cycle_id", selected.id);

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

    // Concepts not yet in this cycle (for the picker).
    const { data: allConcepts } = await supabase
      .from("creatives")
      .select("id, sheet_id, hook_line, concept_families(name)")
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

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">This Week</h1>
        <p className="text-sm text-white/50">
          The active weekly drop — assign creators, set due dates, track production.
        </p>
      </header>
      <WeekBoard
        cycles={cycles}
        selected={selected}
        deliverables={deliverables}
        people={people}
        available={available}
      />
    </main>
  );
}
