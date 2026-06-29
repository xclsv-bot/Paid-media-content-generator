"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ReviewComment = {
  id: string;
  body: string;
  created_at: string;
  author_id: string;
};

const STATE_STYLE: Record<string, string> = {
  Approved: "bg-emerald-500/20 text-emerald-300",
  "Changes requested": "bg-amber-500/20 text-amber-300",
  Pending: "bg-white/10 text-white/60",
};

export default function ReviewCard({
  creativeId,
  state,
  comments,
  currentUserId,
}: {
  creativeId: string;
  state: string;
  comments: ReviewComment[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");

  async function setApproval(next: string) {
    setBusy(true);
    try {
      await fetch(`/api/creatives/${creativeId}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function postComment() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await fetch(`/api/creatives/${creativeId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      setText("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-white/10 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATE_STYLE[state] ?? STATE_STYLE.Pending}`}>
          {state}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setApproval("Changes requested")} disabled={busy}
            className="rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-50">
            Request changes
          </button>
          <button onClick={() => setApproval("Approved")} disabled={busy}
            className="rounded-lg bg-emerald-500/90 px-3 py-1 text-sm font-medium text-black disabled:opacity-50">
            Approve
          </button>
        </div>
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        {comments.map((c) => (
          <li key={c.id} className="rounded-lg bg-black/20 p-2">
            <div className="text-xs text-white/40">
              {c.author_id === currentUserId ? "You" : "XCLSV"} · {new Date(c.created_at).toLocaleString()}
            </div>
            <div className="mt-0.5 whitespace-pre-wrap">{c.body}</div>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") postComment(); }}
          placeholder="Leave a comment…"
          className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-sm"
        />
        <button onClick={postComment} disabled={busy || !text.trim()}
          className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50">
          Send
        </button>
      </div>
    </div>
  );
}
