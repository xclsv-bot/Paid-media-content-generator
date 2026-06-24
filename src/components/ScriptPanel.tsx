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

export default function ScriptPanel({
  conceptId,
  scripts,
  scriptDocUrl,
  canEdit,
}: {
  conceptId: string;
  scripts: Script[];
  scriptDocUrl: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const latest = scripts[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(latest?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

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
