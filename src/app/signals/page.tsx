import { redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import OrganicSignalsPanel, { type OrganicSignalRow } from "@/components/OrganicSignalsPanel";

export const dynamic = "force-dynamic";

export default async function SignalsPage() {
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect("/ideas");

  const supabase = await createClient();
  const [{ data: signals }, { data: families }, { data: hookAngles }] = await Promise.all([
    supabase
      .from("organic_signals")
      .select(
        "id, platform, platform_url, creator_handle, format, sport, hook_summary, content_notes, review_status, source, concept_family_id, hook_angle_id, created_at",
      )
      .order("created_at", { ascending: false }),
    supabase.from("concept_families").select("id, name").order("name"),
    supabase.from("hook_angles").select("id, name").order("name"),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Organic Signals</h1>
        <p className="text-sm text-white/50">
          Trending hooks/formats observed organically on social, outside paid
          spend — widens Ideate&apos;s hypothesis pool. Approve a signal here
          before it grounds Ideate.
        </p>
      </header>
      <OrganicSignalsPanel
        signals={(signals ?? []) as OrganicSignalRow[]}
        families={families ?? []}
        hookAngles={hookAngles ?? []}
      />
    </main>
  );
}
