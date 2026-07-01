import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import MetaImporter from "@/components/MetaImporter";
import MetaSync from "@/components/MetaSync";

export const dynamic = "force-dynamic";

type CreativePick = {
  id: string;
  sheet_id: string | null;
  hook_line: string | null;
  ad_name: string | null;
  concept_families: { name: string } | { name: string }[] | null;
};

export default async function ImportPage() {
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect("/ideas");

  const supabase = await createClient();
  const { data } = await supabase
    .from("creatives")
    .select("id, sheet_id, hook_line, ad_name, concept_families(name)")
    .order("sheet_id", { ascending: true });

  const creatives = ((data ?? []) as unknown as CreativePick[]).map((c) => {
    const f = c.concept_families;
    const fam = !f ? "" : Array.isArray(f) ? f[0]?.name ?? "" : f.name;
    return {
      id: c.id,
      adName: c.ad_name,
      label: `#${c.sheet_id} · ${fam} · ${c.hook_line ?? ""}`.slice(0, 80),
    };
  });

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/performance" className="text-sm text-white/50 hover:underline">
        ← Performance
      </Link>
      <h1 className="mt-1 mb-2 text-2xl font-semibold">Meta performance</h1>
      <p className="mb-6 text-sm text-white/50">
        Pull performance from the Meta Marketing API, or drop an Ads Manager CSV. Rows join
        to creatives by ad name; anything that doesn&apos;t match is listed so you can link it.
      </p>
      <div className="mb-6">
        <MetaSync />
      </div>
      <MetaImporter creatives={creatives} />
    </main>
  );
}
