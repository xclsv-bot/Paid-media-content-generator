"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PROD_STATUSES = [
  "Assigned",
  "In production",
  "Submitted",
  "In revision",
  "Approved",
  "Delivered",
];
// Approve/Deliver are staff calls (Delivered publishes to the client portal);
// the API enforces the same allowlist server-side.
const CREATOR_STATUSES = ["In production", "Submitted", "In revision"];

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

  async function change(status: string) {
    setBusy(true);
    try {
      await fetch(`/api/deliverables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ production_status: status }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
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
  );
}
