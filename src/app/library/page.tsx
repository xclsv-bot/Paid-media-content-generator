import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CreativeRow = {
  id: string;
  sheet_id: string | null;
  content_summary: string | null;
  hook_line: string | null;
  archetype: string | null;
  sport: string | null;
  format: string | null;
  status: string;
  is_proven: boolean;
  concept_families: { name: string } | null;
};

export default async function LibraryPage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  // RLS scopes this automatically: staff see all, clients see only their org.
  const { data } = await supabase
    .from("creatives")
    .select(
      "id, sheet_id, content_summary, hook_line, archetype, sport, format, status, is_proven, concept_families(name)",
    )
    .order("sheet_id", { ascending: true });

  const creatives = (data ?? []) as unknown as CreativeRow[];

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Content Slate</h1>
          <p className="text-sm text-white/50">
            {creatives.length} creatives
            {user ? ` · ${user.name ?? user.email} (${user.role})` : ""}
          </p>
        </div>
        <Link
          href="/performance"
          className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          Performance →
        </Link>
      </header>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Family</th>
              <th className="px-3 py-2">Hook</th>
              <th className="px-3 py-2">Archetype</th>
              <th className="px-3 py-2">Sport</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {creatives.map((c) => (
              <tr key={c.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-3 py-2 text-white/50">{c.sheet_id}</td>
                <td className="px-3 py-2">
                  {c.concept_families?.name}
                  {c.is_proven && <span className="ml-1 text-emerald-400">✓</span>}
                </td>
                <td className="max-w-xs truncate px-3 py-2">{c.hook_line}</td>
                <td className="px-3 py-2 text-white/70">{c.archetype}</td>
                <td className="px-3 py-2 text-white/70">{c.sport}</td>
                <td className="px-3 py-2 text-white/70">{c.status}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/creatives/${c.id}`}
                    className="text-emerald-400 hover:underline"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isStaff(user) && (
        <p className="mt-4 text-xs text-white/40">
          Signed in as XCLSV staff — you can upload videos on each creative.
        </p>
      )}
    </main>
  );
}
