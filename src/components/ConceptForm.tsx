"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adNameDateToken, composeAdName } from "@/lib/client/categorize";

export type ConceptFields = {
  org_id: string;
  family: string;
  ad_name: string;
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
  org_id: "", family: "", ad_name: "", hook_line: "", hypothesis: "", content_summary: "",
  hook_angle: "", archetype: "", sport: "", feature_pillar: "", format: "", cta: "",
  variant_differentiator: "", compliance_note: "",
};

// The naming convention's controlled vocab (from the client's ad taxonomy).
const CONV_FORMATS = ["Video", "Short Video"];
const CONV_TALENT = ["No Face", "Face"];
const CONV_DURATIONS = ["15s", "30s", "60s"];
const CONV_THEMES = ["Information", "Winning", "Process", "Product", "Community"];

const field = "w-full rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/90 outline-none focus:border-emerald-400/50";
const miniField = "w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-[12px] text-white/90 outline-none";

// Create (no conceptId) or edit (conceptId set) a concept's brief fields.
export default function ConceptForm({
  initial,
  conceptId,
  organizations,
  onDone,
}: {
  initial?: Partial<ConceptFields>;
  conceptId?: string;
  organizations?: { id: string; slug: string; display_name: string }[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState<ConceptFields>({ ...EMPTY, ...initial });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof ConceptFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  // Auto-generate the ad name from the client's convention:
  // XCLSV _ XCLSV _ Sport _ Format _ Talent _ Theme _ Date
  const todayToken = () => adNameDateToken();
  const [showBuilder, setShowBuilder] = useState(false);
  const [b, setB] = useState({
    sport: initial?.sport ?? "",
    format: CONV_FORMATS[0],
    talent: CONV_TALENT[0],
    theme: CONV_THEMES[0],
    duration: CONV_DURATIONS[0],
    date: todayToken(),
  });
  const setBuild = (k: keyof typeof b) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setB({ ...b, [k]: e.target.value });
  function buildAdName() {
    setF((prev) => ({ ...prev, ad_name: composeAdName({ sport: b.sport, format: b.format, talent: b.talent, theme: b.theme, duration: b.duration, date: b.date }) }));
  }

  async function submit() {
    if (!f.hook_line.trim()) { setErr("A hook line is required."); return; }
    if (!conceptId && !f.org_id) { setErr("A client is required."); return; }
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
      {!conceptId && organizations && (
        <L label="Client *">
          <select className={field} value={f.org_id} onChange={set("org_id")}>
            <option value="">—</option>
            {organizations.map((o) => <option key={o.id} value={o.id}>{o.display_name}</option>)}
          </select>
        </L>
      )}
      <L label="Hook line *"><input className={field} value={f.hook_line} onChange={set("hook_line")} placeholder="The spoken / on-screen opener" /></L>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wide text-white/45">Ad name (naming convention)</span>
          <button type="button" onClick={() => setShowBuilder((s) => !s)} className="text-[11px] text-violet-300 hover:underline">
            {showBuilder ? "Hide builder" : "Build from convention"}
          </button>
        </div>
        <input className={`${field} font-mono text-[12.5px]`} value={f.ad_name} onChange={set("ad_name")}
          placeholder="XCLSV _ XCLSV _ MLB _ Video _ No Face _ Information _ 15s _ 06.25.26" />
        {showBuilder && (
          <div className="rounded-[10px] border border-white/10 bg-white/[0.02] p-2.5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <label className="flex flex-col gap-1"><span className="font-mono text-[9px] uppercase text-white/40">Sport</span><input className={miniField} value={b.sport} onChange={setBuild("sport")} placeholder="MLB / All" /></label>
              <label className="flex flex-col gap-1"><span className="font-mono text-[9px] uppercase text-white/40">Format</span><select className={miniField} value={b.format} onChange={setBuild("format")}>{CONV_FORMATS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="font-mono text-[9px] uppercase text-white/40">Talent</span><select className={miniField} value={b.talent} onChange={setBuild("talent")}>{CONV_TALENT.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="font-mono text-[9px] uppercase text-white/40">Theme</span><select className={miniField} value={b.theme} onChange={setBuild("theme")}>{CONV_THEMES.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="font-mono text-[9px] uppercase text-white/40">Duration</span><select className={miniField} value={b.duration} onChange={setBuild("duration")}>{CONV_DURATIONS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="flex flex-col gap-1"><span className="font-mono text-[9px] uppercase text-white/40">Date</span><input className={miniField} value={b.date} onChange={setBuild("date")} placeholder="6.25.26" /></label>
            </div>
            <button type="button" onClick={buildAdName} className="mt-2 w-fit rounded-lg bg-violet-500/90 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-500">
              Compose ad name
            </button>
          </div>
        )}
      </div>

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
