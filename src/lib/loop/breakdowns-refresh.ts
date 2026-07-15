import type { SupabaseClient } from "@supabase/supabase-js";
import { Anthropic, createAnthropic } from "@/lib/anthropic";
import { breakdownInputCharCap, breakdownMaxPerRun } from "@/lib/loop/config";
import {
  breakdownInputHash,
  parseBreakdown,
  planBreakdownRefresh,
  type BreakdownDimensions,
  type BreakdownTarget,
  type ExistingBreakdownRow,
} from "@/lib/loop/breakdowns";

// The breakdown refresher — collects the current winner set (golden examples ∪
// staff-marked Winner concepts), diffs it against winner_breakdowns via the
// pure planner, and runs ONE analyst-model call per new/changed winner. Runs
// OUTSIDE refreshAll on purpose: refreshAll executes synchronously inside
// user-facing metric saves, and a model call there would add seconds of
// latency. Call sites: the daily /api/winners/refresh (awaited) and, via
// next/server after(), post-response on metric writes and idea_status flips.

const BREAKDOWN_MODEL = "claude-opus-4-8";

export const BREAKDOWN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    hook: {
      type: "object",
      additionalProperties: false,
      properties: {
        device: { type: "string" },
        first_three_seconds: { type: "string" },
        why_it_works: { type: "string" },
      },
      required: ["device", "first_three_seconds", "why_it_works"],
    },
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { beat: { type: "string" }, purpose: { type: "string" } },
        required: ["beat", "purpose"],
      },
    },
    proof_device: { type: "string" },
    cta: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: { type: "string" },
        placement: { type: "string" },
        style: { type: "string" },
      },
      required: ["text", "placement", "style"],
    },
    delivery: {
      type: "object",
      additionalProperties: false,
      properties: {
        pacing: { type: "string" },
        format_rationale: { type: "string" },
        talent_rationale: { type: "string" },
        theme: { type: "string" },
      },
      required: ["pacing", "format_rationale", "talent_rationale", "theme"],
    },
    replicable_pattern: { type: "string" },
    vary_next: { type: "array", items: { type: "string" } },
  },
  required: ["hook", "beats", "proof_device", "cta", "delivery", "replicable_pattern", "vary_next"],
} as const;

// Build the analyst prompt for one winner. The script/transcript go in FULL
// (capped only by BREAKDOWN_INPUT_CHAR_CAP) — this is the one consumer that
// reads the whole winning delivery, not the golden set's 600-char excerpt.
export function buildBreakdownPrompt(
  t: BreakdownTarget,
  clientDesc: string,
): { system: string; userContent: string } {
  const inputCap = breakdownInputCharCap();
  const system = `You are a senior paid-social creative analyst for XCLSV Media working the ${clientDesc} account. Decompose ONE winning short-form video ad into a structured, reusable teardown. Be concrete and mechanical — name the hook device, quote the actual opening line, describe what each beat does and why it holds attention. "replicable_pattern" must be an abstract template another strategist could execute on a different topic without copying this ad's wording. "vary_next" lists 2-4 concrete variation axes worth testing next (a different sport, a faceless cut, a new proof device...). Ground every field ONLY in the provided script/transcript/metadata — never invent metrics or content that isn't there.`;

  const evidence =
    t.source === "performance"
      ? `WHY IT WON: ${t.why_it_won ?? "proven winner"}${t.cpt_cents != null && t.target_cents != null ? ` (CPT $${(t.cpt_cents / 100).toFixed(2)} vs $${(t.target_cents / 100).toFixed(2)} target${t.results != null ? `, ${t.results} trials` : ""})` : ""}`
      : "WHY IT WON: Editorial pick by staff — marked as a Winner concept; no gated performance data yet.";
  const d = t.dims;
  const famCtx = t.family
    ? [
        t.family.narrative ? `Family narrative: ${t.family.narrative}` : "",
        t.family.proven_hook_formula ? `Proven hook formula: ${t.family.proven_hook_formula}` : "",
      ].filter(Boolean).join("\n")
    : "";
  const userContent = [
    evidence,
    `DIMENSIONS: family ${d.family ?? "?"} · hook "${d.hook_line ?? "?"}" · angle ${d.hook_angle ?? "?"} · audience ${d.archetype ?? "?"} · sport ${d.sport ?? "?"} · format ${d.format ?? "?"}`,
    famCtx ? `FAMILY CONTEXT:\n${famCtx}` : "",
    t.script?.trim() ? `SCRIPT (full):\n${t.script.slice(0, inputCap)}` : "(no written script on file)",
    t.transcript?.trim()
      ? `WINNING DELIVERY — full transcript of the cut that ran:\n${t.transcript.slice(0, inputCap)}`
      : "(no video transcript on file)",
  ].filter(Boolean).join("\n\n");
  return { system, userContent };
}

