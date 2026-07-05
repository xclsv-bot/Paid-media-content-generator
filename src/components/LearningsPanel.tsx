"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/http";

export type Learning = {
  id: string;
  narrative: string;
  do_more: string[] | null;
  do_less: string[] | null;
  watchouts: string[] | null;
  created_at: string;
};

export default function LearningsPanel({
  learning,
  canGenerate,
}: {
  learning: Learning | null;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setStatus("Analyzing performance…");
    try {
      const { ok, data } = await fetchJson("/api/learnings/generate", { method: "POST" });
      if (!ok) throw new Error(String(data.error ?? "Failed"));
      setStatus(null);
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const Col = ({ label, items, color }: { label: string; items: string[] | null; color: string }) =>
    items && items.length ? (
      <div>
        <div className={`mb-1 font-mono text-[10px] uppercase tracking-wide ${color}`}>{label}</div>
        <ul className="space-y-1 text-sm text-white/75">{items.map((x, i) => <li key={i}>• {x}</li>)}</ul>
      </div>
    ) : null;

  return (
    <section className="mb-8 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.04] p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-medium">Current learnings</h2>
        {learning && (
          <span className="font-mono text-xs text-white/40">
            {new Date(learning.created_at).toLocaleDateString()}
          </span>
        )}
        {canGenerate && (
          <button onClick={generate} disabled={busy}
            className="ml-auto rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50">
            {busy ? "Analyzing…" : learning ? "Regenerate" : "Generate learnings"}
          </button>
        )}
      </div>

      {!learning ? (
        <p className="text-sm text-white/50">
          No learnings yet.{" "}
          {canGenerate ? "Generate them from the scoreboard below once cohorts have matured." : ""}
        </p>
      ) : (
        <>
          <p className="text-[15px] leading-relaxed text-white/85">{learning.narrative}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Col label="Do more" items={learning.do_more} color="text-emerald-300" />
            <Col label="Do less" items={learning.do_less} color="text-red-300" />
            <Col label="Watch out" items={learning.watchouts} color="text-amber-300" />
          </div>
        </>
      )}
      {status && <p className="mt-2 text-xs text-white/50">{status}</p>}
    </section>
  );
}
