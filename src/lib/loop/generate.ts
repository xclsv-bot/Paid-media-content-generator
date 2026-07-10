import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnthropic, NOT_CONFIGURED, Anthropic } from "@/lib/anthropic";
import { getLearningInputs, type LearningInputs, type RecSource } from "@/lib/loop/scoreboard";
import type { Rec } from "@/lib/loop/learnings";

// Each recommendation the analyst emits MUST cite the backing-row IDs it is
// grounded in. `sources` is validated against the candidate rows we fed in
// (generate.ts drops any rec citing an unknown ID, and any rec citing nothing),
// so a cold reader can always retrieve the winner/loser/slot behind a directive.
const REC = {
  type: "object",
  additionalProperties: false,
  properties: {
    directive: { type: "string" },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["directive", "sources"],
} as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    narrative: { type: "string" },
    do_more: { type: "array", items: REC },
    do_less: { type: "array", items: REC },
    explore: { type: "array", items: REC },
    watchouts: { type: "array", items: REC },
  },
  required: ["narrative", "do_more", "do_less", "explore", "watchouts"],
} as const;

// Per-run summary surfaced to the caller (the cron records it per org). No
// logger exists in this codebase — observability rides the return value. The
// weekly heartbeat uses `allDropped` to tell "the model had nothing traceable
// to say" apart from "the model's output was all untraceable and got dropped".
export type LearningsSummary = {
  counts: { do_more: number; do_less: number; explore: number; watchouts: number };
  dropped: number;
  flagged: string[];
  allDropped: boolean;
};

export type GenResult = { status: number; learning?: unknown; error?: string; summary?: LearningsSummary };

type RawRec = { directive?: string; sources?: unknown };

// The traceability gate: keep only recs that cite ≥1 real candidate ID, and
// stamp each with the authoritative metric from the cited rows (never the
// model's own number). Everything else is dropped and counted — an untraceable
// rec never reaches the store. This is the guarantee the cold-reader check
// leans on: every emitted rec's `sources` retrieve real backing rows.
export function traceableRecs(
  raw: unknown,
  candidates: RecSource[],
): { recs: Rec[]; dropped: number } {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const recs: Rec[] = [];
  let dropped = 0;
  for (const item of Array.isArray(raw) ? (raw as RawRec[]) : []) {
    const directive = (item?.directive ?? "").trim();
    const cited = Array.isArray(item?.sources) ? (item.sources as unknown[]) : [];
    const valid = [...new Set(cited.filter((s): s is string => typeof s === "string" && byId.has(s)))];
    if (!directive || valid.length === 0) {
      dropped++;
      continue;
    }
    const metric = [...new Set(valid.map((id) => byId.get(id)!.metric).filter(Boolean))].join("; ");
    recs.push({ directive, sources: valid, metric });
  }
  return { recs, dropped };
}

function candidateBlock(title: string, sources: RecSource[], emptyNote: string): string {
  if (!sources.length) return `${title}\n(none — ${emptyNote})`;
  return `${title}\n${sources.map((s) => s.prompt).join("\n")}`;
}

// Pure: assemble the analyst prompt from the candidate rows, and the flags for
// categories the current data can't support. Extracted (and exported) so a test
// can assert the prompt's citation convention matches what applyModelResponse
// validates against — the exact seam a silent format drift would break.
export function buildLearningsPrompt(
  inputs: LearningInputs,
  clientDesc: string,
): { system: string; userContent: string; flags: string[] } {
  const flags: string[] = [];
  if (!inputs.golden.length) flags.push("do_more (no golden/proven winner with a captured script yet)");
  if (!inputs.losers.length) flags.push("do_less (no proven loser yet)");
  if (!inputs.explore.length) flags.push("explore (no Untested family slots)");
  if (!inputs.rejections.length && !inputs.validating.length) flags.push("watchouts (no compliance rejections or Validating slots)");

  const system = `You are a paid-social performance analyst for ${clientDesc}. Below is a per-dimension scoreboard (hit rate = share of creatives at/under the ${inputs.targetDollars} CPT target), plus candidate rows for each recommendation type — every candidate is prefixed with the exact ID you must cite to ground a recommendation in it.

Write the current, actionable learnings for the next round of creative. HARD RULES on traceability:
- Every recommendation is an object { directive, sources }. "sources" MUST list the exact IDs shown in brackets (e.g. golden:abc, loser:def, explore:Props) of the candidate rows the directive is based on — copy the whole bracketed ref including its kind prefix. Cite only IDs that appear below — never invent one.
- do_more: cite golden:<creative_id> — variant the proven winner(s). Base each directive on WHY that golden script won (hook style, proof, structure).
- do_less: cite loser:<creative_id> — the proven losers to stop repeating.
- explore: cite explore:<family> — a named unfilled slot with no matured cohort yet.
- watchouts: cite rejection:<creative_id> (compliance mistakes to never repeat) or validating:<family> (small-sample families not yet proven).
- Do NOT emit a recommendation you cannot tie to a listed ID. If a category has no candidates, return [] for it. Keep "narrative" to a short human summary of the cited rows — add no claim not backed by a cited directive. Do not invent data.`;

  const userContent = [
    `SCOREBOARD (mature cohorts, gated by trials)\n${inputs.scoreboardText}`,
    candidateBlock("DO_MORE CANDIDATES — proven winners (cite golden:<id>)", inputs.golden, "no golden examples yet"),
    candidateBlock("DO_LESS CANDIDATES — proven losers (cite loser:<id>)", inputs.losers, "no proven losers yet"),
    candidateBlock("EXPLORE CANDIDATES — unfilled slots (cite explore:<family>)", inputs.explore, "no untested families"),
    candidateBlock("WATCHOUT CANDIDATES — compliance rejections (cite rejection:<id>)", inputs.rejections, "no rejections"),
    candidateBlock("WATCHOUT CANDIDATES — validating slots (cite validating:<family>)", inputs.validating, "no validating families"),
  ].join("\n\n");

  return { system, userContent, flags };
}