export type BreakdownRefreshResult =
  | {
      targets: number;
      generated: number;
      failed: number;
      reactivated: number;
      retagged: number;
      deactivated: number;
      skippedNoInput: number;
      skippedCap: number;
      notConfigured?: true;
    }
  | { error: string };

type CreativeRow = {
  id: string;
  org_id: string;
  ad_name: string | null;
  hook_line: string | null;
  hook_angle: string | null;
  archetype: string | null;
  sport: string | null;
  format: string | null;
  idea_status: string | null;
  concept_families:
    | { name: string | null; narrative: string | null; proven_hook_formula: string | null }
    | { name: string | null; narrative: string | null; proven_hook_formula: string | null }[]
    | null;
};

const fam = (c: CreativeRow) => {
  const raw = c.concept_families;
  return !raw ? null : Array.isArray(raw) ? raw[0] ?? null : raw;
};

// Collect targets → plan → generate (capped) → apply. Never throws for a
// single bad row; a model/parse failure is counted and skipped so the rest of
// the run still lands. All reads run on the service-role client and are
// re-stamped with each creative's own org_id, so one org's winner can never be
// written under another's.
export async function refreshBreakdowns(
  admin: SupabaseClient,
  opts?: { creativeIds?: string[] },
): Promise<BreakdownRefreshResult> {
  const only = opts?.creativeIds;

  // -- 1. Performance winners: the golden set (active + pinned; removed rows
  // are curator vetoes and never get a breakdown).
  let goldenQuery = admin
    .from("golden_examples")
    .select("creative_id, org_id, script, script_version, why_it_won, dimensions, cpt_cents, results, target_cents, transcript")
    .neq("status", "removed");
  if (only?.length) goldenQuery = goldenQuery.in("creative_id", only);
  const { data: goldenRows, error: gErr } = await goldenQuery;
  if (gErr) return { error: gErr.message };

  // -- 2. Editorial winners: concepts staff marked Winner in the Ideas bank.
  let winnerQuery = admin
    .from("creatives")
    .select(
      "id, org_id, ad_name, hook_line, hook_angle, archetype, sport, format, idea_status, concept_families(name, narrative, proven_hook_formula)",
    )
    .eq("idea_status", "Winner");
  if (only?.length) winnerQuery = winnerQuery.in("id", only);
  const { data: winnerCreatives, error: wErr } = await winnerQuery;
  if (wErr) return { error: wErr.message };

  // Family context (narrative / proven hook formula) for the golden targets
  // comes from their creative rows — fetch them in the same shape.
  const goldenIds = (goldenRows ?? []).map((g) => g.creative_id);
  let goldenCreatives: CreativeRow[] = [];
  if (goldenIds.length) {
    const { data } = await admin
      .from("creatives")
      .select(
        "id, org_id, ad_name, hook_line, hook_angle, archetype, sport, format, idea_status, concept_families(name, narrative, proven_hook_formula)",
      )
      .in("id", goldenIds);
    goldenCreatives = (data ?? []) as unknown as CreativeRow[];
  }
  const creativeById = new Map<string, CreativeRow>();
  for (const c of goldenCreatives) creativeById.set(c.id, c);
  for (const c of (winnerCreatives ?? []) as unknown as CreativeRow[]) creativeById.set(c.id, c);

  // Latest script + latest done transcript per target (same pattern as
  // refreshAll). The FULL video_assets transcript beats the golden excerpt.
  const editorialIds = ((winnerCreatives ?? []) as unknown as CreativeRow[])
    .map((c) => c.id)
    .filter((id) => !goldenIds.includes(id));
  const allIds = [...new Set([...goldenIds, ...editorialIds])];
  const scriptByConcept = new Map<string, { body: string; version: number }>();
  const transcriptByConcept = new Map<string, string>();
  if (allIds.length) {
    const [{ data: scripts, error: sErr }, { data: vids, error: vErr }] = await Promise.all([
      admin
        .from("scripts")
        .select("concept_id, body, version")
        .in("concept_id", allIds)
        .order("version", { ascending: false }),
      admin
        .from("video_assets")
        .select("creative_id, transcript, uploaded_at")
        .in("creative_id", allIds)
        .eq("transcript_status", "done")
        .not("transcript", "is", null)
        .order("uploaded_at", { ascending: false }),
    ]);
    if (sErr) return { error: sErr.message };
    if (vErr) return { error: vErr.message };
    for (const s of (scripts ?? []) as { concept_id: string; body: string; version: number }[]) {
      if (!scriptByConcept.has(s.concept_id)) scriptByConcept.set(s.concept_id, s);
    }
    for (const v of (vids ?? []) as { creative_id: string; transcript: string | null }[]) {
      if (v.transcript?.trim() && !transcriptByConcept.has(v.creative_id)) {
        transcriptByConcept.set(v.creative_id, v.transcript.trim());
      }
    }
  }

  // -- 3. Assemble targets. Golden (performance) rows first; a creative that is
  // both golden and staff-marked keeps the performance label.
  let skippedNoInput = 0;
  const targets: BreakdownTarget[] = [];
  for (const g of goldenRows ?? []) {
    const c = creativeById.get(g.creative_id);
    const dims = (g.dimensions ?? {}) as BreakdownDimensions;
    const script = (g.script as string | null) ?? null;
    const transcript = transcriptByConcept.get(g.creative_id) ?? (g.transcript as string | null) ?? null;
    targets.push({
      creative_id: g.creative_id,
      org_id: g.org_id,
      source: "performance",
      input_hash: breakdownInputHash(script, g.script_version ?? null, transcript, dims),
      script,
      script_version: g.script_version ?? null,
      transcript,
      dims,
      family: c ? fam(c) : null,
      why_it_won: g.why_it_won ?? null,
      cpt_cents: g.cpt_cents ?? null,
      results: g.results ?? null,
      target_cents: g.target_cents ?? null,
    });
  }
  for (const id of editorialIds) {
    const c = creativeById.get(id);
    if (!c) continue;
    const script = scriptByConcept.get(id)?.body ?? null;
    const transcript = transcriptByConcept.get(id) ?? null;
    if (!script?.trim() && !transcript?.trim()) {
      skippedNoInput++; // a hook line alone can't be decomposed
      continue;
    }
    const dims: BreakdownDimensions = {
      family: fam(c)?.name ?? null,
      hook_line: c.hook_line,
      hook_angle: c.hook_angle,
      archetype: c.archetype,
      sport: c.sport,
      format: c.format,
    };
    targets.push({
      creative_id: id,
      org_id: c.org_id,
      source: "editorial",
      input_hash: breakdownInputHash(script, scriptByConcept.get(id)?.version ?? null, transcript, dims),
      script,
      script_version: scriptByConcept.get(id)?.version ?? null,
      transcript,
      dims,
      family: fam(c),
      why_it_won: null,
      cpt_cents: null,
      results: null,
      target_cents: null,
    });
  }

  // -- 4. Diff against existing rows and plan the work. Scoped runs (a single
  // idea_status flip) only read/deactivate within their subset.
  let existingQuery = admin
    .from("winner_breakdowns")
    .select("creative_id, input_hash, status, source, why_it_won, cpt_cents, results, target_cents");
  if (only?.length) existingQuery = existingQuery.in("creative_id", only);
  const { data: existingRows, error: eErr } = await existingQuery;
  if (eErr) return { error: eErr.message };
  const plan = planBreakdownRefresh(
    targets,
    (existingRows ?? []) as ExistingBreakdownRow[],
    breakdownMaxPerRun(),
  );

  const now = new Date().toISOString();
  const counts = {
    targets: targets.length,
    generated: 0,
    failed: 0,
    reactivated: 0,
    retagged: 0,
    deactivated: 0,
    skippedNoInput,
    skippedCap: plan.skippedCap,
  };

  // -- 5. The free (non-model) transitions apply even when AI is unconfigured.
  for (const t of [...plan.reactivate, ...plan.retag]) {
    const isReactivate = plan.reactivate.includes(t);
    const { error } = await admin
      .from("winner_breakdowns")
      .update({
        status: "active",
        source: t.source,
        why_it_won: t.why_it_won,
        cpt_cents: t.cpt_cents,
        results: t.results,
        target_cents: t.target_cents,
        script_version: t.script_version,
        updated_at: now,
      })
      .eq("creative_id", t.creative_id);
    if (error) return { error: error.message };
    if (isReactivate) counts.reactivated++;
    else counts.retagged++;
  }
  if (plan.deactivate.length) {
    const { error } = await admin
      .from("winner_breakdowns")
      .update({ status: "inactive", updated_at: now })
      .in("creative_id", plan.deactivate);
    if (error) return { error: error.message };
    counts.deactivated = plan.deactivate.length;
  }

  if (plan.generate.length === 0) return counts;

  let client: Anthropic;
  try {
    client = createAnthropic();
  } catch {
    return { ...counts, notConfigured: true };
  }

  // Client voice notes parameterize the analyst prompt per org.
  const orgIds = [...new Set(plan.generate.map((t) => t.org_id))];
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, display_name, voice_note")
    .in("id", orgIds);
  const orgDesc = new Map<string, string>();
  for (const o of (orgs ?? []) as { id: string; display_name: string; voice_note: string | null }[]) {
    orgDesc.set(o.id, o.voice_note ?? o.display_name);
  }

  // -- 6. One model call per new/changed winner, sequential (tiny volume — the
  // per-run cap bounds this at breakdownMaxPerRun calls).
  for (const t of plan.generate) {
    try {
      const { system, userContent } = buildBreakdownPrompt(t, orgDesc.get(t.org_id) ?? "the client's");
      const response = await client.messages.create({
        model: BREAKDOWN_MODEL,
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        output_config: { effort: "low", format: { type: "json_schema", schema: BREAKDOWN_SCHEMA } },
        system,
        messages: [{ role: "user", content: userContent }],
      });
      if (response.stop_reason === "refusal") {
        counts.failed++;
        continue;
      }
      const textBlock = response.content.find((b) => b.type === "text");
      const breakdown = parseBreakdown(JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}"));
      if (!breakdown) {
        counts.failed++;
        continue;
      }
      const { error } = await admin.from("winner_breakdowns").upsert(
        {
          creative_id: t.creative_id,
          org_id: t.org_id,
          source: t.source,
          status: "active",
          breakdown,
          dimensions: t.dims,
          model: BREAKDOWN_MODEL,
          script_version: t.script_version,
          input_hash: t.input_hash,
          why_it_won: t.why_it_won,
          cpt_cents: t.cpt_cents,
          results: t.results,
          target_cents: t.target_cents,
          generated_at: now,
          updated_at: now,
        },
        { onConflict: "creative_id" },
      );
      if (error) counts.failed++;
      else counts.generated++;
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return { ...counts, notConfigured: true };
      counts.failed++; // one bad row never kills the run
    }
  }
  return counts;
}
