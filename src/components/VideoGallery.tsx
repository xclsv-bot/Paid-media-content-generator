"use client";

import { useState } from "react";
import VideoAssetCard from "@/components/VideoAssetCard";

export type GalleryVideo = {
  id: string;
  fileName: string;
  versionLabel: string;
  streamUrl: string | null;
  canDelete?: boolean;
  transcript?: string | null;
  transcriptStatus?: string | null;
};

// Collapsible video section. Full players stacked inline made the queue and
// review pages scroll forever, so cuts sit behind a one-line summary row and
// expand on demand.
export default function VideoGallery({
  videos,
  defaultOpen = false,
  columns = 2,
}: {
  videos: GalleryVideo[];
  defaultOpen?: boolean;
  columns?: 1 | 2;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (videos.length === 0) return null;
  const latest = videos[0];

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
      >
        <span aria-hidden className="text-white/50">{open ? "▾" : "▸"}</span>
        <span className="font-medium">
          {videos.length} cut{videos.length === 1 ? "" : "s"}
        </span>
        <span className="min-w-0 truncate text-white/40">
          · latest {latest.versionLabel} · {latest.fileName}
        </span>
        <span className="ml-auto flex-shrink-0 text-xs text-white/35">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className={`mt-3 grid gap-3 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
          {videos.map((v) => (
            <VideoAssetCard
              key={v.id}
              id={v.id}
              fileName={v.fileName}
              versionLabel={v.versionLabel}
              streamUrl={v.streamUrl}
              canDelete={v.canDelete}
              transcript={v.transcript}
              transcriptStatus={v.transcriptStatus}
            />
          ))}
        </div>
      )}
    </div>
  );
}
