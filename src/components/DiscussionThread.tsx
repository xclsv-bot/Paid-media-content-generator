"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Note = {
  id: string;
  author_id: string | null;
  author_name: string | null;
  author_role: string | null;
  body: string;
  created_at: string;
};

const ROLE_LABEL: Record<string, string> = {
  admin: "XCLSV",
  editor: "XCLSV",
  creator: "Creator",
};

// Internal production discussion between the assigned creator and staff.
export default function DiscussionThread({
  conceptId,
  notes,
  currentUserId,
}: {
  conceptId: string;
  notes: Note[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/concepts/${conceptId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      if (res.ok) {
        setText("");
        setError(null);
        router.refresh();
      } else {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Couldn't send — try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-medium">Discussion</h2>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10.5px] uppercase tracking-wide text-white/45">Internal</span>
      </div>
      <p className="mb-3 text-xs text-white/45">Questions and feedback between the creator and the XCLSV team. Not visible to the client.</p>

      <ul className="mb-3 space-y-2">
        {notes.length === 0 && <li className="text-sm text-white/40">No messages yet — ask a question or leave a note.</li>}
        {notes.map((n) => {
          const mine = n.author_id === currentUserId;
          const who = mine ? "You" : n.author_name || ROLE_LABEL[n.author_role ?? ""] || "User";
          return (
            <li key={n.id} className="rounded-lg bg-black/20 p-2.5">
              <div className="flex items-center gap-2 text-xs text-white/40">
                <span className="font-medium text-white/60">{who}</span>
                {n.author_role && !mine && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">{ROLE_LABEL[n.author_role] ?? n.author_role}</span>
                )}
                <span className="ml-auto">{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-1 whitespace-pre-wrap text-sm text-white/85">{n.body}</div>
            </li>
          );
        })}
      </ul>

      {error && <p className="mb-2 text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); post(); } }}
          placeholder="Ask a question or leave feedback…"
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90"
        />
        <button onClick={post} disabled={busy || !text.trim()}
          className="rounded-lg border border-white/20 px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-50">
          Send
        </button>
      </div>
    </section>
  );
}
