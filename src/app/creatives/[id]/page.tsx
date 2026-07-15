import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createSignedStream } from "@/lib/storage";
import { defaultTargetCents, isHit } from "@/lib/metrics/perf";
import VideoUploader from "@/components/VideoUploader";
import VideoGallery from "@/components/VideoGallery";
import ScriptPanel, { type Script, type Review } from "@/components/ScriptPanel";
import ReferencesPanel, { type Reference } from "@/components/ReferencesPanel";
import BriefActions from "@/components/BriefActions";
import WeekAssignment, { type WeekCycle, type WeekSlot } from "@/components/WeekAssignment";
import AdNameTag from "@/components/AdNameTag";
import PerformanceQuickEntry from "@/components/PerformanceQuickEntry";
import DiscussionThread, { type Note } from "@/components/DiscussionThread";

export const dynamic = "force-dynamic";

const IDEA_PILL: Record<string, string> = {
  Winner: "bg-emerald-500/15 text-emerald-300",
  Testing: "bg-sky-500/15 text-sky-300",
  Backlog: "bg-white/10 text-white/60",
  Parked: "bg-amber-500/15 text-amber-300",
};

export default async function CreativePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  const staff = isStaff(user);
  const client = user?.role === "client_viewer";
  const creator = user?.role === "creator";
  const back = client
    ? { href: "/client/library", label: "← Content" }
    : creator
      ? { href: "/queue", label: "← My Queue" }
      : { href: "/ideas", label: "← Ideas" };
  const supabase = await createClient();

  const { data: creative } = await supabase
    .from("creatives")
    .select(
      "id, sheet_id, org_id, ad_name, content_summary, hook_line, hypothesis, hook_angle, archetype, feature_pillar, sport, format, variant_differentiator, cta, status, idea_status, is_proven, compliance_note, script_doc_url, cpt_target_cents, concept_families(name, compliance_note)",
    )
    .eq("id", id)
    .single();
  if (!creative) notFound();

  // Reported performance comes straight from the weekly-report rows, joined by
  // the org stamp + this concept's ad name (the old creative_performance view
  // joined by name alone). No ad name → the .eq("") matches nothing.
  const [{ data: assets }, { data: metricRows }, { data: scripts }, { data: refs }] = await Promise.all([
    supabase.from("video_assets").select("id, file_name, version_label, storage_path, uploaded_at, uploaded_by, transcript, transcript_status").eq("creative_id", id).order("uploaded_at", { ascending: false }),
    supabase
      .from("creative_metrics")
      .select("flight_label, flight_start, created_at, spend, conversions, cpa, ctr, verdict, reason")
      .eq("org_id", creative.org_id ?? "")
      .eq("ad_name", creative.ad_name ?? ""),
    supabase.from("scripts").select("id, body, source, status, version, model, created_at").eq("concept_id", id).order("version", { ascending: false }),
    supabase.from("concept_references").select("id, kind, url, storage_path, label").eq("concept_id", id).order("created_at", { ascending: true }),
  ]);

  // Latest reviewer scorecard for the current (latest) script version.
  const scriptList = (scripts as unknown as Script[]) ?? [];
  let latestReview: Review | null = null;
  if (scriptList[0]) {
    const { data: rev } = await supabase
      .from("script_reviews")
      .select("id, script_id, scores, overall, verdict, weaknesses, suggestions, compliance_flags")
      .eq("script_id", scriptList[0].id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    latestReview = (rev as unknown as Review) ?? null;
  }

  // Which week(s) this concept is scheduled in + the client's other weeks,
  // so staff can move a misfiled concept without leaving the page.
  let weekSlots: WeekSlot[] = [];
  let weekCycles: WeekCycle[] = [];
  if (staff && creative.org_id) {
    const [{ data: slotRows }, { data: cycleRows }] = await Promise.all([
      supabase.from("deliverables").select("id, cycle_id").eq("concept_id", id),
      supabase
        .from("cycles")
        .select("id, label, status")
        .eq("org_id", creative.org_id)
        .order("starts_on", { ascending: false })
        .limit(20),
    ]);
    weekSlots = (slotRows as WeekSlot[]) ?? [];
    weekCycles = (cycleRows as WeekCycle[]) ?? [];
  }

  // Internal creator ↔ staff discussion (not loaded for clients).
  const canDiscuss = staff || user?.role === "creator";
  let notes: Note[] = [];
  if (canDiscuss) {
    const { data: noteRows } = await supabase
      .from("production_notes")
      .select("id, author_id, author_name, author_role, body, created_at")
      .eq("concept_id", id)
      .order("created_at", { ascending: true });
    notes = (noteRows as Note[]) ?? [];
  }

  const videos = await Promise.all(
    (assets ?? []).map(async (a) => ({
      id: a.id, fileName: a.file_name, versionLabel: a.version_label,
      streamUrl: await createSignedStream(a.storage_path).catch(() => null),
      // Uploader removes their own accidental cut; staff remove any. The API
      // and RLS (va_creator_delete, 0025) re-check, incl. the published guard.
      canDelete: staff || (creator && a.uploaded_by === user?.id),
      transcript: a.transcript as string | null,
      transcriptStatus: a.transcript_status as string | null,
    })),
  );

  const famRaw = (creative as unknown as {
    concept_families: { name: string; compliance_note: string | null } | { name: string; compliance_note: string | null }[] | null;
  }).concept_families;
  const family = Array.isArray(famRaw) ? famRaw[0] ?? null : famRaw;
  // Family-level compliance notes carry internal agency context; only the
  // per-concept note is production guidance the creator should see. Clients
  // get neither — compliance framing is internal.
  const compliance = staff
    ? creative.compliance_note || family?.compliance_note
    : creator
      ? creative.compliance_note
      : null;

  return (
    <main className="mx-auto max-w-6xl p-6 pb-24">
      <Link href={back.href} className="text-[13px] text-white/50 hover:text-white">{back.label}</Link>

      <header className="mb-7 mt-4">
        <div className="flex items-center gap-2.5 font-mono text-[11.5px] uppercase tracking-wide text-white/45">
          <span>{family?.name}</span><span>·</span><span>#{creative.sheet_id ?? "new"}</span>
          {creative.is_proven && <span className="text-emerald-300">· ✓ proven</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3.5">
          <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-gray-50">“{creative.hook_line}”</h1>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${IDEA_PILL[creative.idea_status] ?? ""}`}>{creative.idea_status}</span>
        </div>
        {creative.ad_name && <AdNameTag name={creative.ad_name} className="mt-3 max-w-xl" />}
      </header>

      {compliance && (
        <div className="mb-6 flex items-start gap-2.5 rounded-[11px] border border-amber-500/30 bg-amber-500/[0.08] px-4 py-3 text-[13px] text-amber-200">
          <span className="mt-0.5 font-mono text-[11px] tracking-wide">COMPLIANCE</span>
          <span className="text-amber-100/90">{compliance}</span>
        </div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_332px]">
        {/* LEFT — the meaning */}
        <div className="flex min-w-0 flex-col gap-[22px]">
          <section className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-6">
            {!client && (
              <>
                <div className="font-mono text-[11px] tracking-[0.12em] text-emerald-300">WHAT WE&apos;RE TESTING</div>
                <p className="mt-3 text-[21px] font-semibold leading-snug tracking-tight text-gray-100">
                  {creative.hypothesis || "No hypothesis yet — state in one sentence what this creative is testing and why you expect it to work."}
                </p>
              </>
            )}
            {client && <div className="font-mono text-[11px] tracking-[0.12em] text-emerald-300">CONCEPT</div>}
            <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[11px] border border-white/[0.07] bg-white/[0.07]">
              <Cell label="Angle" value={creative.hook_angle} />
              <Cell label="Audience" value={creative.archetype} />
              <Cell label="Sport" value={creative.sport} />
              <Cell label="Feature" value={creative.feature_pillar} />
            </div>
          </section>

          {creative.content_summary && (
            <section>
              <h2 className="mb-2.5 font-mono text-sm font-semibold uppercase tracking-wide text-white/55">The brief</h2>
              <p className="text-[15px] leading-relaxed text-white/80">{creative.content_summary}</p>
            </section>
          )}

          <ScriptPanel conceptId={creative.id} scripts={scriptList} scriptDocUrl={creative.script_doc_url} canEdit={staff} latestReview={latestReview} />
          <ReferencesPanel conceptId={creative.id} references={(refs as unknown as Reference[]) ?? []} canEdit={staff} />
          {canDiscuss && <DiscussionThread conceptId={creative.id} notes={notes} currentUserId={user!.id} />}
        </div>

        {/* RIGHT rail */}
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <div className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-4">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-wide text-white/45">Deliverable</div>
            {videos.length === 0 ? (
              <div className="mx-auto flex aspect-[9/16] max-h-[200px] w-[115px] items-center justify-center rounded-[10px] border border-dashed border-white/[0.16] text-center">
                <span className="px-2.5 text-xs text-white/40">{creative.idea_status === "Backlog" ? "Not in a cycle yet" : "In production — no cut yet"}</span>
              </div>
            ) : (
              <VideoGallery videos={videos} columns={1} defaultOpen={videos.length === 1} />
            )}
            {(staff || creator) && <div className="mt-3"><VideoUploader creativeId={creative.id} /></div>}
          </div>

          {staff && weekCycles.length > 0 && (
            <WeekAssignment conceptId={creative.id} slots={weekSlots} cycles={weekCycles} />
          )}

          {!creator && (
            <ReportedPerformance
              rows={(metricRows as ReportRowLite[]) ?? []}
              targetCents={creative.cpt_target_cents ?? defaultTargetCents()}
              hasAdName={!!creative.ad_name}
              staff={staff}
            />
          )}
          {staff && creative.ad_name && (
            <div className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-4">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-wide text-white/45">Log performance</div>
              <PerformanceQuickEntry adName={creative.ad_name} />
            </div>
          )}

          <div className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-4">
            <div className="mb-3 font-mono text-[11px] uppercase tracking-wide text-white/45">Production spec</div>
            <div className="flex flex-col gap-2.5">
              <Spec label="Format" value={creative.format} />
              <Spec label="CTA" value={creative.cta} />
              <Spec label="Variant" value={creative.variant_differentiator} />
              <Spec label="Status" value={creative.status} />
            </div>
          </div>

          {staff && (
            <BriefActions
              conceptId={creative.id}
              initial={{
                family: family?.name ?? "",
                ad_name: creative.ad_name ?? "",
                hook_line: creative.hook_line ?? "",
                hypothesis: creative.hypothesis ?? "",
                content_summary: creative.content_summary ?? "",
                hook_angle: creative.hook_angle ?? "",
                archetype: creative.archetype ?? "",
                sport: creative.sport ?? "",
                feature_pillar: creative.feature_pillar ?? "",
                format: creative.format ?? "",
                cta: creative.cta ?? "",
                variant_differentiator: creative.variant_differentiator ?? "",
                compliance_note: creative.compliance_note ?? "",
              }}
            />
          )}
        </aside>
      </div>
    </main>
  );
}

function Cell({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-[#0e1014] px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-[14.5px] font-medium text-white/90">{value || "—"}</div>
    </div>
  );
}

function Spec({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2.5 text-[13px]">
      <span className="w-16 flex-shrink-0 font-mono text-[10px] uppercase tracking-wide text-white/40">{label}</span>
      <span className="text-white/80">{value}</span>
    </div>
  );
}

type ReportRowLite = {
  flight_label: string;
  flight_start: string | null;
  created_at: string | null;
  spend: number | null;
  conversions: number | null;
  cpa: number | null;
  ctr: number | null;
  verdict: string | null;
  reason: string | null;
};

const VERDICT_LABEL: Record<string, string> = { GRADUATE: "Graduated", ITERATE: "Iterate", KEEP_TESTING: "Keep testing", KILL: "Stopped" };
const VERDICT_PILL: Record<string, string> = {
  GRADUATE: "bg-emerald-500/15 text-emerald-300",
  ITERATE: "bg-orange-500/15 text-orange-300",
  KEEP_TESTING: "bg-sky-500/15 text-sky-300",
  KILL: "bg-red-500/15 text-red-300",
};

// The concept's own view of the weekly report: headline numbers from the most
// recent report row (Spend/Conv read as flight-to-date running totals) plus
// each week it appeared in.
function ReportedPerformance({
  rows,
  targetCents,
  hasAdName,
  staff,
}: {
  rows: ReportRowLite[];
  targetCents: number | null;
  hasAdName: boolean;
  staff: boolean;
}) {
  const usd = (n: number | null | undefined) => (n == null ? "—" : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
  const recency = (m: ReportRowLite) => m.flight_start ?? m.created_at ?? "";
  const sorted = [...rows].sort((a, b) => (recency(a) < recency(b) ? 1 : -1));
  const latest = sorted[0] ?? null;
  const cpa = latest ? (latest.cpa != null ? Number(latest.cpa) : null) : null;
  const hit = isHit(cpa, targetCents);

  return (
    <div className="rounded-[14px] border border-white/[0.09] bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-[11px] uppercase tracking-wide text-white/45">Performance</span>
        {latest?.verdict && VERDICT_LABEL[latest.verdict] && (
          <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-semibold ${VERDICT_PILL[latest.verdict] ?? ""}`}>
            {VERDICT_LABEL[latest.verdict]}
          </span>
        )}
      </div>
      {!latest ? (
        <p className="text-[12.5px] text-white/40">
          {hasAdName
            ? "Not in a weekly report yet — numbers appear once this ad name shows up in an imported report."
            : staff
              ? "No ad name on this concept — set one (Edit brief) so report rows can join to it."
              : "No data yet."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <Metric label="Spend" value={usd(latest.spend)} />
            <Metric label="CPA" value={usd(cpa)} accent={hit} />
            <Metric label="CTR" value={latest.ctr == null ? "—" : `${(Number(latest.ctr) * 100).toFixed(2)}%`} />
            <Metric label="Trials" value={latest.conversions == null ? "—" : Number(latest.conversions).toLocaleString()} />
          </div>
          <div className="mt-2 text-[11px] text-white/40">As of {latest.flight_label}.</div>
          {latest.reason && <div className="mt-1.5 text-[12px] leading-snug text-white/55">{latest.reason}</div>}
          {sorted.length > 1 && (
            <table className="mt-3 w-full text-left text-[12px]">
              <thead className="text-white/40">
                <tr>
                  <th className="py-1 font-normal">Week</th>
                  <th className="py-1 text-right font-normal">Spend</th>
                  <th className="py-1 text-right font-normal">Trials</th>
                  <th className="py-1 text-right font-normal">CPA</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => (
                  <tr key={m.flight_label} className="border-t border-white/[0.06] text-white/70">
                    <td className="max-w-[110px] truncate py-1" title={m.flight_label}>{m.flight_label}</td>
                    <td className="py-1 text-right tabular-nums">{usd(m.spend)}</td>
                    <td className="py-1 text-right tabular-nums">{m.conversions ?? "—"}</td>
                    <td className="py-1 text-right tabular-nums">{usd(m.cpa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean | null }) {
  const color = accent == null ? "text-white/90" : accent ? "text-emerald-300" : "text-red-300";
  return (
    <div className="rounded-[9px] border border-white/[0.07] px-3 py-2">
      <div className="font-mono text-[9.5px] uppercase tracking-wide text-white/40">{label}</div>
      <div className={`mt-0.5 text-[15px] font-semibold ${color}`}>{value}</div>
    </div>
  );
}
