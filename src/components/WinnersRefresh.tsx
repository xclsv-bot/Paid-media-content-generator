"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Staff button to recompute the Winners Cache from current performance.
export default function WinnersRefresh() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/winners/refresh", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Refresh failed");
      // A zero has two very different causes — say which one this is.
      const g = body.gates as { min_results: number; min_spend_cents: number } | undefined;
      if (body.evaluated === 0) {
        setMsg("No performance data imported yet — import a weekly report on Performance, then refresh.");
      } else if (body.cached === 0) {
        const bar = g ? ` (CPT at/under target over ≥${g.min_results} results and ≥$${g.min_spend_cents / 100} spend)` : "";
        setMsg(`${body.evaluated} evaluated — none cleared the winners bar yet${bar}. Not an error — nothing qualifies yet.`);
      } else {
        setMsg(`Cached ${body.cached} of ${body.evaluated} evaluated.`);
      }
      router.refresh();
    } catch (e) {
      setMsg(`${e instanceof Error ? e.message : "Refresh failed"} — try again; if it persists, re-check the report import on Performance.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={refresh}
        disabled={busy}
        className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh cache"}
      </button>
      {msg && <span className="text-xs text-white/50">{msg}</span>}
    </div>
  );
}
