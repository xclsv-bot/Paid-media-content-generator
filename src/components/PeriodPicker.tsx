"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Weekly / Monthly switch for the Performance page, plus a picker for which
// week (flight) or month to show. State lives in the URL so views are
// shareable and the back button works.
export default function PeriodPicker({
  view,
  weeks,
  months,
  currentWeek,
  currentMonth,
}: {
  view: "week" | "month";
  weeks: string[];
  months: { key: string; label: string }[];
  currentWeek: string | null;
  currentMonth: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function push(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`?${params.toString()}`);
    router.refresh();
  }

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <div className="flex gap-1 rounded-lg border border-white/10 bg-black/20 p-1 text-sm" role="tablist">
        {(["week", "month"] as const).map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            onClick={() => push((p) => { p.set("view", v); })}
            className={`rounded-md px-3 py-1.5 ${view === v ? "bg-white/10 font-medium text-white" : "text-white/50 hover:text-white"}`}
          >
            {v === "week" ? "Weekly report" : "Monthly totals"}
          </button>
        ))}
      </div>

      {view === "week" ? (
        <select
          value={currentWeek ?? ""}
          onChange={(e) => push((p) => { p.set("flight", e.target.value); })}
          aria-label="Which week to show"
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white/80 focus:border-emerald-400/50 focus:outline-none"
        >
          {weeks.map((w) => (
            <option key={w} value={w}>{w}</option>
          ))}
        </select>
      ) : (
        <select
          value={currentMonth ?? ""}
          onChange={(e) => push((p) => { p.set("month", e.target.value); })}
          aria-label="Which month to show"
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-white/80 focus:border-emerald-400/50 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key}>{m.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}
