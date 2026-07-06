"use client";

import { useState } from "react";
import { fetchJson } from "@/lib/http";

type Concept = {
  family: string;
  hook: string;
  angle: string;
  archetype: string;
  sport: string;
  feature: string;
  hypothesis: string;
  _added?: boolean;
};
type Msg = { role: "user" | "ai"; text: string; concepts?: Concept[] };
type Source = { type: string; name: string; note?: string };

const INTRO: Msg = {
  role: "ai",
  text: "Share a call transcript, a reference, or a performance signal — paste notes or add a source — and ask me for angles. I'll propose concepts you can push straight into Ideas.",
};

const chip = "rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[11.5px] text-white/65";

export default function IdeateWorkspace() {
  const [messages, setMessages] = useState<Msg[]>([INTRO]);
  const [sources, setSources] = useState<Source[]>([]);
  const [composer, setComposer] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [showSrc, setShowSrc] = useState(false);
  const [srcDraft, setSrcDraft] = useState({ type: "Transcript", name: "", note: "" });

  function flash(t: string) {
    setToast(t);
    setTimeout(() => setToast(null), 1800);
  }

  async function send() {
    const text = composer.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setComposer("");
    setBusy(true);
    try {
      const { ok, data } = await fetchJson("/api/ideate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.filter((m) => m !== INTRO).map((m) => ({ role: m.role, text: m.text })),
          sources,
        }),
      });
      if (!ok) throw new Error(String(data.error ?? "Ideation failed"));
      setMessages((m) => [
        ...m,
        { role: "ai", text: String(data.reply ?? ""), concepts: (data.concepts as Concept[]) ?? [] },
      ]);
    } catch (e) {
      setMessages((m) => [...m, { role: "ai", text: `⚠ ${e instanceof Error ? e.message : "Failed"}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function addConcept(mi: number, ci: number, toCycle: boolean) {
    const c = messages[mi].concepts?.[ci];
    if (!c) return;
    const res = await fetch("/api/concepts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family: c.family,
        hook_line: c.hook,
        hypothesis: c.hypothesis,
        hook_angle: c.angle,
        archetype: c.archetype,
        sport: c.sport,
        feature_pillar: c.feature,
        idea_status: "Backlog",
        add_to_cycle: toCycle,
      }),
    });
    if (!res.ok) {
      flash("Couldn't add concept");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { cycle?: { label: string } | null };
    setMessages((msgs) =>
      msgs.map((m, i) =>
        i !== mi ? m : { ...m, concepts: m.concepts?.map((x, j) => (j === ci ? { ...x, _added: true } : x)) },
      ),
    );
    setAdded((n) => n + 1);
    if (toCycle) {
      flash(data.cycle ? `Added to This Week — ${data.cycle.label} ✓` : "Added to Ideas — no open cycle yet (create one on This Week)");
    } else {
      flash("Added to Ideas ✓");
    }
  }

  function addSource() {
    if (!srcDraft.name.trim()) return;
    setSources((s) => [...s, { ...srcDraft }]);
    setSrcDraft({ type: "Transcript", name: "", note: "" });
    setShowSrc(false);
    flash("Source attached — the agent will use it");
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
      {/* sources rail */}
      <aside className="rounded-[14px] border border-white/10 bg-white/[0.025] p-4 lg:sticky lg:top-20">
        <div className="mb-3 font-mono text-[11px] uppercase tracking-wider text-white/45">Context the agent uses</div>
        <div className="flex flex-col gap-2">
          {sources.length === 0 && <p className="text-[12.5px] text-white/40">No sources yet.</p>}
          {sources.map((s, i) => (
            <div key={i} className="rounded-[9px] border border-white/[0.08] bg-white/[0.02] px-2.5 py-2">
              <div className="font-mono text-[9.5px] uppercase tracking-wide text-white/40">{s.type}</div>
              <div className="truncate text-[12.5px] text-white/80">{s.name}</div>
            </div>
          ))}
        </div>
        {showSrc ? (
          <div className="mt-3 flex flex-col gap-2">
            <select value={srcDraft.type} onChange={(e) => setSrcDraft({ ...srcDraft, type: e.target.value })}
              className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm">
              <option>Transcript</option><option>Reference</option><option>Signal</option>
            </select>
            <input value={srcDraft.name} onChange={(e) => setSrcDraft({ ...srcDraft, name: e.target.value })}
              placeholder="Name" className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
            <textarea value={srcDraft.note} onChange={(e) => setSrcDraft({ ...srcDraft, note: e.target.value })}
              placeholder="Paste notes / context (optional)" rows={3}
              className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
            <div className="flex gap-2">
              <button onClick={addSource} className="rounded-lg bg-emerald-400 px-3 py-1 text-sm font-medium text-black">Add</button>
              <button onClick={() => setShowSrc(false)} className="rounded-lg px-3 py-1 text-sm text-white/50">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowSrc(true)}
            className="mt-3 w-full rounded-[10px] border border-white/[0.14] py-2.5 text-[13px] text-white/70 hover:bg-white/10">
            + Add source
          </button>
        )}
      </aside>

      {/* chat */}
      <div className="flex min-w-0 flex-col">
        <div className="flex flex-col gap-5">
          {messages.map((m, mi) =>
            m.role === "ai" ? (
              <div key={mi} className="flex items-start gap-3">
                <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-[9px] border border-emerald-400/30 bg-emerald-400/15 text-emerald-300">✦</div>
                <div className="flex min-w-0 flex-1 flex-col gap-3.5">
                  <div className="text-[14.5px] leading-relaxed text-white/85">{m.text}</div>
                  {m.concepts?.map((c, ci) => (
                    <div key={ci} className="rounded-[14px] border border-white/[0.11] bg-white/[0.03] p-[17px]">
                      <div className="mb-2 flex items-center gap-2">
                        <span className="font-mono text-[10.5px] uppercase tracking-wide text-white/50">{c.family}</span>
                        <span className="rounded-md bg-violet-400/15 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-violet-300">DRAFT CONCEPT</span>
                      </div>
                      <h3 className="mb-3 text-[17.5px] font-semibold leading-snug text-gray-100">“{c.hook}”</h3>
                      <div className="mb-3 flex flex-wrap gap-2">
                        <span className={chip}><b className="font-mono text-[9.5px] text-white/45">ANGLE</b> {c.angle}</span>
                        <span className={chip}><b className="font-mono text-[9.5px] text-white/45">AUDIENCE</b> {c.archetype}</span>
                        <span className={chip}><b className="font-mono text-[9.5px] text-white/45">SPORT</b> {c.sport}</span>
                        <span className={chip}><b className="font-mono text-[9.5px] text-white/45">FEATURE</b> {c.feature}</span>
                      </div>
                      <div className="mb-3.5 border-t border-white/[0.08] pt-3 text-[13.5px] leading-relaxed text-white/80">
                        <span className="font-mono text-[9.5px] tracking-wide text-emerald-300">HYPOTHESIS&nbsp;&nbsp;</span>{c.hypothesis}
                      </div>
                      <div className="flex flex-wrap gap-2.5">
                        <button
                          disabled={c._added}
                          onClick={() => addConcept(mi, ci, false)}
                          className={`rounded-[9px] px-3.5 py-2 text-[13px] font-semibold ${
                            c._added ? "cursor-default bg-emerald-500/15 text-emerald-300" : "bg-emerald-400 text-black hover:bg-emerald-300"
                          }`}
                        >
                          {c._added ? "✓ Added" : "+ Add to Ideas"}
                        </button>
                        <button
                          disabled={c._added}
                          onClick={() => addConcept(mi, ci, true)}
                          className={`rounded-[9px] px-3.5 py-2 text-[13px] font-semibold ${
                            c._added ? "hidden" : "border border-emerald-400/40 text-emerald-300 hover:bg-emerald-400/10"
                          }`}
                        >
                          + Add to This Week
                        </button>
                        <button
                          onClick={() => setComposer(`Refine "${c.hook}": `)}
                          className="rounded-[9px] border border-white/20 px-3.5 py-2 text-[12.5px] text-white/80 hover:bg-white/10"
                        >
                          Refine
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div key={mi} className="flex justify-end">
                <div className="max-w-[78%] rounded-[14px_14px_4px_14px] border border-white/[0.09] bg-white/[0.06] px-3.5 py-3 text-sm leading-relaxed text-white/90">{m.text}</div>
              </div>
            ),
          )}
          {busy && <div className="pl-[42px] text-sm text-white/40">Thinking…</div>}
        </div>

        {/* composer */}
        <div className="sticky bottom-4 mt-6">
          <div className="rounded-[14px] border border-white/[0.12] bg-[#111318]/95 p-3 shadow-2xl backdrop-blur">
            <div className="flex items-end gap-2.5">
              <button onClick={() => setShowSrc(true)} className="h-[34px] w-[34px] flex-shrink-0 rounded-[9px] border border-white/[0.12] bg-white/[0.06] text-lg text-white/70">＋</button>
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask for angles, refine a concept, or paste call notes…"
                rows={1}
                className="min-h-[22px] flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed text-white/90 outline-none"
              />
              <button onClick={send} disabled={busy} className="flex-shrink-0 rounded-[9px] bg-emerald-400 px-4 py-2 text-[13.5px] font-semibold text-black disabled:opacity-50">Send</button>
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 rounded-[10px] border border-emerald-500/40 bg-emerald-500/15 px-4 py-2.5 text-[13.5px] font-medium text-emerald-300 backdrop-blur">
          {toast}
        </div>
      )}
      {added > 0 && <span className="hidden">{added}</span>}
    </div>
  );
}
