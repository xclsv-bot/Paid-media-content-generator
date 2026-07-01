"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncResult = {
  range?: { since: string; until: string };
  upserted?: number;
  matchedAds?: number;
  unmatchedAds?: string[];
  actionTypesSeen?: string[];
  note?: string | null;
  error?: string;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Admin control: pull daily insights straight from the Meta Marketing API.
export default function MetaSync() {
  const router = useRouter();
  const today = new Date();
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [since, setSince] = useState(iso(monthAgo));
  const [until, setUntil] = useState(iso(today));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function run() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/meta/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ since, until }),
      });
      const json = await res.json();
      setResult(json);
      if (res.ok) router.refresh();
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : "Failed" });
    } finally {
      setBusy(false);
    }
  }

  const field = "rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm";

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="text-lg font-medium">Sync from Meta API</h2>
      <p className="mt-1 text-sm text-white/50">
        Pull per-ad daily insights directly from the Meta Marketing API and join them to creatives —
        the automated equivalent of the CSV import.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-white/40">Since</span>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-white/40">Until</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={field} />
        </label>
        <button onClick={run} disabled={busy} className="rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black disabled:opacity-50">
          {busy ? "Syncing…" : "Sync"}
        </button>
      </div>

      {result && (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
          {result.error ? (
            <p className="text-amber-300">⚠ {result.error}</p>
          ) : (
            <>
              <p className="text-white/80">
                {result.range?.since} → {result.range?.until}: upserted <b>{result.upserted}</b> daily rows across{" "}
                <b>{result.matchedAds}</b> matched ads.
              </p>
              {!!result.unmatchedAds?.length && (
                <p className="mt-1 text-white/50">
                  {result.unmatchedAds.length} ad name(s) didn&apos;t match a creative — set each creative&apos;s
                  ad_name (or link below) and re-sync.
                </p>
              )}
              {result.note && <p className="mt-2 text-amber-200">ℹ {result.note}</p>}
              {!!result.actionTypesSeen?.length && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-white/40">Action types seen ({result.actionTypesSeen.length}) — pick the trial event</summary>
                  <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-white/60">
                    {result.actionTypesSeen.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
