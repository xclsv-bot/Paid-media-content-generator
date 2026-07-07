import { redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import CrossClientPatternsPanel, { type PatternRow } from "@/components/CrossClientPatternsPanel";

export const dynamic = "force-dynamic";

export default async function PatternsPage() {
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect("/ideas");

  const supabase = await createClient();
  const [{ data: patterns }, { data: organizations }] = await Promise.all([
    supabase.from("cross_client_patterns").select("*").order("created_at", { ascending: false }),
    supabase.from("organizations").select("id, slug, display_name").order("display_name"),
  ]);

  return (
    <main className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Cross-Client Patterns</h1>
        <p className="text-sm text-white/50">
          Staff-abstracted, generalized patterns that transfer across clients —
          client-neutral by construction. Never shown to clients or creators.
          Publish a pattern to make it available as a hypothesis source in
          every account&apos;s Ideate sessions.
        </p>
      </header>
      <CrossClientPatternsPanel
        patterns={(patterns ?? []) as PatternRow[]}
        organizations={organizations ?? []}
      />
    </main>
  );
}
