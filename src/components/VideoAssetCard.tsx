"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function VideoAssetCard({
  id,
  fileName,
  versionLabel,
  streamUrl,
  canDelete = false,
  transcript = null,
  transcriptStatus = null,
}: {
  id: string;
  fileName: string;
  versionLabel: string;
  streamUrl: string | null;
  canDelete?: boolean;
  transcript?: string | null;
  transcriptStatus?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  async function transcribe() {
    setTranscribing(true);
    try {
      const res = await fetch(`/api/videos/${id}/transcribe`, { method: "POST" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Transcription failed" }));
        alert(error || "Transcription failed");
      }
      router.refresh();
    } finally {
      setTranscribing(false);
    }
  }

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

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(error || "Delete failed");
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
      setDeleting(false);
      setConfirming(false);
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
          <div className="truncate text-sm" title={fileName}>{fileName}</div>
          <div className="text-xs text-white/40">{versionLabel}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={download}
            disabled={busy || deleting}
            className="rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50"
          >
            {busy ? "…" : "Download"}
          </button>
          {canDelete &&
            (confirming ? (
              <>
                <button
                  onClick={remove}
                  disabled={deleting}
                  className="rounded-lg bg-red-500/90 px-2.5 py-1.5 text-sm font-medium text-black hover:bg-red-500 disabled:opacity-50"
                >
                  {deleting ? "…" : "Delete"}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={deleting}
                  className="rounded-lg border border-white/20 px-2.5 py-1.5 text-sm text-white/60 hover:bg-white/10 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-sm text-white/50 hover:bg-red-500/10 hover:text-red-300"
                aria-label="Delete video"
                title="Delete this video"
              >
                Delete
              </button>
            ))}
        </div>
      </div>

      {(transcript || transcriptStatus || canDelete) && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="flex items-center gap-2.5">
            {transcript ? (
              <button onClick={() => setShowTranscript((s) => !s)} className="text-xs text-white/55 hover:text-white/85">
                {showTranscript ? "▾ Hide transcript" : "▸ Transcript"}
              </button>
            ) : transcriptStatus === "pending" || transcribing ? (
              <span className="text-xs text-white/40">Transcribing…</span>
            ) : (
              <span className="text-xs text-white/35">{transcriptStatus === "failed" ? "Transcript failed" : "No transcript"}</span>
            )}
            {canDelete && transcriptStatus !== "pending" && !transcribing && (
              <button onClick={transcribe} className="text-xs text-violet-300 hover:underline">
                {transcript ? "Re-transcribe" : "Transcribe"}
              </button>
            )}
          </div>
          {transcript && showTranscript && (
            <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-white/70">
              {transcript}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
