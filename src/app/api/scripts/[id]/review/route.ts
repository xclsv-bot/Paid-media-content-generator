import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAnthropic, NOT_CONFIGURED, Anthropic } from "@/lib/anthropic";
import { rubricText, PASS_BAR } from "@/lib/loop/rubric";
import { latestLearnings, learningsPromptBlock } from "@/lib/loop/learnings";
import { getGoldenExamples } from "@/lib/loop/golden";
import { getBadExamples } from "@/lib/loop/bad";

export const maxDuration = 300; // capped to plan max

const REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      properties: {
        hook: { type: "integer" },
        angle_fit: { type: "integer" },
        compliance: { type: "integer" },
        structure: { type: "integer" },
        clarity: { type: "integer" },
      },
      required: ["hook", "angle_fit", "compliance", "structure", "clarity"],
    },
    overall: { type: "integer" },
    weaknesses: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } },
    compliance_flags: { type: "array", items: { type: "string" } },
  },
  required: ["scores", "overall", "weaknesses", "suggestions", "compliance_flags"],
} as const;

// POST /api/scripts/:id/review — the checker. Scores the script against the
// rubric with a stricter, higher-effort pass and persists the review. Staff only.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const supabase = await createClient();

  const { data: script } = await supabase
    .from("scripts")
    .select("id, concept_id, body, version, source")
    .eq("id", id)
    .single();
  if (!script) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  const { data: c } = await supabase
    .from("creatives")
    .select("client_org, hook_line, hook_angle, archetype, sport, feature_pillar, format, cta, content_summary, compliance_note, concept_families(name, compliance_note)")
    .eq("id", script.concept_id)
    .single();
  const fam = Array.isArray(c?.concept_families) ? c?.concept_families[0] : c?.concept_families;

  const context = [
    `Family: ${fam?.name ?? "—"}`,
    `Hook line: ${c?.hook_line ?? "—"}`,
    `Angle: ${c?.hook_angle ?? "—"}`,
    `Audience: ${c?.archetype ?? "—"}`,
    `Sport: ${c?.sport ?? "—"}`,
    `Feature/pillar: ${c?.feature_pillar ?? "—"}`,
    `Format: ${c?.format ?? "—"}`,
    `CTA: ${c?.cta ?? "—"}`,
    c?.content_summary ? `Brief: ${c.content_summary}` : "",
    fam?.compliance_note ? `FAMILY COMPLIANCE RULE: ${fam.compliance_note}` : "",
    c?.compliance_note ? `CONCEPT COMPLIANCE RULE: ${c.compliance_note}` : "",
  ].filter(Boolean).join("\n");

  const system = `You are a strict senior creative director reviewing a short-form video ad script for the Outlier sportsbook-research app. Be exacting — your job is to catch what a fast writer talked itself into, not to be encouraging. Score each criterion 1–10 (10 = excellent, ${PASS_BAR}+ = ships). Reserve 9–10 for genuinely great work.

Rubric:
${rubricText()}

Compliance is a hard gate: if the script risks any compliance rule, score compliance below ${PASS_BAR} and list the exact risk in compliance_flags. weaknesses and suggestions must be specific and actionable (quote the line, say the fix) — no generic praise.`;

  // Ground the checker in the example stores: what passing looks like (golden
  // why-it-wons) and what has already been rejected (compliance reasons).
  // Kept compact — the rubric stays the gate; these are calibration, not rules.
  const [learn, golden, bad] = await Promise.all([
    latestLearnings(supabase),
    getGoldenExamples(supabase, 2),
    getBadExamples(supabase, 3),
  ]);
  const rejectionReasons = bad.examples
    .filter((b) => b.kind === "review_rejection")
    .map((b) => `- ${b.reason}`);
  const exampleBlock = [
    golden.examples.length
      ? `WHAT PASSING LOOKS LIKE (from the golden set):\n${golden.examples.map((g) => `- "${g.dimensions?.hook_line ?? "?"}": ${g.why_it_won}`).join("\n")}`
      : "",
    rejectionReasons.length
      ? `PREVIOUSLY REJECTED FOR (do not let these recur):\n${rejectionReasons.join("\n")}`
      : "",
  ].filter(Boolean).join("\n\n");
  const learnBlock = learningsPromptBlock(learn);
  const systemFull = [system, learnBlock, exampleBlock].filter(Boolean).join("\n\n");

  let client: Anthropic;
  try {
    client = createAnthropic();
  } catch {
    return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
  }

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: REVIEW_SCHEMA } },
      system: systemFull,
      messages: [{ role: "user", content: `CONCEPT CONTEXT\n${context}\n\nSCRIPT (v${script.version})\n${script.body}` }],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The reviewer declined this one." }, { status: 422 });
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");

    // Deterministic verdict: pass only if every criterion clears the bar and
    // there are no compliance flags — don't trust the model's own verdict.
    const s = parsed.scores ?? {};
    const min = Math.min(s.hook ?? 0, s.angle_fit ?? 0, s.compliance ?? 0, s.structure ?? 0, s.clarity ?? 0);
    const flags: string[] = parsed.compliance_flags ?? [];
    const verdict = min >= PASS_BAR && (s.compliance ?? 0) >= PASS_BAR && flags.length === 0 ? "pass" : "revise";

    const { data: saved, error } = await supabase
      .from("script_reviews")
      .insert({
        script_id: script.id,
        concept_id: script.concept_id,
        scores: s,
        overall: parsed.overall ?? min,
        verdict,
        weaknesses: parsed.weaknesses ?? [],
        suggestions: parsed.suggestions ?? [],
        compliance_flags: flags,
        model: "claude-opus-4-8",
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // A compliance rejection is a free pre-spend bad example — but only when
    // it carries its reason (the flags). A reasonless rejection is never
    // persisted: the route doesn't attempt it, and bad_examples' non-empty
    // reason CHECK would refuse it anyway. Failures are reported, not
    // swallowed — the review itself is already saved either way.
    let rejection: { captured: boolean; error?: string } | undefined;
    if (verdict === "revise" && flags.length > 0) {
      const { error: beErr } = await supabase.from("bad_examples").insert({
        kind: "review_rejection",
        creative_id: script.concept_id,
        client_org: c?.client_org,
        script: script.body,
        script_version: script.version,
        reason: `Compliance: ${flags.join("; ")}`,
        dimensions: {
          family: fam?.name ?? null,
          hook_line: c?.hook_line ?? null,
          hook_angle: c?.hook_angle ?? null,
          archetype: c?.archetype ?? null,
          sport: c?.sport ?? null,
          format: c?.format ?? null,
        },
        review_id: saved.id,
      });
      rejection = beErr ? { captured: false, error: beErr.message } : { captured: true };
    }
    return NextResponse.json({ review: saved, rejection });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Review failed" }, { status: 500 });
  }
}
