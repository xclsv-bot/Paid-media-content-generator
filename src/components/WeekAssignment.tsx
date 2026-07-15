"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type WeekCycle = { id: string; label: string; status: string };
export type WeekSlot = { id: string; cycle_id: string; assignee_id: string | null };
export type WeekPerson = { id: string; name: string | null; role: string };

// Staff-only rail card on the concept page: shows which week(s) this concept
// is scheduled in, moves a slot to another week (videos/assignee ride along),
// assigns the creator, or schedules an unplanned concept into a week.
export default function WeekAssignment({
  conceptId,
  slots,
  cycles,
  people,
}: {
  conceptId: string;
  slots: WeekSlot[];
  cycles: WeekCycle[];
  people: WeekPerson[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const labelOf = (id: string) => cycles.find((c) => c.id === id)?.label ?? "Unknown week";

  async function run(fn: () => Promise<Response>) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fn();
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error ?? "Couldn't save");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  }

  const patch = (slotId: string, body: Record<string, unknown>) =>
    run(() =>
      fetch(`/api/deliverables/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  const addTo = (cycleId: string) =>
    run(() =>
      fetch(`/api/cycles/${cycleId}/deliverables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptIds: [conceptId] }),
      }),
    );

  const sel = "w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-[13px] text-white/80";
  const tag = "mb-1 font-mono text-[9.5px] uppercase tracking-wide text-white/40";

  return (
    <div className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-wide text-white/45">Week & creator</div>
      {slots.length === 0 ? (
        <>
          <p className="mb-2 text-[12.5px] text-white/40">
            Not scheduled into a week yet — schedule it to assign a creator.
          </p>
          {cycles.length > 0 && (
            <select
              value=""
              disabled={busy}
              onChange={(e) => { if (e.target.value) addTo(e.target.value); }}
              aria-label="Add to a week"
              className={sel}
            >
              <option value="">Add to a week…</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>{c.label} · {c.status}</option>
              ))}
            </select>
          )}
        </>
      ) : (
        <div className="flex flex-col gap-3">
          {slots.map((s) => (
            <div key={s.id} className="flex flex-col gap-2">
              <div>
                <div className={tag}>Week</div>
                <select
                  value={s.cycle_id}
                  disabled={busy}
                  onChange={(e) => { if (e.target.value !== s.cycle_id) patch(s.id, { cycle_id: e.target.value }); }}
                  aria-label="Move to another week"
                  className={sel}
                >
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>{c.label} · {c.status}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className={tag}>Creator</div>
                <select
                  value={s.assignee_id ?? ""}
                  disabled={busy}
                  onChange={(e) => patch(s.id, { assignee_id: e.target.value })}
                  aria-label="Assign a creator"
                  className={sel}
                >
                  <option value="">Unassigned</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>{p.name ?? "user"} ({p.role})</option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-[12px] text-red-300">{err}</p>}
    </div>
  );
}
