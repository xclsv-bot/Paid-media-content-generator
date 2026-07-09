"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { parseReport, type ReportRow } from "@/lib/metrics/report";

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
  const [mode, setMode] = useState<"photo" | "paste">("photo");
  const [text, setText] = useState("");
  const [extracted, setExtracted] = useState<{ rows: ReportRow[]; warnings: string[] } | null>(null);
  const [extracting, setExtracting] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const [importState, setImportState] = useState<StepState>("idle");
  const [refreshState, setRefreshState] = useState<StepState>("idle");
  const [learnState, setLearnState] = useState<StepState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ imported: number; matched: number; unmatched: string[] } | null>(null);

  const preview = useMemo(
    () => (text.trim() ? parseReport(text, label.trim() || "default") : null),
    [text, label],
  );
  // Whichever mode produced rows feeds the same import pipeline.
  const pending = mode === "photo" ? extracted : preview;

  const busy = importState === "running" || refreshState === "running" || learnState === "running" || extracting;

  // Photos from a phone are huge; downscale on-device so the request stays
  // small and extraction stays fast.
  async function fileToBase64Jpeg(file: File): Promise<string> {
    const bitmap = await createImageBitmap(file);
    const maxDim = 2200;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return dataUrl.split(",")[1];
  }

  async function extractPhoto() {
    const file = photoRef.current?.files?.[0];
    if (!file || extracting) return;
    setError(null);
    setSummary(null);
    setExtracted(null);
    setExtracting(true);
    try {
      const image = await fileToBase64Jpeg(file);
      const res = await fetch("/api/metrics/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image, mediaType: "image/jpeg", flightLabel: label.trim() || "default" }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? "Couldn't read the photo");
      setExtracted({ rows: j.rows as ReportRow[], warnings: (j.warnings as string[]) ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the photo");
    } finally {
      setExtracting(false);
    }
  }

  async function runImport() {
    if (!pending || pending.rows.length === 0) return;
    setError(null);
    setSummary(null);
    setImportState("running");
    setRefreshState("idle");
    setLearnState("idle");
    try {
      const res = await fetch("/api/metrics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: pending.rows }),
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
        Upload a photo of the report, or paste rows copied out of a sheet. Ad names join back to
        concepts, so unmatched names get flagged for typos.
      </p>

      <div className="mb-3 flex gap-1 rounded-lg border border-white/10 bg-black/20 p-1 text-sm" role="tablist">
        {(["photo", "paste"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setError(null); setSummary(null); }}
            className={`flex-1 rounded-md px-3 py-1.5 ${mode === m ? "bg-white/10 font-medium text-white" : "text-white/50 hover:text-white"}`}
          >
            {m === "photo" ? "📷 Photo of the report" : "Paste rows"}
          </button>
        ))}
      </div>

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

      {mode === "paste" ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Ad Name\tSpend\tConversions\tFlight CPA\tCTR\tBAU CPA\tVerdict\tReason\n…"}
          rows={6}
          className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-white/90 focus:border-emerald-400/50 focus:outline-none"
        />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={photoRef} type="file" accept="image/*" className="text-sm text-white/60 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-sm file:text-white/80 hover:file:bg-white/15" />
          <button
            onClick={extractPhoto}
            disabled={extracting}
            className="rounded-lg border border-emerald-400/40 px-3 py-1.5 text-sm text-emerald-300 hover:bg-emerald-400/10 disabled:opacity-50"
          >
            {extracting ? "Reading photo…" : "✨ Read the report"}
          </button>
        </div>
      )}

      {pending && (
        <div className="mt-3 text-[13px]">
          <div className="text-white/70">
            {pending.rows.length} row{pending.rows.length === 1 ? "" : "s"} ready to import.
          </div>
          {pending.warnings.map((w, i) => (
            <div key={i} className="mt-1 text-amber-300/90">⚠ {w}</div>
          ))}
          {mode === "photo" && pending.rows.length > 0 && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="bg-white/5 text-white/50">
                  <tr>
                    <th className="px-2 py-1.5">Ad name</th>
                    <th className="px-2 py-1.5 text-right">Spend</th>
                    <th className="px-2 py-1.5 text-right">Conv</th>
                    <th className="px-2 py-1.5 text-right">CPA</th>
                    <th className="px-2 py-1.5">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.rows.map((r) => (
                    <tr key={r.ad_name + r.flight_label} className="border-t border-white/5">
                      <td className="max-w-[340px] truncate px-2 py-1.5 font-mono text-[11px] text-white/70" title={r.ad_name}>{r.ad_name}</td>
                      <td className="px-2 py-1.5 text-right text-white/70">{r.spend == null ? "—" : `$${r.spend.toFixed(2)}`}</td>
                      <td className="px-2 py-1.5 text-right text-white/70">{r.conversions ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right text-white/70">{r.cpa == null ? "—" : `$${r.cpa.toFixed(2)}`}</td>
                      <td className="px-2 py-1.5 text-white/70">{r.verdict ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="border-t border-white/10 px-2 py-1.5 text-[11px] text-white/40">
                Read from your photo — double-check the numbers before importing.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <button
          onClick={runImport}
          disabled={busy || !pending || pending.rows.length === 0}
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
