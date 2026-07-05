"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ConceptFields = {
  family: string;
  hook_line: string;
  hypothesis: string;
  content_summary: string;
  hook_angle: string;
  archetype: string;
  sport: string;
  feature_pillar: string;
  format: string;
  cta: string;
  variant_differentiator: string;
  compliance_note: string;
};

const EMPTY: ConceptFields = {
  family: "", hook_line: "", hypothesis: "", content_summary: "", hook_angle: "",
  archetype: "", sport: "", feature_pillar: "", format: "", cta: "",
  variant_differentiator: "", compliance_note: "",
};

const field = "w-full rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/50";

// Create (no conceptId) or edit (conceptId set) a concept's brief fields.
export default function ConceptForm({
  initial,
  conceptId,
  onDone,
}: {
  initial?: Partial<ConceptFields>;
  conceptId?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState<ConceptFields>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof ConceptFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  async function submit() {
    if (!f.hook_line.trim()) { setErr("A hook line is required."); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(conceptId ? `/api/concepts/${conceptId}` : "/api/concepts", {
        method: conceptId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      if (onDone) onDone();
      router.push(conceptId ? `/creatives/${conceptId}` : `/creatives/${json.id}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-white/45">{label}</span>
      {children}
    </label>
  );

  return (
    <div className="flex flex-col gap-4">
      <L label="Hook line *"><input className={field} value={f.hook_line} onChange={set("hook_line")} placeholder="The spoken / on-screen opener" /></L>
      <L label="Hypothesis"><textarea className={field} rows={2} value={f.hypothesis} onChange={set("hypothesis")} placeholder="What this tests and why you expect it to work" /></L>
      <L label="The brief"><textarea className={field} rows={4} value={f.content_summary} onChange={set("content_summary")} placeholder="What the creator should make — opening, demo/proof, tone, what success looks like" /></L>
      <div className="grid grid-cols-2 gap-4">
        <L label="Family"><input className={field} value={f.family} onChange={set("family")} placeholder="e.g. Big Win Proof" /></L>
        <L label="Hook angle"><input className={field} value={f.hook_angle} onChange={set("hook_angle")} /></L>
        <L label="Audience">
          <select className={field} value={f.archetype} onChange={set("archetype")}>
            <option value="">—</option><option>Qualifier</option><option>Broad-appeal</option><option>Mixed</option>
          </select>
        </L>
        <L label="Sport"><input className={field} value={f.sport} onChange={set("sport")} /></L>
        <L label="Feature / pillar"><input className={field} value={f.feature_pillar} onChange={set("feature_pillar")} /></L>
        <L label="Format"><input className={field} value={f.format} onChange={set("format")} placeholder="e.g. UGC selfie · 9:16" /></L>
        <L label="CTA"><input className={field} value={f.cta} onChange={set("cta")} /></L>
        <L label="Variant"><input className={field} value={f.variant_differentiator} onChange={set("variant_differentiator")} /></L>
      </div>
      <L label="Compliance note"><textarea className={field} rows={2} value={f.compliance_note} onChange={set("compliance_note")} /></L>

      {err && <p className="text-sm text-red-300">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="rounded-[10px] bg-emerald-400 px-4 py-2.5 text-[13.5px] font-semibold text-black disabled:opacity-50">
          {busy ? "Saving…" : conceptId ? "Save changes" : "Create concept"}
        </button>
        <button onClick={() => (onDone ? onDone() : router.back())} className="rounded-[10px] px-4 py-2.5 text-[13.5px] text-white/60 hover:bg-white/10">Cancel</button>
      </div>
    </div>
  );
}
