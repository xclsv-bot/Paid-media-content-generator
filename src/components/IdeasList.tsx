"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

export type IdeaRow = {
  id: string;
  sheet_id: string | null;
  family: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  idea_status: string;
  is_proven: boolean;
  cpt: number | null;
  hit: boolean | null;
  has_video: boolean;
};

const IDEA_STATUSES = ["Backlog", "Testing", "Winner", "Parked"];
const STATUS_PILL: Record<string, string> = {
  Winner: "bg-emerald-500/15 text-emerald-300",
  Testing: "bg-sky-500/15 text-sky-300",
  Backlog: "bg-white/10 text-white/60",
  Parked: "bg-amber-500/15 text-amber-300",
};

function uniq(v: (string | null)[]) {
  return [...new Set(v.filter((x): x is string => !!x))].sort();
}
function footerFor(r: IdeaRow): { label: string; color: string } {
  if (r.cpt != null) {
    return {
      label: `CPT $${r.cpt.toFixed(2)} · ${r.hit ? "Hit" : "Miss"}`,
      color: r.hit ? "#6ee7b7" : "#fca5a5",
    };
  }
  if (r.has_video) return { label: "Delivered · awaiting data", color: "rgba(125,211,252,0.85)" };
  return { label: "Not started", color: "rgba(232,234,237,0.4)" };
}

type View = "cards" | "list";

export default function IdeasList({ rows }: { rows: IdeaRow[] }) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("");
  const [archetype, setArchetype] = useState("");
  const [status, setStatus] = useState("");
  const [view, setView] = useState<View>("cards");

  // Remember the user's preferred view across visits.
  useEffect(() => {
    const saved = localStorage.getItem("ideasView");
    if (saved === "list" || saved === "cards") setView(saved);
  }, []);
  function pick(v: View) {
    setView(v);
    localStorage.setItem("ideasView", v);
  }

  const families = useMemo(() => uniq(rows.map((r) => r.family)), [rows]);

  const filtered = rows.filter((r) => {
    if (family && r.family !== family) return false;
    if (archetype && r.archetype !== archetype) return false;
    if (status && r.idea_status !== status) return false;
    if (q && !`${r.hook_line ?? ""} ${r.family ?? ""} ${r.hook_angle ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    return true;
  });

  const sel =
    "rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[13.5px] text-white/90 outline-none";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hook…" className={`${sel} w-[200px]`} />
        <select value={family} onChange={(e) => setFamily(e.target.value)} className={sel}>
          <option value="">All families</option>
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={archetype} onChange={(e) => setArchetype(e.target.value)} className={sel}>
          <option value="">Any audience</option>
          <option value="Qualifier">Qualifier</option>
          <option value="Broad-appeal">Broad-appeal</option>
          <option value="Mixed">Mixed</option>
        </select>
        <div className="ml-1 flex gap-1.5">
          {["", ...IDEA_STATUSES].map((s) => {
            const active = status === s;
            return (
              <button
                key={s || "all"}
                onClick={() => setStatus(s)}
                className={`rounded-lg border px-3 py-1.5 text-[12.5px] ${
                  active
                    ? "border-emerald-400 bg-emerald-400 font-semibold text-black"
                    : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10"
                }`}
              >
                {s || "All"}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {/* view toggle */}
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {(["cards", "list"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => pick(v)}
                aria-pressed={view === v}
                title={v === "cards" ? "Card view" : "List view"}
                className={`px-2.5 py-1.5 text-[12.5px] ${
                  view === v ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/[0.06]"
                }`}
              >
                {v === "cards" ? "▦ Cards" : "☰ List"}
              </button>
            ))}
          </div>
          <span className="font-mono text-xs text-white/40">{filtered.length} / {rows.length}</span>
        </div>
      </div>

      {view === "cards" ? (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(310px,1fr))]">
          {filtered.map((r) => {
            const foot = footerFor(r);
            return (
              <Link
                key={r.id}
                href={`/creatives/${r.id}`}
                className="flex min-h-[172px] flex-col gap-3 rounded-[15px] border border-white/10 bg-white/[0.035] p-[18px] transition hover:-translate-y-0.5 hover:border-emerald-400/45 hover:bg-white/[0.055]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-white/40">{r.sheet_id}</span>
                  <span className="text-[11.5px] uppercase tracking-wide text-white/50">{r.family}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[r.idea_status] ?? ""}`}>
                    {r.idea_status}
                  </span>
                </div>
                <h3 className="flex-1 text-[17px] font-semibold leading-snug text-gray-100">“{r.hook_line}”</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {r.hook_angle && <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-white/75">{r.hook_angle}</span>}
                  {r.sport && <span className="text-xs text-white/50">{r.sport}</span>}
                  {r.is_proven && <span className="ml-auto font-mono text-[10.5px] tracking-wide text-emerald-300">✓ PROVEN</span>}
                </div>
                <div className="flex items-center gap-2 border-t border-white/[0.07] pt-2.5">
                  <span className="h-[7px] w-[7px] rounded-full" style={{ background: foot.color }} />
                  <span className="text-[12.5px]" style={{ color: foot.color }}>{foot.label}</span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-white/10">
          <div className="grid grid-cols-[64px_1.4fr_2.2fr_1fr_0.9fr_120px_150px] gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-white/45">
            <span>#</span><span>Family</span><span>Hook</span><span>Angle</span><span>Sport</span><span>Status</span><span>Signal</span>
          </div>
          {filtered.map((r) => {
            const foot = footerFor(r);
            return (
              <Link
                key={r.id}
                href={`/creatives/${r.id}`}
                className="grid grid-cols-[64px_1.4fr_2.2fr_1fr_0.9fr_120px_150px] items-center gap-3 border-b border-white/[0.06] px-4 py-2.5 text-[13px] last:border-0 hover:bg-white/[0.04]"
              >
                <span className="font-mono text-[11px] text-white/40">{r.sheet_id}</span>
                <span className="truncate text-white/80">
                  {r.family}
                  {r.is_proven && <span className="ml-1.5 text-emerald-300" title="Proven">✓</span>}
                </span>
                <span className="truncate text-gray-100">{r.hook_line}</span>
                <span className="truncate text-white/60">{r.hook_angle}</span>
                <span className="truncate text-white/55">{r.sport}</span>
                <span><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[r.idea_status] ?? ""}`}>{r.idea_status}</span></span>
                <span className="flex items-center gap-2 truncate text-[12px]" style={{ color: foot.color }}>
                  <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: foot.color }} />
                  {foot.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
