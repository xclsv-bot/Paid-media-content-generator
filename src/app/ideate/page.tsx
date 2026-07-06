import { redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import IdeateWorkspace from "@/components/IdeateWorkspace";

export const dynamic = "force-dynamic";

export default async function IdeatePage() {
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect("/ideas");

  const supabase = await createClient();
  const { data: organizations } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .eq("is_agency", false)
    .order("display_name");

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <h1 className="text-[27px] font-semibold tracking-tight">Ideate</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-white/55">
          Brainstorm with the agent using call transcripts, references, and performance signals — then push concepts straight into the bank.
        </p>
      </header>
      <IdeateWorkspace organizations={organizations ?? []} />
    </main>
  );
}
