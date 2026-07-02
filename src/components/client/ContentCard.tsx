import Link from "next/link";
import VideoAssetCard from "@/components/VideoAssetCard";
import ReviewCard, { type ReviewComment } from "@/components/ReviewCard";
import type { ContentItem } from "@/lib/client/data";
import { usd } from "@/lib/client/format";

const APPROVAL_STYLE: Record<string, string> = {
  Approved: "bg-emerald-500/15 text-emerald-300",
  "Changes requested": "bg-amber-500/15 text-amber-300",
  Pending: "bg-white/10 text-white/55",
};

// One piece of delivered content, as the client sees it: the cut(s), the facet
// chips, the CPT/hit signal, and inline approve/comment. No costs, no scripts.
export default function ContentCard({
  item,
  currentUserId,
  comments,
}: {
  item: ContentItem;
  currentUserId: string;
  comments: ReviewComment[];
}) {
  const cpt = item.perf?.cpt != null ? Number(item.perf.cpt) : null;
  const chips = [
    item.facets.family,
    item.facets.theme,
    item.facets.angle,
    item.facets.sport,
    item.facets.format,
  ].filter(Boolean) as string[];

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-wide text-white/40">
            {item.familyName ?? "—"} · #{item.sheetId ?? "new"}
          </div>
          <h3 className="mt-0.5 truncate text-[15px] font-medium text-gray-100">{item.hookLine}</h3>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${APPROVAL_STYLE[item.approval] ?? APPROVAL_STYLE.Pending}`}>
          {item.approval}
        </span>
      </div>

      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] text-white/60">
              {c}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {item.videos.map((v) => (
          <VideoAssetCard key={v.id} id={v.id} fileName={v.fileName} versionLabel={v.versionLabel} streamUrl={v.streamUrl} />
        ))}
      </div>

      {item.perf && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2 text-[13px]">
          <Metric label="CPT" value={usd(cpt)} accent={item.hit} />
          <Metric label="Results" value={item.perf.results?.toLocaleString() ?? "—"} />
          <Metric label="Spend" value={usd(Number(item.perf.spend))} />
          {item.hit !== null && (
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${item.hit ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}
            >
              {item.hit ? "On target ✓" : "Over target"}
            </span>
          )}
        </div>
      )}

      <ReviewCard creativeId={item.id} state={item.approval} comments={comments} currentUserId={currentUserId} />

      <Link href={`/creatives/${item.id}`} className="mt-3 inline-block text-[12px] text-white/45 hover:text-white">
        Open full brief →
      </Link>
    </section>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean | null }) {
  const color = accent == null ? "text-white/90" : accent ? "text-emerald-300" : "text-red-300";
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</span>
      <span className={`font-semibold ${color}`}>{value}</span>
    </span>
  );
}
