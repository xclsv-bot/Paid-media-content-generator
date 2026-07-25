"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtDay } from "@/lib/client/format";

export type Cycle = {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  target_count: number;
  status: string;
  org_id: string;
};
export type Deliverable = {
  id: string;
  concept_id: string;
  sheet_id: string | null;
  ad_name: string | null;
  family: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  assignee_id: string | null;
  due_date: string | null;
  production_status: string;
  has_video: boolean;
  reported: boolean;
  cpt: number | null;
  hit: boolean | null;
};

type PerfFilter = "all" | "hit" | "miss" | "none";
const PERF_LABEL: Record<PerfFilter, string> = { all: "All", hit: "Hit", miss: "Miss", none: "No metrics" };
function matchesPerf(d: Deliverable, f: PerfFilter): boolean {
  if (f === "all") return true;
  if (f === "hit") return d.hit === true;
  if (f === "miss") return d.hit === false;
  return d.cpt == null;
}
// The row's performance one-liner, mirroring the Ideas signal footer.
function perfLine(d: Deliverable): { label: string; cls: string } | null {
  if (d.cpt != null) {
    return {
      label: `CPT $${d.cpt.toFixed(2)} · ${d.hit ? "Hit" : "Miss"}`,
      cls: d.hit ? "text-emerald-300" : "text-red-300",
    };
  }
  if (d.reported) return { label: "Reported · no trials yet", cls: "text-amber-300/90" };
  return null;
}
export type Person = { id: string; name: string | null; role: string };
export type Available = { id: string; sheet_id: string | null; hook_line: string | null; family: string | null };
export type Organization = { id: string; slug: string; display_name: string };

import { PROD_STATUSES } from "@/lib/deliverables";
import { parseNamingConvention } from "@/lib/client/categorize";

// Backfill helper: turn a pasted Drive filename into the ad-name convention.
// Accepts | or _ separators, strips stacked extensions ("....mp4.mp4").
function normalizeAdName(raw: string): string {
  return raw
    .trim()
    .replace(/(\.(mp4|mov|m4v|webm))+$/i, "")
    .replace(/\s*\|\s*/g, " _ ")
    .replace(/\s*_\s*/g, " _ ")
    .trim();
}
// Readable default title: the name minus the leading brand tokens.
function titleFromAdName(ad: string): string {
  const parts = ad.split(" _ ").filter(Boolean);
  const body = parts.slice(2);
  return (body.length ? body : parts).join(" · ");
}
const STATUS_STYLE: Record<string, string> = {
  Assigned: "text-white/60",
  "In production": "text-sky-300",
  Submitted: "text-violet-300",
  "In revision": "text-amber-300",
  Approved: "text-emerald-300",
  Delivered: "text-emerald-400",
};

