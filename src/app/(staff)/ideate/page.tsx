import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import IdeateWorkspace from "@/components/IdeateWorkspace";

export const dynamic = "force-dynamic";

export default async function IdeatePage() {
  await requireStaff();

  const supabase = await createClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .eq("is_agency", false)
    .order("display_name");

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Ideate</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/55">
          Brainstorm with the agent using call transcripts, references, and performance signals — then push concepts straight into the bank.
        </p>
      </header>
      {(organizations ?? []).length === 0 ? (
        // Without a client org the workspace's Send can only no-op (every
        // concept/learning/winner is org-scoped) — explain instead of render.
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center text-white/50">
          <p>No client organizations yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-white/40">
            Ideate brainstorms per client — every concept, learning, and winner is scoped to a
            client org. Client orgs are provisioned by an admin (there&apos;s no in-app creation
            yet); once one exists, this workspace unlocks.
          </p>
        </div>
      ) : (
        <IdeateWorkspace organizations={organizations ?? []} />
      )}
    </main>
  );
}
