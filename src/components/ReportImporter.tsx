"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseReport } from "@/lib/metrics/report";

type StepState = "idle" | "running" | "done" | "failed";

function mostRecentMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() - ((day + 6) % 7));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Paste the weekly report → preview → import → refresh the whole loop
// (winners cache + example stores + learnings) in one motion.
export default function ReportImporter({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(`Week of ${mostRecentMonday()}`);
  const [text, setText] = useState("");
  const [importState, setImportState] = useState<StepState>("idle");
  const [refreshState, setRefreshState] = useState<StepState>("idle");
  const [learnState, setLearnState] = useState<StepState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ imported: number; matched: number; unmatched: string[] } | null>(null);

  const preview = useMemo(
    () => (text.trim() ? parseReport(text, label.trim() || "default") : null),
    [text, label],
  );

  const busy = importState === "running" || refreshState === "running" || learnState === "running";

  async function runImport() {
    if (!preview || preview.rows.length === 0) return;
    setError(null);
    setSummary(null);
    setImportState("running");
    setRefreshState("idle");
    setLearnState("idle");
    try {
      const res = await fetch("/api/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: preview.rows }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? "Import failed");
      setSummary(j);
      setImportState("done");
    } catch (e) {
      setImportState("failed");
      setError(e instanceof Error ? e.message : "Import failed");
      return;
    }

    // Chain the loop: winners/golden/bad refresh, then a fresh learnings take.
    setRefreshState("running");
    try {
      const res = await fetch("/api/winners/refresh", { method: "POST" });
      if (!res.ok) throw new Error();
      setRefreshState("done");
    } catch {
      setRefreshState("failed");
    }

    setLearnState("running");
    try {
      const res = await fetch("/api/learnings/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!res.ok) throw new Error();
      setLearnState("done");
    } catch {
      setLearnState("failed");
    }

    router.refresh();
  }

  const stepBadge = (s: StepState) =>
    s === "done" ? "✓" : s === "running" ? "…" : s === "failed" ? "✗" : "·";
  const stepColor = (s: StepState) =>
    s === "done" ? "text-emerald-300" : s === "failed" ? "text-red-300" : "text-white/40";

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-black hover:bg-emerald-300"
      >
        Import weekly report
      </button>
    );
  }

  return (
    <section className="w-full rounded-2xl border border-emerald-400/25 bg-emerald-400/[0.05] p-5">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-medium">Import weekly report</h2>
        <button onClick={() => setOpen(false)} className="text-sm text-white/50 hover:text-white" aria-label="Close importer">
          Close
        </button>
      </div>
      <p className="mb-4 text-[13px] text-white/50">
        Copy the rows straight out of the report sheet (header row included) and paste below.
        Ad names join back to concepts, so unmatched names get flagged for typos.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="text-xs uppercase tracking-wide text-white/45" htmlFor="flight-label">Flight label</label>
        <input
          id="flight-label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white/90 focus:border-emerald-400/50 focus:outline-none"
        />
        <span className="text-xs text-white/35">used for rows without their own week column</span>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Ad Name\tSpend\tConversions\tFlight CPA\tCTR\tBAU CPA\tVerdict\tReason\n…"}
        rows={6}
        className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/90 focus:border-emerald-400/50 focus:outline-none"
      />

      {preview && (
        <div className="mt-3 text-[13px]">
          <div className="text-white/70">
            {preview.rows.length} row{preview.rows.length === 1 ? "" : "s"} ready to import.
          </div>
          {preview.warnings.map((w, i) => (
            <div key={i} className="mt-1 text-amber-300/90">⚠ {w}</div>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          onClick={runImport}
          disabled={busy || !preview || preview.rows.length === 0}
          className="rounded-lg bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-50"
        >
          {importState === "running" ? "Importing…" : "Import & refresh loop"}
        </button>
        {(importState !== "idle" || busy) && (
          <div className="flex items-center gap-3 text-xs">
            <span className={stepColor(importState)}>{stepBadge(importState)} metrics</span>
            <span className={stepColor(refreshState)}>{stepBadge(refreshState)} winners + examples</span>
            <span className={stepColor(learnState)}>{stepBadge(learnState)} learnings</span>
          </div>
        )}
      </div>

      {error && <div className="mt-3 text-sm text-red-300">{error}</div>}

      {summary && (
        <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-[13px]">
          <div className="text-white/80">
            Imported {summary.imported} row{summary.imported === 1 ? "" : "s"} · {summary.matched} matched a concept.
          </div>
          {summary.unmatched.length > 0 && (
            <div className="mt-2 text-amber-300/90">
              <div className="font-medium">No concept carries these ad names — check for typos:</div>
              <ul className="mt-1 list-inside list-disc text-amber-200/80">
                {summary.unmatched.map((n) => (
                  <li key={n} className="break-all font-mono text-xs">{n}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
