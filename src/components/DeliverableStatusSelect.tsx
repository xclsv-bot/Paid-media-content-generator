"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CREATOR_STATUSES, PROD_STATUSES } from "@/lib/deliverables";

// Inline production-status select that persists on change.
export default function DeliverableStatusSelect({
  id,
  value,
  creator = false,
}: {
  id: string;
  value: string;
  creator?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function change(status: string) {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/deliverables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_status: status }),
      });
      if (!res.ok) setFailed(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm disabled:opacity-50"
      >
        {(creator ? CREATOR_STATUSES : PROD_STATUSES).map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
        {/* keep the current value visible even when it's outside the settable set */}
        {creator && !CREATOR_STATUSES.includes(value) && (
          <option value={value} disabled>{value}</option>
        )}
      </select>
      {failed && <span className="text-xs text-red-300" role="alert">save failed</span>}
    </span>
  );
}
