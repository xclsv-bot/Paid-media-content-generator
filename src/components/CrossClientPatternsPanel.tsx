"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type PatternRow = {
  id: string;
  title: string;
  pattern_type: string;
  generalized_summary: string;
  why_it_works: string | null;
  applicable_archetype: string | null;
  applicable_vertical: string | null;
  source_org_id: string | null;
  status: string;
  created_at: string;
};

type Option = { id: string; slug: string; display_name: string };

const STATUSES = ["draft", "published", "archived"];

export default function CrossClientPatternsPanel({
  patterns,
  organizations,
}: {
  patterns: PatternRow[];
  organizations: Option[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [patternType, setPatternType] = useState("hook");
  const [summary, setSummary] = useState("");
  const [why, setWhy] = useState("");
  const [vertical, setVertical] = useState("");
  const [sourceOrgId, setSourceOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addPattern() {
    if (!title.trim() || !summary.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cross-client-patterns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          pattern_type: patternType,
          generalized_summary: summary,
          why_it_works: why || null,
          applicable_vertical: vertical || null,
          source_org_id: sourceOrgId || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setTitle(""); setSummary(""); setWhy(""); setVertical(""); setSourceOrgId("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/cross-client-patterns/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    router.refresh();
  }

  const orgName = (id: string | null) => organizations.find((o) => o.id === id)?.display_name ?? "—";

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-lg font-medium">Add pattern</h2>
        <p className="mb-2 text-xs text-white/45">
          Write the abstraction yourself — no client name, dollar figures, or
          script excerpts. The source account is for internal audit only and is
          never shown in Ideate grounding.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (e.g. Loss-aversion parlay hook)"
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
          <select value={patternType} onChange={(e) => setPatternType(e.target.value)}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm">
            <option value="hook">hook</option>
            <option value="family_archetype">family_archetype</option>
            <option value="cta">cta</option>
            <option value="structure">structure</option>
          </select>
          <input value={vertical} onChange={(e) => setVertical(e.target.value)}
            placeholder="Applicable vertical (e.g. sports betting / fantasy apps)"
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
          <select value={sourceOrgId} onChange={(e) => setSourceOrgId(e.target.value)}
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm">
            <option value="">Source account (internal only)</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.display_name}</option>
            ))}
          </select>
        </div>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
          placeholder="Generalized summary — the abstracted, client-neutral insight"
          className="mt-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" rows={2} />
        <textarea value={why} onChange={(e) => setWhy(e.target.value)}
          placeholder="Why it works (optional)"
          className="mt-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" rows={2} />
        <button onClick={addPattern} disabled={busy}
          className="mt-2 rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-50">
          Save as draft
        </button>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-lg font-medium">Patterns ({patterns.length})</h2>
        {patterns.length === 0 ? (
          <p className="text-sm text-white/40">No patterns yet.</p>
        ) : (
          <div className="space-y-2">
            {patterns.map((p) => (
              <div key={p.id} className="rounded-lg border border-white/10 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-white/40">
                    {p.pattern_type} · from {orgName(p.source_org_id)}
                  </span>
                  <select
                    value={p.status}
                    onChange={(e) => setStatus(p.id, e.target.value)}
                    className="ml-auto rounded border border-white/10 bg-black/30 px-2 py-0.5 text-xs"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 font-medium">{p.title}</p>
                <p className="mt-1 text-white/70">{p.generalized_summary}</p>
                {p.why_it_works && <p className="mt-1 text-white/50">Why: {p.why_it_works}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
