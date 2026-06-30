"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConceptForm, { type ConceptFields } from "@/components/ConceptForm";

// Right-rail actions on the concept brief: edit the brief (modal) and duplicate.
export default function BriefActions({
  conceptId,
  initial,
}: {
  conceptId: string;
  initial: Partial<ConceptFields>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function duplicate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/concepts/${conceptId}/duplicate`, { method: "POST" });
      const json = await res.json();
      if (res.ok) router.push(`/creatives/${json.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <button onClick={() => setEditing(true)}
          className="w-full rounded-[10px] border border-white/[0.18] py-2.5 text-[13px] text-white/80 hover:bg-white/10">
          Edit brief
        </button>
        <button onClick={duplicate} disabled={busy}
          className="w-full rounded-[10px] border border-white/[0.14] py-2.5 text-[13px] text-white/70 hover:bg-white/10 disabled:opacity-50">
          Duplicate as new test
        </button>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-6 backdrop-blur-sm" onClick={() => setEditing(false)}>
          <div className="my-8 w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0e1014] p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold">Edit brief</h2>
            <ConceptForm conceptId={conceptId} initial={initial} onDone={() => setEditing(false)} />
          </div>
        </div>
      )}
    </>
  );
}
