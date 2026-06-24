"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Creative = { id: string; label: string; adName: string | null };

type Report = {
  totalRows: number;
  upserted: number;
  matchedAds: number;
  unmatchedAds: string[];
  dateRange: { from?: string; to?: string };
  detected: Record<string, string | null>;
  skipped: number;
  errors: string[];
};

export default function MetaImporter({ creatives }: { creatives: Creative[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [resultsColumn, setResultsColumn] = useState("");
  const [attributionWindow, setAttributionWindow] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkChoice, setLinkChoice] = useState<Record<string, string>>({});

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csv,
          resultsColumn: resultsColumn || undefined,
          attributionWindow: attributionWindow || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Import failed");
      setReport(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function linkAd(adName: string) {
    const creativeId = linkChoice[adName];
    if (!creativeId) return;
    const res = await fetch("/api/meta/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adName, creativeId }),
    });
    if (res.ok && report) {
      setReport({
        ...report,
        unmatchedAds: report.unmatchedAds.filter((n) => n !== adName),
      });
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder="…or paste CSV here"
        rows={8}
        className="w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <input
          value={resultsColumn}
          onChange={(e) => setResultsColumn(e.target.value)}
          placeholder="Results column (optional)"
          className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm"
        />
        <input
          value={attributionWindow}
          onChange={(e) => setAttributionWindow(e.target.value)}
          placeholder="Attribution window (e.g. 7d click)"
          className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm"
        />
        <button
          onClick={runImport}
          disabled={busy || !csv.trim()}
          className="rounded-lg bg-white px-4 py-1.5 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy ? "Importing…" : "Import"}
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {report && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>Rows parsed: <b>{report.totalRows}</b></span>
            <span>Upserted: <b>{report.upserted}</b></span>
            <span>Matched ads: <b>{report.matchedAds}</b></span>
            <span>Skipped: <b>{report.skipped}</b></span>
            {report.dateRange?.from && (
              <span className="text-white/50">
                {report.dateRange.from} → {report.dateRange.to}
              </span>
            )}
          </div>

          {report.errors?.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-amber-300">
              {report.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}

          {report.unmatchedAds.length > 0 && (
            <div>
              <p className="mb-2 font-medium text-amber-300">
                Unmatched ad names ({report.unmatchedAds.length}) — link, then re-import:
              </p>
              <div className="space-y-2">
                {report.unmatchedAds.map((name) => (
                  <div key={name} className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-black/40 px-2 py-1 text-xs">{name}</code>
                    <select
                      value={linkChoice[name] ?? ""}
                      onChange={(e) =>
                        setLinkChoice({ ...linkChoice, [name]: e.target.value })
                      }
                      className="rounded border border-white/10 bg-black/30 px-2 py-1 text-xs"
                    >
                      <option value="">Link to creative…</option>
                      {creatives.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => linkAd(name)}
                      disabled={!linkChoice[name]}
                      className="rounded border border-white/20 px-2 py-1 text-xs hover:bg-white/10 disabled:opacity-40"
                    >
                      Link
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
