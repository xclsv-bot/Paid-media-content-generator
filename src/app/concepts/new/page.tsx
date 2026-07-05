import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth";
import ConceptForm from "@/components/ConceptForm";

export const dynamic = "force-dynamic";

export default async function NewConceptPage() {
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect("/ideas");

  return (
    <main className="mx-auto max-w-2xl p-6">
      <Link href="/ideas" className="text-sm text-white/50 hover:underline">← Ideas</Link>
      <h1 className="mt-3 mb-1 text-[27px] font-semibold tracking-tight">New concept</h1>
      <p className="mb-6 text-sm text-white/55">Describe the test. You can refine the script and add references after it's created.</p>
      <ConceptForm />
    </main>
  );
}
