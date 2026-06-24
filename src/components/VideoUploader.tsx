"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_VIDEO_BUCKET || "creative-videos";

export default function VideoUploader({ creativeId }: { creativeId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [versionLabel, setVersionLabel] = useState("v1");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setStatus("Pick a file first.");
      return;
    }
    setBusy(true);
    try {
      // 1) Ask the server for a one-time signed upload target (editor-only).
      setStatus("Preparing upload…");
      const signRes = await fetch("/api/uploads/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creativeId,
          fileName: file.name,
          versionLabel,
        }),
      });
      if (!signRes.ok) throw new Error((await signRes.json()).error);
      const { path, token } = await signRes.json();

      // 2) Upload the file straight to storage — never through our API route.
      setStatus("Uploading…");
      const supabase = createClient();
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (upErr) throw upErr;

      // 3) Register the VideoAsset row.
      setStatus("Saving…");
      const regRes = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creativeId,
          storagePath: path,
          fileName: file.name,
          versionLabel,
          sizeBytes: file.size,
          contentType: file.type,
        }),
      });
      if (!regRes.ok) throw new Error((await regRes.json()).error);

      setStatus("Done.");
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-white/20 p-4">
      <h3 className="mb-2 text-sm font-medium">Upload a video</h3>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm"
          className="text-sm text-white/70"
        />
        <input
          value={versionLabel}
          onChange={(e) => setVersionLabel(e.target.value)}
          placeholder="version"
          className="w-20 rounded border border-white/10 bg-black/30 px-2 py-1 text-sm"
        />
        <button
          onClick={upload}
          disabled={busy}
          className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy ? "Working…" : "Upload"}
        </button>
      </div>
      {status && <p className="mt-2 text-xs text-white/50">{status}</p>}
    </div>
  );
}
