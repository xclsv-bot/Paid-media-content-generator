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
      setMsg(`Cached ${body.cached} of ${body.evaluated} evaluated.`);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Refresh failed");
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
