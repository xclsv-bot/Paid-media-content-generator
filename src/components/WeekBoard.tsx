"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type Cycle = {
  id: string;
  label: string;
  starts_on: string;
  ends_on: string;
  target_count: number;
  status: string;
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
};
export type Person = { id: string; name: string | null; role: string };
export type Available = { id: string; sheet_id: string | null; hook_line: string | null; family: string | null };

const PROD_STATUSES = ["Assigned", "In production", "Submitted", "In revision", "Approved", "Delivered"];
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
}: {
  cycles: Cycle[];
  selected: Cycle | null;
  deliverables: Deliverable[];
  people: Person[];
  available: Available[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

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
  });

  async function createCycle() {
    setBusy(true);
    try {
      const res = await fetch("/api/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setShowNew(false);
      router.push(`/this-week?cycle=${json.cycle.id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    if (!selected) return;
    setBusy(true);
    try {
      await fetch(`/api/cycles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patchDeliverable(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/deliverables/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    router.refresh();
  }

  async function removeDeliverable(id: string) {
    await fetch(`/api/deliverables/${id}`, { method: "DELETE" });
    router.refresh();
  }

  async function addPicked() {
    if (!selected || picked.size === 0) return;
    setBusy(true);
    try {
      await fetch(`/api/cycles/${selected.id}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptIds: [...picked] }),
      });
      setPicked(new Set());
      setShowAdd(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const sel = "rounded border border-white/10 bg-black/30 px-2 py-1 text-sm";
  const count = deliverables.length;
  const target = selected?.target_count ?? 15;
  const pct = Math.min(100, Math.round((count / target) * 100));

  if (cycles.length === 0) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
        <p className="text-white/60">No cycles yet. Create your first weekly drop.</p>
        <button onClick={() => setShowNew(true)} className="mt-3 rounded-lg bg-emerald-500/90 px-4 py-2 text-sm font-medium text-black">
          New cycle
        </button>
        {showNew && <NewCycleForm form={form} setForm={setForm} onCreate={createCycle} busy={busy} sel={sel} />}
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
            <span className="text-sm text-white/50">{selected.starts_on} → {selected.ends_on}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${selected.status === "Active" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/10 text-white/60"}`}>
              {selected.status}
            </span>
            {selected.status !== "Active" && (
              <button onClick={() => setStatus("Active")} disabled={busy} className="rounded-lg border border-white/20 px-2 py-1 text-xs hover:bg-white/10">Make active</button>
            )}
            {selected.status === "Active" && (
              <button onClick={() => setStatus("Closed")} disabled={busy} className="rounded-lg border border-white/20 px-2 py-1 text-xs hover:bg-white/10">Close</button>
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

      {showNew && <NewCycleForm form={form} setForm={setForm} onCreate={createCycle} busy={busy} sel={sel} />}

      {showAdd && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Add concepts to this cycle</h3>
            <button onClick={addPicked} disabled={busy || picked.size === 0} className="rounded-lg bg-emerald-500/90 px-3 py-1 text-sm font-medium text-black disabled:opacity-40">
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
            <col className="w-24" />
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
            {deliverables.map((d) => (
              <tr key={d.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-3 py-2 text-white/50">{d.sheet_id}</td>
                <td className="px-3 py-2">
                  <div className="truncate" title={d.hook_line ?? undefined}>{d.hook_line}</div>
                  <div className="truncate text-xs text-white/40">{d.family} · {d.hook_angle}</div>
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
                <td className="px-3 py-2 text-center">{d.has_video ? <span className="text-emerald-400">✓</span> : <span className="text-white/30">—</span>}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-3 whitespace-nowrap">
                    <Link href={`/creatives/${d.concept_id}`} className="text-emerald-400 hover:underline">Open</Link>
                    <button onClick={() => removeDeliverable(d.id)} className="text-white/30 hover:text-red-300" aria-label="Remove from cycle">✕</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewCycleForm({
  form, setForm, onCreate, busy, sel,
}: {
  form: { label: string; starts_on: string; ends_on: string; target_count: number };
  setForm: (f: { label: string; starts_on: string; ends_on: string; target_count: number }) => void;
  onCreate: () => void;
  busy: boolean;
  sel: string;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm">
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
      <button onClick={onCreate} disabled={busy} className="rounded-lg bg-emerald-500/90 px-4 py-2 font-medium text-black disabled:opacity-50">Create</button>
    </div>
  );
}
