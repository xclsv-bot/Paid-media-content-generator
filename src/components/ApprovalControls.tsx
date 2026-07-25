"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATE_STYLE: Record<string, string> = {
  Approved: "bg-emerald-500/20 text-emerald-300",
  "Changes requested": "bg-amber-500/20 text-amber-300",
  Pending: "bg-white/10 text-white/60",
};

// The same content sign-off as the Review page, available on the concept page
// itself — approving here also clears the piece from the Review queue.
export default function ApprovalControls({
  creativeId,
  state,
}: {
  creativeId: string;
  state: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function setApproval(next: string) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/creatives/${creativeId}/approval`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setErr(j?.error ?? "Couldn't update the approval — try again.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-white/45">Approval</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${STATE_STYLE[state] ?? STATE_STYLE.Pending}`}>
          {state}
        </span>
      </div>
      <div className="flex gap-2">
        {state !== "Approved" && (
          <button
            onClick={() => setApproval("Approved")}
            disabled={busy}
            className="flex-1 rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-50"
          >
            Approve
          </button>
        )}
        {state !== "Changes requested" && (
          <button
            onClick={() => setApproval("Changes requested")}
            disabled={busy}
            className="flex-1 rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            Request changes
          </button>
        )}
        {state === "Approved" && (
          <button
            onClick={() => setApproval("Pending")}
            disabled={busy}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/50 hover:bg-white/10 disabled:opacity-50"
            title="Send it back to the Review queue"
          >
            Un-approve
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
    </div>
  );
}
