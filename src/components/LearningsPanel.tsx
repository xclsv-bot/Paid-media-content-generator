"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchJson } from "@/lib/http";
import { parseSourceRef, SOURCE_KIND_LABEL } from "@/lib/loop/sourceRef";
// One definition of these types (learnings.ts) — the panel and the server that
// feeds it (performance/page.tsx) share it, so a shape change can't drift the UI.
// Type-only import: erased at build, pulls no server code into the client bundle.
import type { Rec, Learning } from "@/lib/loop/learnings";

export default function LearningsPanel({
  learning,
  canGenerate,
  orgId,
}: {
  learning: Learning | null;
  canGenerate: boolean;
  orgId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setStatus("Analyzing performance…");
    try {
      const { ok, data } = await fetchJson("/api/learnings/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!ok) throw new Error(String(data.error ?? "Failed"));
      setStatus(null);
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const Col = ({ label, items, color }: { label: string; items: Rec[] | null; color: string }) =>
    items && items.length ? (
      <div>
        <div className={`mb-1 font-mono text-[10px] uppercase tracking-wide ${color}`}>{label}</div>
        <ul className="space-y-1.5 text-sm text-white/75">
          {items.map((x, i) => (
            <li key={i}>
              • {x.directive}
              {x.metric && <span className="text-white/45"> — {x.metric}</span>}
              {x.sources?.length ? (
                <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                  {x.sources.map((s) => {
                    const ref = parseSourceRef(s);
                    return (
                      <span
                        key={s}
                        className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-[9.5px] text-white/40"
                        title={ref ? `${SOURCE_KIND_LABEL[ref.kind]} · ${ref.key}` : s}
                      >
                        {ref ? `${SOURCE_KIND_LABEL[ref.kind]}:${ref.key}` : s}
                      </span>
                    );
                  })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
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
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Col label="Do more" items={learning.do_more} color="text-emerald-300" />
            <Col label="Do less" items={learning.do_less} color="text-red-300" />
            <Col label="Explore" items={learning.explore} color="text-sky-300" />
            <Col label="Watch out" items={learning.watchouts} color="text-amber-300" />
          </div>
        </>
      )}
      {status && <p className="mt-2 text-xs text-white/50">{status}</p>}
    </section>
  );
}
