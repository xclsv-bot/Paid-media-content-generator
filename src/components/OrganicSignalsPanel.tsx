"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type OrganicSignalRow = {
  id: string;
  platform: string;
  platform_url: string | null;
  creator_handle: string | null;
  format: string | null;
  sport: string | null;
  hook_summary: string;
  content_notes: string | null;
  review_status: string;
  source: string;
  concept_family_id: string | null;
  hook_angle_id: string | null;
  created_at: string;
};

type Option = { id: string; name: string };

const REVIEW_STATUSES = ["pending", "approved", "rejected"];

export default function OrganicSignalsPanel({
  signals,
  families,
  hookAngles,
}: {
  signals: OrganicSignalRow[];
  families: Option[];
  hookAngles: Option[];
}) {
  const router = useRouter();
  const [platform, setPlatform] = useState("");
  const [hookSummary, setHookSummary] = useState("");
  const [platformUrl, setPlatformUrl] = useState("");
  const [creatorHandle, setCreatorHandle] = useState("");
  const [format, setFormat] = useState("");
  const [sport, setSport] = useState("");
  const [contentNotes, setContentNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addSignal() {
    if (!platform.trim() || !hookSummary.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          hookSummary,
          platformUrl: platformUrl || null,
          creatorHandle: creatorHandle || null,
          format: format || null,
          sport: sport || null,
          contentNotes: contentNotes || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setPlatform(""); setHookSummary(""); setPlatformUrl("");
      setCreatorHandle(""); setFormat(""); setSport(""); setContentNotes("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    await fetch(`/api/signals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-lg font-medium">Add signal</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={platform} onChange={(e) => setPlatform(e.target.value)}
            placeholder="platform (tiktok, instagram, ...)"
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
          <input value={platformUrl} onChange={(e) => setPlatformUrl(e.target.value)}
            placeholder="link (optional)"
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
          <input value={creatorHandle} onChange={(e) => setCreatorHandle(e.target.value)}
            placeholder="creator handle (optional)"
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
          <input value={format} onChange={(e) => setFormat(e.target.value)}
            placeholder="format (optional)"
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
          <input value={sport} onChange={(e) => setSport(e.target.value)}
            placeholder="sport (optional)"
            className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
        </div>
        <textarea value={hookSummary} onChange={(e) => setHookSummary(e.target.value)}
          placeholder="the observed hook / opening line or content pattern"
          className="mt-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" rows={2} />
        <textarea value={contentNotes} onChange={(e) => setContentNotes(e.target.value)}
          placeholder="why it's working (optional)"
          className="mt-2 w-full rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" rows={2} />
        <button onClick={addSignal} disabled={busy}
          className="mt-2 rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-50">
          Add signal
        </button>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </section>

      <section className="rounded-xl border border-white/10 bg-white/5 p-4">
        <h2 className="mb-3 text-lg font-medium">Signals ({signals.length})</h2>
        {signals.length === 0 ? (
          <p className="text-sm text-white/40">No signals yet.</p>
        ) : (
          <div className="space-y-2">
            {signals.map((s) => (
              <div key={s.id} className="rounded-lg border border-white/10 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-wide text-white/40">
                    {s.platform}{s.format ? `/${s.format}` : ""} · {s.source}
                  </span>
                  <select
                    value={s.review_status}
                    onChange={(e) => patch(s.id, { reviewStatus: e.target.value })}
                    className="ml-auto rounded border border-white/10 bg-black/30 px-2 py-0.5 text-xs"
                  >
                    {REVIEW_STATUSES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 font-medium">&quot;{s.hook_summary}&quot;</p>
                {s.content_notes && <p className="mt-1 text-white/60">{s.content_notes}</p>}
                {s.platform_url && (
                  <a href={s.platform_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-sky-300 hover:underline">
                    {s.creator_handle || s.platform_url}
                  </a>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <select
                    value={s.concept_family_id ?? ""}
                    onChange={(e) => patch(s.id, { conceptFamilyId: e.target.value || null })}
                    className="rounded border border-white/10 bg-black/30 px-2 py-0.5 text-xs"
                  >
                    <option value="">(no family)</option>
                    {families.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                  <select
                    value={s.hook_angle_id ?? ""}
                    onChange={(e) => patch(s.id, { hookAngleId: e.target.value || null })}
                    className="rounded border border-white/10 bg-black/30 px-2 py-0.5 text-xs"
                  >
                    <option value="">(no angle)</option>
                    {hookAngles.map((h) => (
                      <option key={h.id} value={h.id}>{h.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
