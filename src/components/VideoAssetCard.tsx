"use client";

import { useState } from "react";

export default function VideoAssetCard({
  id,
  fileName,
  versionLabel,
  streamUrl,
}: {
  id: string;
  fileName: string;
  versionLabel: string;
  streamUrl: string | null;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      // Server checks RLS (client is allowed) and mints an attachment URL of the
      // original master file — what the partner uploads into Meta Ads Manager.
      const res = await fetch(`/api/videos/${id}/download`);
      if (!res.ok) throw new Error("Download failed");
      const { url } = await res.json();
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      {streamUrl ? (
        <video
          src={streamUrl}
          controls
          className="aspect-[9/16] w-full rounded-lg bg-black"
        />
      ) : (
        <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg bg-black text-xs text-white/40">
          preview unavailable
        </div>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm">{fileName}</div>
          <div className="text-xs text-white/40">{versionLabel}</div>
        </div>
        <button
          onClick={download}
          disabled={busy}
          className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
        >
          {busy ? "…" : "Download"}
        </button>
      </div>
    </div>
  );
}
