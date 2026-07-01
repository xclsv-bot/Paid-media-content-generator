"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Script = {
  id: string;
  body: string;
  source: "ai" | "human";
  status: "draft" | "approved";
  version: number;
  model: string | null;
  created_at: string;
};

export type Review = {
  id: string;
  script_id: string;
  scores: { hook: number; angle_fit: number; compliance: number; structure: number; clarity: number };
  overall: number;
  verdict: "pass" | "revise";
  weaknesses: string[] | null;
  suggestions: string[] | null;
  compliance_flags: string[] | null;
};

const CRITERIA: { key: keyof Review["scores"]; label: string }[] = [
  { key: "hook", label: "Hook" },
  { key: "angle_fit", label: "Angle" },
  { key: "compliance", label: "Compliance" },
  { key: "structure", label: "Structure" },
  { key: "clarity", label: "Clarity" },
];

export default function ScriptPanel({
  conceptId,
  scripts,
  scriptDocUrl,
  canEdit,
  latestReview = null,
}: {
  conceptId: string;
  scripts: Script[];
  scriptDocUrl: string | null;
  canEdit: boolean;
  latestReview?: Review | null;
}) {
  const router = useRouter();
  const latest = scripts[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latest?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [review, setReview] = useState<Review | null>(latestReview);
  const [status, setStatus] = useState<string | null>(null);

  // A review only applies to the version it scored.
  const currentReview = review && latest && review.script_id === latest.id ? review : null;

  async function runReview() {
    if (!latest) return;
    setBusy(true);
    setStatus("Reviewing…");
    try {
      const res = await fetch(`/api/scripts/${latest.id}/review`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setReview(json.review);
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function runRevise() {
    if (!latest) return;
    setBusy(true);
    setStatus("Writing an improved draft…");
    try {
      const res = await fetch(`/api/scripts/${latest.id}/revise`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setStatus(null);
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Revision failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(approve: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/concepts/${conceptId}/scripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft, approve }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function approveLatest() {
    if (!latest) return;
    setBusy(true);
    try {
      await fetch(`/api/scripts/${latest.id}/approve`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-medium">Script</h2>
        {latest && (
          <>
            <Badge className="bg-white/10 text-white/60">v{latest.version}</Badge>
            <Badge className={latest.source === "ai" ? "bg-violet-500/20 text-violet-300" : "bg-white/10 text-white/60"}>
              {latest.source === "ai" ? "✨ AI" : "human"}
            </Badge>
            <Badge className={latest.status === "approved" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}>
              {latest.status}
            </Badge>
          </>
        )}
        {scriptDocUrl && (
          <a href={scriptDocUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-sky-300 hover:underline">
            Google Doc ↗
          </a>
        )}
      </div>

      {!latest && !editing && (
        <p className="text-sm text-white/40">
          No script yet — the agent posts drafts here, or write one manually.
        </p>
      )}

      {latest && !editing && (
        <pre className="whitespace-pre-wrap font-sans text-sm text-white/80">{latest.body}</pre>
      )}

      {editing && (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-white/10 bg-black/30 p-3 text-sm"
        />
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          {!editing ? (
            <>
              <button onClick={() => { setDraft(latest?.body ?? ""); setEditing(true); }}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">
                {latest ? "Edit" : "Write script"}
              </button>
              {latest && (
                <button onClick={runReview} disabled={busy}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50">
                  Review
                </button>
              )}
              {latest && (
                <button onClick={runRevise} disabled={busy}
                  className="rounded-lg border border-violet-400/30 px-3 py-1.5 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50">
                  ✨ Revise with AI
                </button>
              )}
              {latest && latest.status === "draft" && (
                <button onClick={approveLatest} disabled={busy}
                  className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50">
                  Approve v{latest.version}
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={() => save(false)} disabled={busy || !draft.trim()}
                className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50">
                Save draft
              </button>
              <button onClick={() => save(true)} disabled={busy || !draft.trim()}
                className="rounded-lg bg-emerald-500/90 px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50">
                Save & approve
              </button>
              <button onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-white/50 hover:bg-white/10">
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {status && <p className="mt-2 text-xs text-white/50">{status}</p>}

      {currentReview && (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-white/50">Reviewer</span>
            <Badge className={currentReview.verdict === "pass" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}>
              {currentReview.verdict === "pass" ? "Passes bar ✓" : "Needs revision"}
            </Badge>
            <span className="ml-auto font-mono text-xs text-white/40">overall {currentReview.overall}/10</span>
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            {CRITERIA.map((c) => {
              const v = currentReview.scores[c.key];
              const color = v >= 8 ? "text-emerald-300" : v >= 6 ? "text-amber-300" : "text-red-300";
              return (
                <span key={c.key} className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-white/70">
                  {c.label} <b className={`font-mono ${color}`}>{v}</b>
                </span>
              );
            })}
          </div>
          {!!currentReview.compliance_flags?.length && (
            <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
              <div className="font-medium">⚠ Compliance</div>
              <ul className="mt-1 list-disc pl-4">{currentReview.compliance_flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
            </div>
          )}
          {!!currentReview.weaknesses?.length && (
            <div className="text-xs text-white/70">
              <div className="font-medium text-white/50">Weaknesses</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{currentReview.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {!!currentReview.suggestions?.length && (
            <div className="mt-2 text-xs text-white/70">
              <div className="font-medium text-white/50">Suggestions</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">{currentReview.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {scripts.length > 1 && (
        <div className="mt-3">
          <button onClick={() => setShowHistory((s) => !s)} className="text-xs text-white/40 hover:text-white/70">
            {showHistory ? "Hide" : "Show"} version history ({scripts.length})
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-1 text-xs text-white/50">
              {scripts.map((s) => (
                <li key={s.id}>
                  v{s.version} · {s.source} · {s.status} · {new Date(s.created_at).toLocaleDateString()}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${className}`}>{children}</span>;
}
