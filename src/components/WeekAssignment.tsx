"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type WeekCycle = { id: string; label: string; status: string };
export type WeekSlot = { id: string; cycle_id: string };

// Staff-only rail card on the concept page: shows which week(s) this concept
// is scheduled in, moves a slot to another week (videos/assignee ride along),
// or schedules an unplanned concept into a week.
export default function WeekAssignment({
  conceptId,
  slots,
  cycles,
}: {
  conceptId: string;
  slots: WeekSlot[];
  cycles: WeekCycle[];
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
        throw new Error(j?.error ?? "Couldn't update the week");
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't update the week");
    } finally {
      setBusy(false);
    }
  }

  const move = (slotId: string, cycleId: string) =>
    run(() =>
      fetch(`/api/deliverables/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycle_id: cycleId }),
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

  return (
    <div className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-4">
      <div className="mb-3 font-mono text-[11px] uppercase tracking-wide text-white/45">Week</div>
      {slots.length === 0 ? (
        <>
          <p className="mb-2 text-[12.5px] text-white/40">Not scheduled into a week yet.</p>
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
        <div className="flex flex-col gap-2">
          {slots.map((s) => (
            <div key={s.id}>
              <div className="mb-1 text-[13px] text-white/80">{labelOf(s.cycle_id)}</div>
              <select
                value={s.cycle_id}
                disabled={busy}
                onChange={(e) => { if (e.target.value !== s.cycle_id) move(s.id, e.target.value); }}
                aria-label="Move to another week"
                className={sel}
              >
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>{c.label} · {c.status}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
      {err && <p className="mt-2 text-[12px] text-red-300">{err}</p>}
    </div>
  );
}
