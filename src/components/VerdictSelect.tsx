"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VERDICT_LABEL, VERDICT_PILL, VERDICTS, type Verdict } from "@/lib/metrics/verdict";

// Inline verdict override on /performance. Staff can re-bucket an ad
// (Graduated / Keep testing / Killed) or hand it back to "Auto"; the change
// posts to /api/metrics as a verdict-only patch (metrics preserved) and the
// loop's stores rebuild immediately behind the scenes. Clients see the static
// pill instead (canEdit=false).
export default function VerdictSelect({
  adName,
  flightLabel,
  verdict,
  source,
  canEdit,
}: {
  adName: string;
  flightLabel: string;
  verdict: Verdict | null;
  source: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (!canEdit) {
    return verdict ? (
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT_PILL[verdict]}`}>
        {VERDICT_LABEL[verdict]}
      </span>
    ) : (
      <span className="text-xs text-white/40">—</span>
    );
  }

  async function change(next: string) {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ad_name: adName, flight_label: flightLabel, verdict: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={verdict ?? "AUTO"}
      disabled={busy}
      onChange={(e) => change(e.target.value)}
      title={source ? `Set by: ${source}` : undefined}
      className={`rounded-full border-0 px-2 py-0.5 text-xs font-semibold disabled:opacity-50 ${
        error ? "bg-red-500/15 text-red-300" : verdict ? VERDICT_PILL[verdict] : "bg-white/10 text-white/60"
      }`}
    >
      <option value="AUTO">Auto</option>
      {VERDICTS.map((v) => (
        <option key={v} value={v}>{VERDICT_LABEL[v]}</option>
      ))}
    </select>
  );
}
