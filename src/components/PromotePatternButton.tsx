"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Opens a form pre-filled ONLY with the source org — title/summary/why start
// blank on purpose, forcing the staff member to read the learnings narrative
// and write the client-neutral abstraction themselves (the actual judgment
// step this feature enforces; see docs on cross_client_patterns).
export default function PromotePatternButton({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !summary.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cross-client-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, generalized_summary: summary, why_it_works: why || null, source_org_id: orgId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setOpen(false);
      setTitle(""); setSummary(""); setWhy("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">
        Promote to cross-client pattern
      </button>
    );
  }

  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-2 text-sm font-medium">New cross-client pattern (draft)</h3>
      <p className="mb-2 text-xs text-white/45">
        Write the abstraction yourself — no client name, dollar figures, or script excerpts.
      </p>
      <input value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="Title" className="mb-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
      <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
        placeholder="Generalized summary" rows={2}
        className="mb-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
      <textarea value={why} onChange={(e) => setWhy(e.target.value)}
        placeholder="Why it works (optional)" rows={2}
        className="mb-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy}
          className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50">
          Save as draft
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-white/50">Cancel</button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
