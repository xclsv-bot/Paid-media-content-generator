import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import IdeasList, { type IdeaRow } from "@/components/IdeasList";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  sheet_id: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  idea_status: string;
  is_proven: boolean;
  concept_families: { name: string } | { name: string }[] | null;
};

export default async function IdeasPage() {
  const user = await getCurrentUser();
  if (user?.role === "creator") redirect("/queue");

  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select(
      "id, sheet_id, hook_line, hook_angle, archetype, sport, idea_status, is_proven, concept_families(name)",
    )
    .order("sheet_id", { ascending: true });

  const rows: IdeaRow[] = ((data ?? []) as unknown as Row[]).map((r) => {
    const f = r.concept_families;
    const family = !f ? null : Array.isArray(f) ? f[0]?.name ?? null : f.name;
    return {
      id: r.id,
      sheet_id: r.sheet_id,
      family,
      hook_line: r.hook_line,
      hook_angle: r.hook_angle,
      archetype: r.archetype,
      sport: r.sport,
      idea_status: r.idea_status,
      is_proven: r.is_proven,
    };
  });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Ideas</h1>
        <p className="text-sm text-white/50">
          The concept bank — test, triage, and promote into a weekly drop.
        </p>
      </header>
      <IdeasList rows={rows} />
    </main>
  );
}
