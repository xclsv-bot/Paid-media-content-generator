"use client";

import { useState } from "react";

// The creative's Meta ad name (the naming convention) shown as a copyable chip —
// so staff/clients can match a dashboard item to the exact ad in Ads Manager.
export default function AdNameTag({
  name,
  className = "",
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!name) return null;

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(name!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the name is still visible to select manually */
    }
  }

  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className="font-mono text-[9.5px] uppercase tracking-wide text-white/35">Ad</span>
      <code
        className="min-w-0 flex-1 truncate rounded bg-white/[0.06] px-2 py-1 font-mono text-[11.5px] text-white/70"
        title={name}
      >
        {name}
      </code>
      <button
        onClick={copy}
        className="shrink-0 rounded border border-white/15 px-1.5 py-1 text-[10.5px] text-white/50 hover:bg-white/10"
        aria-label="Copy ad name"
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}