// Pure: run the model's parsed output through the traceability gate for every
// category, returning the surviving recs and how many were dropped. Watchouts
// may cite either a rejection or a Validating-slot ref, so both candidate sets
// are pooled. Exported for the seam test.
export function applyModelResponse(
  parsed: unknown,
  inputs: LearningInputs,
): { do_more: Rec[]; do_less: Rec[]; explore: Rec[]; watchouts: Rec[]; dropped: number } {
  // Tolerate a non-object payload (e.g. JSON.parse("null") or a bare array):
  // each category just reads undefined and drops to zero recs, rather than
  // throwing on a property access and degrading the whole run to a 500.
  const p = (parsed && typeof parsed === "object" ? parsed : {}) as {
    do_more?: unknown; do_less?: unknown; explore?: unknown; watchouts?: unknown;
  };
  const doMore = traceableRecs(p.do_more, inputs.golden);
  const doLess = traceableRecs(p.do_less, inputs.losers);
  const explore = traceableRecs(p.explore, inputs.explore);
  const watchouts = traceableRecs(p.watchouts, [...inputs.rejections, ...inputs.validating]);
  return {
    do_more: doMore.recs,
    do_less: doLess.recs,
    explore: explore.recs,
    watchouts: watchouts.recs,
    dropped: doMore.dropped + doLess.dropped + explore.dropped + watchouts.dropped,
  };
}

// Pure: fold the applied recs into a per-run summary. `allDropped` fires only
// when candidates existed but every one of them validated to zero recs — the
// signal that a run produced nothing traceable despite having data to work from.
export function summarizeLearnings(
  inputs: LearningInputs,
  applied: ReturnType<typeof applyModelResponse>,
  flags: string[],
): LearningsSummary {
  const counts = {
    do_more: applied.do_more.length,
    do_less: applied.do_less.length,
    explore: applied.explore.length,
    watchouts: applied.watchouts.length,
  };
  const total = counts.do_more + counts.do_less + counts.explore + counts.watchouts;
  const hadCandidates =
    inputs.golden.length + inputs.losers.length + inputs.explore.length + inputs.rejections.length + inputs.validating.length > 0;
  return { counts, dropped: applied.dropped, flagged: flags, allDropped: hadCandidates && total === 0 };
}

// Shared analyst logic: read the gated scoreboard + traceable candidate rows,
// write a structured learnings snapshot where every recommendation cites the
// backing-row IDs it came from. Used by the staff button (user client) and the
// weekly heartbeat (admin client). `supabase` must be able to insert learnings.
export async function generateLearnings(
  supabase: SupabaseClient,
  createdBy: string | null,
  orgId: string,
): Promise<GenResult> {
  const inputs = await getLearningInputs(supabase, orgId);
  if (inputs.maturedCount === 0) {
    return { status: 422, error: "Nothing has matured yet — no confident cohorts to learn from." };
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("slug, display_name, voice_note")
    .eq("id", orgId)
    .single();
  const clientDesc = org?.voice_note ?? org?.display_name ?? "the client's account";

  const { system, userContent, flags } = buildLearningsPrompt(inputs, clientDesc);

  let client: Anthropic;
  try {
    client = createAnthropic();
  } catch {
    return { status: 503, error: NOT_CONFIGURED };
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system,
      messages: [{ role: "user", content: userContent }],
    });
    if (response.stop_reason === "refusal") return { status: 422, error: "The analyst declined." };
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");

    // Enforce traceability in code — the model's citations are validated against
    // the candidate rows, unknown IDs are stripped, untraceable recs are dropped,
    // and each surviving rec is stamped with its rows' authoritative metric.
    const applied = applyModelResponse(parsed, inputs);
    const summary = summarizeLearnings(inputs, applied, flags);

    const { data: saved, error } = await supabase
      .from("learnings")
      .insert({
        scope: org?.slug ?? "global",
        org_id: orgId,
        narrative: parsed.narrative ?? "",
        do_more: applied.do_more,
        do_less: applied.do_less,
        explore: applied.explore,
        watchouts: applied.watchouts,
        attribution: {
          scoreboard: inputs.scoreboardText,
          unsupported_categories: flags,
          dropped_untraceable: applied.dropped,
        },
        model: "claude-opus-4-8",
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) return { status: 500, error: error.message };
    return { status: 200, learning: saved, summary };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { status: 503, error: NOT_CONFIGURED };
    return { status: 500, error: e instanceof Error ? e.message : "Failed" };
  }
}
