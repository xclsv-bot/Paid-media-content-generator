"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import VideoGallery, { type GalleryVideo } from "@/components/VideoGallery";
import ReviewCard, { type ReviewComment } from "@/components/ReviewCard";

export type ReviewItem = {
  id: string;
  family: string | null;
  hook: string | null;
  videos: GalleryVideo[];
  state: string;
  comments: ReviewComment[];
};

// The review queue with multi-select: tick cards, approve them in one go.
// Individual approve/request-changes still lives on each card.
export default function ReviewBoard({
  items,
  currentUserId,
}: {
  items: ReviewItem[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected = items.length > 0 && selected.size === items.length;

  async function approveSelected() {
    if (selected.size === 0 || busy) return;
    setBusy(true);
    setErr(null);
    const results = await Promise.all(
      [...selected].map(async (id) => {
        const res = await fetch(`/api/creatives/${id}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "Approved" }),
        }).catch(() => null);
        return { id, ok: res?.ok ?? false };
      }),
    );
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      setErr(`Couldn't approve ${failed.length} of ${results.length} — they're still in the list, try again.`);
      setSelected(new Set(failed.map((r) => r.id)));
    } else {
      setSelected(new Set());
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm">
        <label className="flex cursor-pointer items-center gap-2 text-white/70">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)))}
            className="h-4 w-4 accent-emerald-400"
          />
          Select all
        </label>
        <span className="text-white/40">{selected.size} selected</span>
        <button
          onClick={approveSelected}
          disabled={busy || selected.size === 0}
          className="ml-auto rounded-lg bg-emerald-400 px-3.5 py-1.5 font-semibold text-black hover:bg-emerald-300 disabled:opacity-40"
        >
          {busy ? "Approving…" : `Approve selected${selected.size > 0 ? ` (${selected.size})` : ""}`}
        </button>
      </div>
      {err && <p className="mb-3 text-sm text-red-300">{err}</p>}

      <div className="space-y-4">
        {items.map((c) => (
          <section
            key={c.id}
            className={`rounded-xl border bg-white/5 p-4 ${selected.has(c.id) ? "border-emerald-400/50" : "border-white/10"}`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={selected.has(c.id)}
                onChange={() => toggle(c.id)}
                aria-label={`Select ${c.hook ?? "creative"}`}
                className="mt-1.5 h-4 w-4 flex-shrink-0 accent-emerald-400"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wide text-white/40">{c.family}</div>
                <h2 className="mt-0.5 text-lg font-medium">{c.hook}</h2>
              </div>
            </div>
            <div className="mb-3 mt-2">
              <VideoGallery videos={c.videos} />
            </div>
            <ReviewCard
              creativeId={c.id}
              state={c.state}
              comments={c.comments}
              currentUserId={currentUserId}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
