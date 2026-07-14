import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import IdeateWorkspace from "@/components/IdeateWorkspace";

export const dynamic = "force-dynamic";

// Accepts ?org=<id|slug> and ?seed=<text> so other surfaces can open ideation
// with the right client preselected and a starter prompt in the composer —
// e.g. This Week's slot chips ("fill the Data Edge slot") and the Winners
// page's "Ideate from this winner" links.
export default async function IdeatePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; seed?: string }>;
}) {
  await requireStaff();
  const { org, seed } = await searchParams;

  const supabase = await createClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .eq("is_agency", false)
    .order("display_name");

  const orgs = organizations ?? [];
  const initialOrgId = org ? orgs.find((o) => o.id === org || o.slug === org)?.id : undefined;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ideate</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/55">
          Brainstorm with the agent using call transcripts, references, and performance signals — then push concepts straight into the bank.
        </p>
      </header>
      <IdeateWorkspace organizations={orgs} initialOrgId={initialOrgId} initialSeed={seed} />
    </main>
  );
}
