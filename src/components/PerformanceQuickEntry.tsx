"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { VERDICT_LABEL, VERDICTS } from "@/lib/metrics/verdict";

// Staff quick-entry for a creative's performance, on the creative detail page.
// Record spend / conversions / CTR (+ an optional verdict override) for a
// flight, and the loop's stores rebuild immediately — this is Zaire's
// "invisible curation": the interaction of logging a CPA is what populates the
// winners cache / golden set / loser store, no separate curation screen.
//
// Posts to /api/metrics/record keyed by the creative's ad_name. Verdict defaults to
// "Auto" — derived from the numbers by the same gates the loop uses — so staff
// only pick a bucket when they want to override the paid team's call.
export default function PerformanceQuickEntry({ adName }: { adName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    flight_label: "",
    spend: "",
    conversions: "",
    ctr: "", // percent, e.g. 1.8 → 0.018
    verdict: "KEEP", // "KEEP" = leave the current verdict untouched (omit from POST)
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const ctrPct = form.ctr.trim() === "" ? null : Number(form.ctr) / 100;
      const res = await fetch("/api/metrics/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ad_name: adName,
          flight_label: form.flight_label.trim() || undefined,
          spend: form.spend.trim() === "" ? null : Number(form.spend),
          conversions: form.conversions.trim() === "" ? null : Number(form.conversions),
          ctr: ctrPct,
          // omit verdict when leaving it unchanged, so a spend-only save never
          // clobbers a paid-team verdict; the route preserves it.
          verdict: form.verdict === "KEEP" ? undefined : form.verdict,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Save failed");
      const v = body.metric?.verdict as keyof typeof VERDICT_LABEL | undefined;
      const cached = body.refresh && !("error" in body.refresh) ? body.refresh.cached : null;
      setMsg(
        `Saved${v ? ` · ${VERDICT_LABEL[v]}` : ""}` +
          (cached != null ? ` · ${cached} winner${cached === 1 ? "" : "s"} cached` : "") +
          (body.refresh && "error" in body.refresh ? " · refresh failed" : ""),
      );
      setForm((f) => ({ ...f, spend: "", conversions: "", ctr: "" }));
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-[10px] border border-white/[0.12] bg-white/[0.03] px-3 py-2 text-[12.5px] font-medium text-white/70 hover:bg-white/[0.06]"
      >
        + Record performance
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-[12px] border border-white/[0.12] bg-white/[0.03] p-3.5">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wide text-white/50">Record performance</span>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-white/40 hover:text-white/70">
          Close
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="Flight" placeholder="Week of Jul 6" value={form.flight_label} onChange={set("flight_label")} className="col-span-2" />
        <Field label="Spend ($)" type="number" step="0.01" value={form.spend} onChange={set("spend")} />
        <Field label="Conversions" type="number" step="1" value={form.conversions} onChange={set("conversions")} />
        <Field label="CTR (%)" type="number" step="0.01" value={form.ctr} onChange={set("ctr")} />
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">Verdict</span>
          <select
            value={form.verdict}
            onChange={set("verdict")}
            className="rounded-lg border border-white/10 bg-[#0e1014] px-2.5 py-1.5 text-[13px] text-white/90"
          >
            <option value="KEEP">Leave unchanged</option>
            <option value="AUTO">Auto (from the numbers)</option>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>{VERDICT_LABEL[v]}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-[11.5px] text-white/55">{msg}</span>}
      </div>
    </form>
  );
}

function Field({
  label,
  className = "",
  ...props
}: { label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</span>
      <input
        {...props}
        className="rounded-lg border border-white/10 bg-[#0e1014] px-2.5 py-1.5 text-[13px] text-white/90 placeholder:text-white/25"
      />
    </label>
  );
}
