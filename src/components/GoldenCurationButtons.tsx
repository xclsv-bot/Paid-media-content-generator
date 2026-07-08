"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Staff curation for a golden example (PATCH /api/golden/:creativeId).
//   pin     — freeze it against refresh drift (optionally rewrite why-it-won)
//   remove  — tombstone it: hidden from prompts AND immune to auto-populate
//   restore — hand it back to the auto pool; next refresh re-judges it
export default function GoldenCurationButtons({
  creativeId,
  status,
}: {
  creativeId: string;
  status: "active" | "pinned" | "removed";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: "pin" | "remove" | "restore") {
    if (busy) return;
    let why: string | undefined;
    if (action === "pin") {
      const input = window.prompt(
        "Pin this example. Optionally rewrite the why-it-won (leave blank to keep the current one):",
        "",
      );
      if (input === null) return; // cancelled
      why = input.trim() || undefined;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/golden/${creativeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(why ? { why_it_won: why } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "rounded-md border border-white/15 px-2 py-0.5 text-[11.5px] text-white/75 hover:border-white/40 disabled:opacity-40";

  return (
    <span className="inline-flex items-center gap-1.5">
      {status === "active" && (
        <>
          <button className={btn} disabled={busy} onClick={() => act("pin")}>Pin</button>
          <button className={btn} disabled={busy} onClick={() => act("remove")}>Remove</button>
        </>
      )}
      {status === "pinned" && (
        <>
          <button className={btn} disabled={busy} onClick={() => act("restore")}>Unpin</button>
          <button className={btn} disabled={busy} onClick={() => act("remove")}>Remove</button>
        </>
      )}
      {status === "removed" && (
        <button className={btn} disabled={busy} onClick={() => act("restore")}>Restore</button>
      )}
      {err && <span className="text-[11px] text-red-300">{err}</span>}
    </span>
  );
}
