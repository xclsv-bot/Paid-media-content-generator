"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The forward-only statuses a creator may set — must match CREATOR_STATUSES in
// src/app/api/deliverables/[id]/route.ts (the server rejects anything else).
const CREATOR_STATUSES = ["In production", "Submitted", "In revision"];

// Shown to an assigned creator on the concept brief so they can advance their
// deliverable's production status without the full staff This-Week board.
export default function DeliverableStatusControl({
  deliverableId,
  status,
}: {
  deliverableId: string;
  status: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function setStatus(production_status: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/deliverables/${deliverableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_status }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update");
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setBusy(false);
    }
  }

  const current = status ?? "—";
  const currentIsCreatorSettable = CREATOR_STATUSES.includes(status ?? "");

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h3 className="mb-2 text-sm font-medium">Production status</h3>
      <select
        value={currentIsCreatorSettable ? (status as string) : ""}
        disabled={busy}
        onChange={(e) => e.target.value && setStatus(e.target.value)}
        className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm"
      >
        <option value="" disabled>
          {current}
          {status && !currentIsCreatorSettable ? " (set by staff)" : ""}
        </option>
        {CREATOR_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      {msg && <p className="mt-2 text-xs text-red-300">{msg}</p>}
    </div>
  );
}
