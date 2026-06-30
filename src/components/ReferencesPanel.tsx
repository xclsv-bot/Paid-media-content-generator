"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const REF_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_REFERENCES_BUCKET || "references";

export type Reference = {
  id: string;
  kind: string;
  url: string;
  storage_path: string | null;
  label: string | null;
};

export default function ReferencesPanel({
  conceptId,
  references,
  canEdit,
}: {
  conceptId: string;
  references: Reference[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function addLink() {
    if (!linkUrl.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/concepts/${conceptId}/references`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "link", url: linkUrl, label: linkLabel || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setLinkUrl(""); setLinkLabel("");
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus("Uploading…");
    try {
      const sign = await fetch("/api/references/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conceptId, fileName: file.name }),
      });
      if (!sign.ok) throw new Error((await sign.json()).error);
      const { path, token } = await sign.json();

      const supabase = createClient();
      const { error } = await supabase.storage
        .from(REF_BUCKET)
        .uploadToSignedUrl(path, token, file, { contentType: file.type });
      if (error) throw error;

      const reg = await fetch(`/api/concepts/${conceptId}/references`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "file", storagePath: path, label: file.name }),
      });
      if (!reg.ok) throw new Error((await reg.json()).error);

      if (fileRef.current) fileRef.current.value = "";
      setStatus(null);
      router.refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function openFile(id: string) {
    const res = await fetch(`/api/references/${id}/view`);
    if (res.ok) window.open((await res.json()).url, "_blank");
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/5 p-4">
      <h2 className="mb-3 text-lg font-medium">References</h2>

      {references.length === 0 && (
        <p className="text-sm text-white/40">No reference materials yet.</p>
      )}
      <ul className="space-y-1 text-sm">
        {references.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <span className="text-white/40">{r.kind === "file" ? "📎" : "🔗"}</span>
            {r.kind === "file" ? (
              <button onClick={() => openFile(r.id)} className="text-sky-300 hover:underline">
                {r.label || "file"}
              </button>
            ) : (
              <a href={r.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
                {r.label || r.url}
              </a>
            )}
          </li>
        ))}
      </ul>

      {canEdit && (
        <div className="mt-4 space-y-2 border-t border-white/10 pt-3">
          <div className="flex flex-wrap gap-2">
            <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://… (link)"
              className="flex-1 rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
            <input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="label"
              className="w-28 rounded border border-white/10 bg-black/30 px-2 py-1 text-sm" />
            <button onClick={addLink} disabled={busy} className="rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-50">
              Add link
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" className="text-sm text-white/70" />
            <button onClick={uploadFile} disabled={busy} className="rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-50">
              Upload file
            </button>
          </div>
          {status && <p className="text-xs text-white/50">{status}</p>}
        </div>
      )}
    </section>
  );
}
