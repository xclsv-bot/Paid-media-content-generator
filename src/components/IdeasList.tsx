"use client";

import { useMemo, useState } from "react";
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
};

const IDEA_STATUSES = ["Backlog", "Testing", "Winner", "Parked"];

const STATUS_STYLE: Record<string, string> = {
  Winner: "bg-emerald-500/20 text-emerald-300",
  Testing: "bg-sky-500/20 text-sky-300",
  Backlog: "bg-white/10 text-white/60",
  Parked: "bg-amber-500/20 text-amber-300",
};

function uniq(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

export default function IdeasList({ rows }: { rows: IdeaRow[] }) {
  const [q, setQ] = useState("");
  const [family, setFamily] = useState("");
  const [status, setStatus] = useState("");
  const [archetype, setArchetype] = useState("");
  const [sport, setSport] = useState("");
  const [hook, setHook] = useState("");

  const families = useMemo(() => uniq(rows.map((r) => r.family)), [rows]);
  const sports = useMemo(() => uniq(rows.map((r) => r.sport)), [rows]);
  const hooks = useMemo(() => uniq(rows.map((r) => r.hook_angle)), [rows]);

  const filtered = rows.filter((r) => {
    if (family && r.family !== family) return false;
    if (status && r.idea_status !== status) return false;
    if (archetype && r.archetype !== archetype) return false;
    if (sport && r.sport !== sport) return false;
    if (hook && r.hook_angle !== hook) return false;
    if (q && !(`${r.hook_line ?? ""} ${r.family ?? ""}`.toLowerCase().includes(q.toLowerCase())))
      return false;
    return true;
  });

  const sel = "rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-sm";

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search hook…"
          className={`${sel} w-44`}
        />
        <select value={family} onChange={(e) => setFamily(e.target.value)} className={sel}>
          <option value="">All families</option>
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={sel}>
          <option value="">Any status</option>
          {IDEA_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={archetype} onChange={(e) => setArchetype(e.target.value)} className={sel}>
          <option value="">Any archetype</option>
          <option value="Qualifier">Qualifier</option>
          <option value="Broad-appeal">Broad-appeal</option>
          <option value="Mixed">Mixed</option>
        </select>
        <select value={sport} onChange={(e) => setSport(e.target.value)} className={sel}>
          <option value="">Any sport</option>
          {sports.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={hook} onChange={(e) => setHook(e.target.value)} className={sel}>
          <option value="">Any hook angle</option>
          {hooks.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="ml-auto text-sm text-white/40">{filtered.length} of {rows.length}</span>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-white/60">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Family</th>
              <th className="px-3 py-2">Hook</th>
              <th className="px-3 py-2">Hook angle</th>
              <th className="px-3 py-2">Sport</th>
              <th className="px-3 py-2">Idea</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-white/5 hover:bg-white/5">
                <td className="px-3 py-2 text-white/50">{r.sheet_id}</td>
                <td className="px-3 py-2">
                  {r.family}
                  {r.is_proven && <span className="ml-1 text-emerald-400">✓</span>}
                </td>
                <td className="max-w-xs truncate px-3 py-2">{r.hook_line}</td>
                <td className="px-3 py-2 text-white/60">{r.hook_angle}</td>
                <td className="px-3 py-2 text-white/70">{r.sport}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[r.idea_status] ?? ""}`}>
                    {r.idea_status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <Link href={`/creatives/${r.id}`} className="text-emerald-400 hover:underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
