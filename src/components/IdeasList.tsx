"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type CycleOpt = { id: string; label: string; status: string; org_id: string };
export type PersonOpt = { id: string; name: string | null; role: string };

export type IdeaRow = {
  id: string;
  sheet_id: string | null;
  org_id: string | null;
  family: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  idea_status: string;
  is_proven: boolean;
  cpt: number | null;
  hit: boolean | null;
  reported: boolean;
  spend: number | null;
  has_video: boolean;
  in_cycle: boolean;
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
  // In a weekly report, but no trials yet — spending without converting.
  if (r.reported) {
    return {
      label: `Reported · $${(r.spend ?? 0).toFixed(0)} spent · no trials yet`,
      color: "rgba(252,211,77,0.9)",
    };
  }
  if (r.has_video) return { label: "Delivered · no metrics yet", color: "rgba(125,211,252,0.85)" };
  return { label: "Not started", color: "rgba(232,234,237,0.4)" };
}

type View = "cards" | "list";

export default function IdeasList({
  rows,
  cycles,
  people,
}: {
  rows: IdeaRow[];
  cycles: CycleOpt[];
  people: PersonOpt[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("");
  const [archetype, setArchetype] = useState("");
  const [status, setStatus] = useState("");
  const [hideScheduled, setHideScheduled] = useState(false);
  const [view, setView] = useState<View>("cards");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWeek, setBulkWeek] = useState("");
  const [bulkPerson, setBulkPerson] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<{ text: string; error: boolean } | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Weeks are per-client: offer only cycles matching the selection's org.
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const selOrgs = [...new Set(selectedRows.map((r) => r.org_id).filter(Boolean))];
  const weekOptions = selOrgs.length === 1 ? cycles.filter((c) => c.org_id === selOrgs[0]) : [];

  async function applyBulk() {
    if (selected.size === 0 || bulkBusy || (!bulkWeek && !bulkPerson)) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const ids = [...selected];
      if (bulkWeek) {
        // One call schedules everything (dupes ignored) and assigns if asked.
        const res = await fetch(`/api/cycles/${bulkWeek}/deliverables`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conceptIds: ids, ...(bulkPerson ? { assignee_id: bulkPerson } : {}) }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error ?? "Couldn't update the selection");
        const week = cycles.find((c) => c.id === bulkWeek)?.label ?? "the week";
        setBulkMsg({
          text: `Added ${j.added} to ${week}${bulkPerson ? ` · creator set on ${j.assigned}` : ""} ✓`,
          error: false,
        });
      } else {
        // Creator only: assigns existing week slots; unscheduled concepts have
        // no slot to carry the assignment.
        const res = await fetch("/api/deliverables/assign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conceptIds: ids, assignee_id: bulkPerson }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok) throw new Error(j?.error ?? "Couldn't assign the creator");
        const skipped = (j.unscheduled as string[])?.length ?? 0;
        setBulkMsg({
          text: `Creator set on ${j.assigned}${skipped > 0 ? ` · ${skipped} skipped (not in a week yet — pick a week too to schedule them)` : ""} ${skipped > 0 ? "" : "✓"}`,
          error: false,
        });
      }
      setSelected(new Set());
      setBulkWeek("");
      setBulkPerson("");
      router.refresh();
    } catch (e) {
      setBulkMsg({ text: e instanceof Error ? e.message : "Couldn't update the selection", error: true });
    } finally {
      setBulkBusy(false);
    }
  }

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

  const scheduledCount = useMemo(() => rows.filter((r) => r.in_cycle).length, [rows]);

  const filtered = rows.filter((r) => {
    if (hideScheduled && r.in_cycle) return false;
    if (family && r.family !== family) return false;
    if (archetype && r.archetype !== archetype) return false;
    if (status && r.idea_status !== status) return false;
    if (q && !`${r.hook_line ?? ""} ${r.family ?? ""} ${r.hook_angle ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      return false;
    return true;
  });

  const sel =
    "rounded-[10px] border border-white/10 bg-white/[0.04] px-3 py-2 text-[13.5px] text-white/90 outline-none focus-visible:border-emerald-400/50";

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
        <button
          onClick={() => setHideScheduled((v) => !v)}
          disabled={scheduledCount === 0}
          title="Hide concepts already scheduled into a cycle"
          className={`rounded-lg border px-3 py-1.5 text-[12.5px] disabled:opacity-40 ${
            hideScheduled
              ? "border-emerald-400 bg-emerald-400 font-semibold text-black"
              : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10"
          }`}
        >
          {hideScheduled ? "Scheduled hidden" : "Hide scheduled"}
          {scheduledCount > 0 && <span className="ml-1.5 opacity-60">{scheduledCount}</span>}
        </button>
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

      {(selected.size > 0 || bulkMsg) && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[12px] border border-emerald-400/25 bg-emerald-400/[0.05] px-4 py-2.5 text-sm">
          <span className="text-white/70">{selected.size} selected</span>
          {selected.size > 0 && (
            <>
              {selOrgs.length > 1 ? (
                <span className="text-amber-300/90">Selection spans clients — pick one client&apos;s concepts.</span>
              ) : (
                <>
                  <select value={bulkWeek} onChange={(e) => setBulkWeek(e.target.value)} aria-label="Add to week" className={sel}>
                    <option value="">Week (optional)…</option>
                    {weekOptions.map((c) => (
                      <option key={c.id} value={c.id}>{c.label} · {c.status}</option>
                    ))}
                  </select>
                  <select value={bulkPerson} onChange={(e) => setBulkPerson(e.target.value)} aria-label="Assign creator" className={sel}>
                    <option value="">Creator (optional)…</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>{p.name ?? "user"} ({p.role})</option>
                    ))}
                  </select>
                  <button
                    onClick={applyBulk}
                    disabled={bulkBusy || (!bulkWeek && !bulkPerson)}
                    className="rounded-lg bg-emerald-400 px-3.5 py-1.5 text-[13px] font-semibold text-black hover:bg-emerald-300 disabled:opacity-40"
                  >
                    {bulkBusy ? "Applying…" : "Apply"}
                  </button>
                </>
              )}
              <button onClick={() => { setSelected(new Set()); setBulkMsg(null); }} className="text-white/50 hover:text-white">
                Clear
              </button>
            </>
          )}
          {bulkMsg && (
            <span className={`${selected.size > 0 ? "w-full" : ""} ${bulkMsg.error ? "text-red-300" : "text-emerald-300"}`}>
              {bulkMsg.text}
            </span>
          )}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center">
          {rows.length === 0 ? (
            <>
              <p className="text-white/60">The concept bank is empty.</p>
              <p className="mt-1 text-sm text-white/40">Brainstorm in Ideate or create a concept by hand to get started.</p>
              <div className="mt-4 flex justify-center gap-2">
                <Link href="/ideate" className="rounded-lg bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-black hover:bg-emerald-300">Open Ideate</Link>
                <Link href="/concepts/new" className="rounded-lg border border-white/20 px-3.5 py-2 text-sm hover:bg-white/10">New concept</Link>
              </div>
            </>
          ) : (
            <p className="text-white/60">No concepts match these filters.</p>
          )}
        </div>
      )}

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
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(r.id); }}
                    onChange={() => {}}
                    aria-label={`Select ${r.hook_line ?? "concept"}`}
                    className="h-4 w-4 flex-shrink-0 accent-emerald-400"
                  />
                  {r.sheet_id && <span className="font-mono text-[11px] text-white/40">{r.sheet_id}</span>}
                  <span className="text-[11.5px] uppercase tracking-wide text-white/50">{r.family}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[r.idea_status] ?? ""}`}>
                    {r.idea_status}
                  </span>
                </div>
                <h3 className="flex-1 text-[17px] font-semibold leading-snug text-gray-100">“{r.hook_line}”</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {r.hook_angle && <span className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-white/75">{r.hook_angle}</span>}
                  {r.sport && <span className="text-xs text-white/50">{r.sport}</span>}
                  {r.in_cycle && <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-300">Scheduled</span>}
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
        <div className="overflow-x-auto rounded-[12px] border border-white/10">
        <div className="min-w-[880px]">
          <div className="grid grid-cols-[28px_64px_1.4fr_2.2fr_1fr_0.9fr_120px_150px] gap-3 border-b border-white/10 bg-white/[0.04] px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-wide text-white/45">
            <span /><span>#</span><span>Family</span><span>Hook</span><span>Angle</span><span>Sport</span><span>Status</span><span>Signal</span>
          </div>
          {filtered.map((r) => {
            const foot = footerFor(r);
            return (
              <Link
                key={r.id}
                href={`/creatives/${r.id}`}
                className="grid grid-cols-[28px_64px_1.4fr_2.2fr_1fr_0.9fr_120px_150px] items-center gap-3 border-b border-white/[0.06] px-4 py-2.5 text-[13px] last:border-0 hover:bg-white/[0.04]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle(r.id); }}
                  onChange={() => {}}
                  aria-label={`Select ${r.hook_line ?? "concept"}`}
                  className="h-4 w-4 accent-emerald-400"
                />
                <span className="font-mono text-[11px] text-white/40">{r.sheet_id}</span>
                <span className="truncate text-white/80">
                  {r.family}
                  {r.is_proven && <span className="ml-1.5 text-emerald-300" title="Proven">✓</span>}
                </span>
                <span className="truncate text-gray-100">{r.hook_line}</span>
                <span className="truncate text-white/60">{r.hook_angle}</span>
                <span className="truncate text-white/55">{r.sport}</span>
                <span className="flex items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[r.idea_status] ?? ""}`}>{r.idea_status}</span>
                  {r.in_cycle && <span className="text-sky-300" role="img" aria-label="Scheduled into a cycle" title="Scheduled into a cycle">◷</span>}
                </span>
                <span className="flex items-center gap-2 truncate text-[12px]" style={{ color: foot.color }}>
                  <span className="h-[6px] w-[6px] flex-shrink-0 rounded-full" style={{ background: foot.color }} />
                  {foot.label}
                </span>
              </Link>
            );
          })}
        </div>
        </div>
      )}
    </div>
  );
}
