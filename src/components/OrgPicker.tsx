"use client";

import { useRouter, useSearchParams } from "next/navigation";

// Small "which client account" selector for staff-facing pages that show
// per-org context (e.g. Performance's learnings/pattern-promotion section).
export default function OrgPicker({
  organizations,
  currentSlug,
}: {
  organizations: { id: string; slug: string; display_name: string }[];
  currentSlug: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function change(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("org", slug);
    router.push(`?${params.toString()}`);
    router.refresh();
  }

  return (
    <label className="flex flex-col gap-1 text-xs text-white/40">
      Learnings for
      <select
        value={currentSlug}
        onChange={(e) => change(e.target.value)}
        className="rounded border border-white/10 bg-black/30 px-2 py-1 text-sm text-white/80"
      >
        {organizations.map((o) => (
          <option key={o.id} value={o.slug}>{o.display_name}</option>
        ))}
      </select>
    </label>
  );
}
