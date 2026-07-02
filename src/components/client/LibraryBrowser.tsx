"use client";

import { useMemo, useState } from "react";
import ContentCard from "@/components/client/ContentCard";
import type { ReviewComment } from "@/components/ReviewCard";
import type { ContentItem } from "@/lib/client/data";
import { FACET_KEYS, FACET_LABELS, type FacetKey } from "@/lib/client/categorize";

// The Google-Drive-like content browser: everything the client has, filterable
// by the categorization facets and a free-text search, newest first.
export default function LibraryBrowser({
  items,
  commentsByItem,
  currentUserId,
}: {
  items: ContentItem[];
  commentsByItem: Record<string, ReviewComment[]>;
  currentUserId: string;
}) {
  const [filters, setFilters] = useState<Partial<Record<FacetKey, string>>>({});
  const [q, setQ] = useState("");

  // Distinct values per facet, computed once from the full set.
  const options = useMemo(() => {
    const out = {} as Record<FacetKey, string[]>;
    for (const key of FACET_KEYS) {
      const set = new Set<string>();
      for (const it of items) if (it.facets[key]) set.add(it.facets[key]!);
      out[key] = [...set].sort((a, b) => a.localeCompare(b));
    }
    return out;
  }, [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((it) => {
      for (const key of FACET_KEYS) {
        const want = filters[key];
        if (want && it.facets[key] !== want) return false;
      }
      if (needle) {
        const hay = `${it.adName ?? ""} ${it.hookLine ?? ""} ${it.familyName ?? ""} ${it.videos.map((v) => v.fileName).join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [items, filters, q]);

  const setFacet = (key: FacetKey, val: string | null) =>
    setFilters((f) => {
      const next = { ...f };
      if (val === null) delete next[key];
      else next[key] = val;
      return next;
    });

  const activeCount = Object.keys(filters).length + (q.trim() ? 1 : 0);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by ad name, hook, or concept…"
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/90 placeholder:text-white/35"
          />
          {activeCount > 0 && (
            <button
              onClick={() => {
                setFilters({});
                setQ("");
              }}
              className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-sm text-white/60 hover:bg-white/10"
            >
              Clear{activeCount > 1 ? ` (${activeCount})` : ""}
            </button>
          )}
        </div>

        {FACET_KEYS.filter((k) => options[k].length > 0).map((key) => (
          <div key={key} className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-16 shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/40">
              {FACET_LABELS[key]}
            </span>
            <Chip active={!filters[key]} onClick={() => setFacet(key, null)}>
              All
            </Chip>
            {options[key].map((v) => (
              <Chip key={v} active={filters[key] === v} onClick={() => setFacet(key, v)}>
                {v}
              </Chip>
            ))}
          </div>
        ))}
      </div>

      <div className="mb-3 text-[13px] text-white/45">
        {filtered.length} of {items.length} {items.length === 1 ? "item" : "items"}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-white/[0.02] p-10 text-center text-white/45">
          Nothing matches these filters.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((it) => (
            <ContentCard
              key={it.id}
              item={it}
              currentUserId={currentUserId}
              comments={commentsByItem[it.id] ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[12px] transition ${
        active ? "bg-white text-black" : "bg-white/[0.06] text-white/65 hover:bg-white/12"
      }`}
    >
      {children}
    </button>
  );
}