export default function WeekBoard({
  cycles,
  selected,
  deliverables,
  people,
  available,
  organizations,
}: {
  cycles: Cycle[];
  selected: Cycle | null;
  deliverables: Deliverable[];
  people: Person[];
  available: Available[];
  organizations: Organization[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [perf, setPerf] = useState<PerfFilter>("all");
  const [renaming, setRenaming] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickLink, setQuickLink] = useState("");
  const [quickMsg, setQuickMsg] = useState<string | null>(null);

  // Create a concept from a pasted Drive filename and land it in this week.
  async function quickCreate() {
    if (!selected || busy) return;
    const ad = normalizeAdName(quickName);
    if (!ad) return;
    const parsed = parseNamingConvention(ad);
    setBusy(true);
    setQuickMsg(null);
    try {
      const ok = await act("Creating the concept", () =>
        fetch("/api/concepts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            org_id: selected.org_id,
            hook_line: titleFromAdName(ad),
            ad_name: ad,
            sport: parsed.sport ?? null,
            format: parsed.format ?? null,
            idea_status: "Testing",
            cycle_id: selected.id,
            reference_url: quickLink.trim() || undefined,
            // Backfill titles are mechanical; skip the golden-duplicate gate.
            allow_duplicate: true,
          }),
        }),
      );
      if (ok) {
        setQuickMsg(`Added “${titleFromAdName(ad)}” ✓ — paste the next one`);
        setQuickName("");
        setQuickLink("");
      }
    } finally {
      setBusy(false);
    }
  }

  async function renameCycle() {
    if (!selected || !labelDraft.trim()) return;
    setBusy(true);
    try {
      const ok = await act("Renaming the cycle", () =>
        fetch(`/api/cycles/${selected.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: labelDraft.trim() }),
        }),
      );
      if (ok) setRenaming(false);
    } finally {
      setBusy(false);
    }
  }

  // new-cycle form defaults: this week
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() + 6);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [form, setForm] = useState({
    label: `Week of ${today.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    starts_on: iso(today),
    ends_on: iso(end),
    target_count: 15,
    org_id: organizations[0]?.id ?? "",
  });
  const [newCycleErr, setNewCycleErr] = useState<string | null>(null);

  async function createCycle() {
    if (!form.org_id) { setNewCycleErr("A client is required."); return; }
    setNewCycleErr(null);
    setBusy(true);
    try {
      const res = await fetch("/api/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Couldn't create the cycle");
      setShowNew(false);
      if (json.cycle?.id) router.push(`/this-week?cycle=${json.cycle.id}`);
      router.refresh();
    } catch (e) {
      setNewCycleErr(e instanceof Error ? e.message : "Couldn't create the cycle");
    } finally {
      setBusy(false);
    }
  }

  // Run a mutation, surface its failure in the shared error line (a silent
  // failure here reads as a successful save).
  async function act(label: string, fn: () => Promise<Response>) {
    setActionErr(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? `${label} failed`);
      }
      router.refresh();
      return true;
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : `${label} failed`);
      return false;
    }
  }

  async function setStatus(status: string) {
    if (!selected) return;
    setBusy(true);
    try {
      await act("Updating the cycle", () =>
        fetch(`/api/cycles/${selected.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        }),
      );
    } finally {
      setBusy(false);
    }
  }

  async function patchDeliverable(id: string, patch: Record<string, unknown>) {
    await act("Saving", () =>
      fetch(`/api/deliverables/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  }

  async function removeDeliverable(id: string) {
    setConfirmRemove(null);
    await act("Removing", () => fetch(`/api/deliverables/${id}`, { method: "DELETE" }));
  }

  async function addPicked() {
    if (!selected || picked.size === 0) return;
    setBusy(true);
    try {
      const ok = await act("Adding concepts", () =>
        fetch(`/api/cycles/${selected.id}/deliverables`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conceptIds: [...picked] }),
        }),
      );
      if (ok) {
        setPicked(new Set());
        setShowAdd(false);
      }
    } finally {
      setBusy(false);
    }
  }

  const sel = "rounded border border-white/10 bg-black/30 px-2 py-1 text-sm";
  // Weeks a row can move to: same client, any other cycle.
  const moveTargets = selected
    ? cycles.filter((c) => c.org_id === selected.org_id && c.id !== selected.id)
    : [];
  const anyReported = deliverables.some((d) => d.reported);
  const visible = deliverables.filter((d) => matchesPerf(d, perf));
  const count = deliverables.length;
  const target = selected?.target_count ?? 15;
  const pct = Math.min(100, Math.round((count / target) * 100));

  if (cycles.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-white/60">No cycles yet. Create your first weekly drop.</p>
        <button onClick={() => setShowNew(true)} className="mt-3 rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-300">
          New cycle
        </button>
        {showNew && <NewCycleForm form={form} setForm={setForm} onCreate={createCycle} busy={busy} sel={sel} organizations={organizations} err={newCycleErr} />}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selected?.id ?? ""}
          onChange={(e) => { router.push(`/this-week?cycle=${e.target.value}`); router.refresh(); }}
          className={sel}
        >
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>{c.label} · {c.status}</option>
          ))}
        </select>
        {selected && (
          <>
            <span className="text-sm text-white/50">{fmtDay(selected.starts_on)} → {fmtDay(selected.ends_on)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${selected.status === "Active" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/60"}`}>
              {selected.status}
            </span>
            {selected.status !== "Active" && (
              <button onClick={() => setStatus("Active")} disabled={busy} className="rounded-lg border border-white/20 px-2 py-1 text-xs hover:bg-white/10">Make active</button>
            )}
            {selected.status === "Active" && (
              <button onClick={() => setStatus("Closed")} disabled={busy} className="rounded-lg border border-white/20 px-2 py-1 text-xs hover:bg-white/10">Close</button>
            )}
            {renaming ? (
              <span className="flex items-center gap-1.5">
                <input
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") renameCycle(); if (e.key === "Escape") setRenaming(false); }}
                  autoFocus
                  aria-label="New cycle name"
                  className="w-44 rounded border border-white/10 bg-black/30 px-2 py-1 text-xs"
                />
                <button onClick={renameCycle} disabled={busy || !labelDraft.trim()} className="rounded-lg bg-emerald-400 px-2 py-1 text-xs font-semibold text-black hover:bg-emerald-300 disabled:opacity-40">Save</button>
                <button onClick={() => setRenaming(false)} disabled={busy} className="text-xs text-white/40 hover:text-white">Cancel</button>
              </span>
            ) : (
              <button
                onClick={() => { setLabelDraft(selected.label); setRenaming(true); }}
                disabled={busy}
                className="rounded-lg border border-white/20 px-2 py-1 text-xs hover:bg-white/10"
              >
                Rename
              </button>
            )}
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowAdd((s) => !s)} className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">+ Add concepts</button>
          <button onClick={() => setShowNew((s) => !s)} className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10">New cycle</button>
        </div>
      </div>

      {/* progress */}
      <div>
        <div className="mb-1 flex justify-between text-xs text-white/50">
          <span>{count} of {target}</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-emerald-500/80" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {showNew && <NewCycleForm form={form} setForm={setForm} onCreate={createCycle} busy={busy} sel={sel} organizations={organizations} err={newCycleErr} />}

      {showAdd && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          {/* Quick-create from a Drive filename — for organizing weeks backwards */}
          <div className="mb-4 border-b border-white/10 pb-4">
            <h3 className="mb-1 text-sm font-medium">Quick-create from a video name</h3>
            <p className="mb-2 text-xs text-white/45">
              Paste the Drive filename (| or _ separators both work). It becomes the ad name — metrics join to it automatically — with a short title derived from it. Drive link optional.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                value={quickName}
                onChange={(e) => setQuickName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") quickCreate(); }}
                placeholder="XCLSV | XCLSV | WNBA | Video | No Face | Winning | 16s | 07.24.26"
                className={`${sel} min-w-[280px] flex-1 font-mono text-xs`}
              />
              <input
                value={quickLink}
                onChange={(e) => setQuickLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") quickCreate(); }}
                placeholder="Drive link (optional)"
                className={`${sel} w-52 text-xs`}
              />
              <button
                onClick={quickCreate}
                disabled={busy || !quickName.trim()}
                className="rounded-lg bg-emerald-400 px-3 py-1 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-40"
              >
                Create & add
              </button>
            </div>
            {quickMsg && <p className="mt-2 text-xs text-emerald-300">{quickMsg}</p>}
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Add existing concepts</h3>
            <button onClick={addPicked} disabled={busy || picked.size === 0} className="rounded-lg bg-emerald-400 px-3 py-1 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-40">
              Add {picked.size || ""}
            </button>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
            {available.length === 0 && <p className="text-white/40">All concepts are already in this cycle.</p>}
            {available.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white/5">
                <input
                  type="checkbox"
                  checked={picked.has(a.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(a.id); else next.delete(a.id);
                    setPicked(next);
                  }}
                />
                <span className="text-white/50">#{a.sheet_id}</span>
                <span className="text-white/40">{a.family}</span>
                <span className="truncate">{a.hook_line}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {actionErr && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{actionErr}</p>
      )}

      {/* performance filter — appears once any row has reported metrics */}
      {anyReported && (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="mr-1 text-xs text-white/40">Performance:</span>
          {(["all", "hit", "miss", "none"] as PerfFilter[]).map((f) => {
            const n = f === "all" ? deliverables.length : deliverables.filter((d) => matchesPerf(d, f)).length;
            return (
              <button
                key={f}
                onClick={() => setPerf(f)}
                className={`rounded-lg border px-2.5 py-1 text-[12.5px] ${
                  perf === f
                    ? "border-emerald-400 bg-emerald-400 font-semibold text-black"
                    : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/10"
                }`}
              >
                {PERF_LABEL[f]} <span className="opacity-60">{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* table */}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-10" />
            <col />
            <col className="w-40" />
            <col className="w-36" />
            <col className="w-36" />
            <col className="w-14" />
            <col className="w-44" />
          </colgroup>
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Concept</th>
              <th className="px-3 py-2">Assignee</th>
              <th className="px-3 py-2">Due</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-center">Video</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deliverables.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-white/40">No concepts in this cycle yet — use “Add concepts”.</td></tr>
            )}
            {deliverables.length > 0 && visible.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-white/40">No rows match the “{PERF_LABEL[perf]}” performance filter.</td></tr>
            )}
            {visible.map((d) => {
              const p = perfLine(d);
              return (
              <tr key={d.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-3 py-2 text-white/50">{d.sheet_id}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/creatives/${d.concept_id}`}
                    className="block truncate hover:text-emerald-300 hover:underline"
                    title={d.hook_line ?? undefined}
                  >
                    {d.hook_line}
                  </Link>
                  <div className="truncate text-xs text-white/40">
                    {d.family} · {d.hook_angle}
                    {p && <span className={`ml-2 ${p.cls}`}>{p.label}</span>}
                  </div>
                  {d.ad_name && (
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-white/35" title={d.ad_name}>{d.ad_name}</div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select value={d.assignee_id ?? ""} onChange={(e) => patchDeliverable(d.id, { assignee_id: e.target.value })} className={`${sel} w-full`}>
                    <option value="">—</option>
                    {people.map((p) => <option key={p.id} value={p.id}>{p.name ?? "user"} ({p.role})</option>)}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input type="date" value={d.due_date ?? ""} onChange={(e) => patchDeliverable(d.id, { due_date: e.target.value })} className={`${sel} w-full`} />
                </td>
                <td className="px-3 py-2">
                  <select value={d.production_status} onChange={(e) => patchDeliverable(d.id, { production_status: e.target.value })} className={`${sel} w-full ${STATUS_STYLE[d.production_status] ?? ""}`}>
                    {PROD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-center">{d.has_video ? <span className="text-emerald-400" role="img" aria-label="Has video">✓</span> : <span className="text-white/30" role="img" aria-label="No video yet">—</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    {moveTargets.length > 0 && (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) patchDeliverable(d.id, { cycle_id: e.target.value }); }}
                        aria-label="Move to another week"
                        className="w-20 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-xs text-white/60"
                      >
                        <option value="">Move…</option>
                        {moveTargets.map((c) => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    )}
                    {confirmRemove === d.id ? (
                      <span className="flex items-center gap-1.5 text-xs">
                        <button onClick={() => removeDeliverable(d.id)} className="rounded bg-red-500/20 px-1.5 py-0.5 text-red-300 hover:bg-red-500/30">Remove</button>
                        <button onClick={() => setConfirmRemove(null)} className="text-white/40 hover:text-white">Keep</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmRemove(d.id)} className="text-white/30 hover:text-red-300" aria-label="Remove from cycle">✕</button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewCycleForm({
  form, setForm, onCreate, busy, sel, organizations, err,
}: {
  form: { label: string; starts_on: string; ends_on: string; target_count: number; org_id: string };
  setForm: (f: { label: string; starts_on: string; ends_on: string; target_count: number; org_id: string }) => void;
  onCreate: () => void;
  busy: boolean;
  sel: string;
  organizations: Organization[];
  err: string | null;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/40">Client</span>
        <select value={form.org_id} onChange={(e) => setForm({ ...form, org_id: e.target.value })} className={sel}>
          <option value="">—</option>
          {organizations.map((o) => <option key={o.id} value={o.id}>{o.display_name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/40">Label</span>
        <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} className={`${sel} w-44`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/40">Starts</span>
        <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} className={sel} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/40">Ends</span>
        <input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} className={sel} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/40">Target</span>
        <input type="number" value={form.target_count} onChange={(e) => setForm({ ...form, target_count: Number(e.target.value) })} className={`${sel} w-20`} />
      </label>
      <button onClick={onCreate} disabled={busy} className="rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-black hover:bg-emerald-300 disabled:opacity-50">Create</button>
      {err && <p className="w-full text-xs text-red-300">{err}</p>}
    </div>
  );
}
