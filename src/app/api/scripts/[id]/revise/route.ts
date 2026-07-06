import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAnthropic, NOT_CONFIGURED, Anthropic } from "@/lib/anthropic";
import { rubricText } from "@/lib/loop/rubric";

export const maxDuration = 300; // capped to plan max

const REVISE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    body: { type: "string" },
    notes: { type: "string" },
  },
  required: ["body", "notes"],
} as const;

// POST /api/scripts/:id/revise — the maker. Rewrites the script using its latest
// review's weaknesses/suggestions and saves the result as a NEW draft version.
// Staff only. The loop: draft -> review -> revise -> review again.
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
    .select("id, concept_id, body, version")
    .eq("id", id)
    .single();
  if (!script) return NextResponse.json({ error: "Script not found" }, { status: 404 });

  const { data: review } = await supabase
    .from("script_reviews")
    .select("weaknesses, suggestions, compliance_flags")
    .eq("script_id", script.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: c } = await supabase
    .from("creatives")
    .select("hook_line, hook_angle, archetype, sport, feature_pillar, format, cta, content_summary, compliance_note, concept_families(name, compliance_note)")
    .eq("id", script.concept_id)
    .single();
  const fam = Array.isArray(c?.concept_families) ? c?.concept_families[0] : c?.concept_families;

  const feedback = [
    (review?.weaknesses as string[] | null)?.length ? `Weaknesses to fix (weakest first):\n${(review!.weaknesses as string[]).map((w) => `- ${w}`).join("\n")}` : "",
    (review?.suggestions as string[] | null)?.length ? `Suggestions:\n${(review!.suggestions as string[]).map((s) => `- ${s}`).join("\n")}` : "",
    (review?.compliance_flags as string[] | null)?.length ? `Compliance risks that MUST be resolved:\n${(review!.compliance_flags as string[]).map((f) => `- ${f}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n") || "No prior review — sharpen the hook, tighten the concept to one idea, and clarify the CTA.";

  const context = [
    `Family: ${fam?.name ?? "—"}`,
    `Hook line: ${c?.hook_line ?? "—"}`,
    `Angle: ${c?.hook_angle ?? "—"} · Audience: ${c?.archetype ?? "—"} · Sport: ${c?.sport ?? "—"} · Feature: ${c?.feature_pillar ?? "—"}`,
    `Format: ${c?.format ?? "—"} · CTA: ${c?.cta ?? "—"}`,
    c?.content_summary ? `Brief: ${c.content_summary}` : "",
    fam?.compliance_note ? `FAMILY COMPLIANCE RULE: ${fam.compliance_note}` : "",
    c?.compliance_note ? `CONCEPT COMPLIANCE RULE: ${c.compliance_note}` : "",
  ].filter(Boolean).join("\n");

  const system = `You are a creative director refining a CREATIVE BRIEF for a short-form video creator on the Outlier sportsbook-research app. Rewrite the brief to address the feedback, fixing the weakest points first while keeping what already works. Keep it a BRIEF, not a script: direction, a loose example opener, tone, and guardrails — NOT timed beats, shot lists, or word-for-word voiceover. Preserve the creator's freedom.

Keep the "The concept: / Tone: / Two rules:" shape, a few short paragraphs a creator reads in 30 seconds. Wins are always the outcome of research, never luck; never frame it as picks or guaranteed wins. Stay within the compliance rules. It should still respect the quality bar the finished piece is judged on:
${rubricText()}

Return the full revised brief in "body", and a one-line "notes" on what you changed.`;

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
      output_config: { effort: "medium", format: { type: "json_schema", schema: REVISE_SCHEMA } },
      system,
      messages: [{ role: "user", content: `CONCEPT CONTEXT\n${context}\n\nCURRENT BRIEF (v${script.version})\n${script.body}\n\nREVIEW FEEDBACK\n${feedback}` }],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The writer declined this one." }, { status: 422 });
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");
    if (!parsed.body) return NextResponse.json({ error: "Empty revision" }, { status: 500 });

    const { data: latest } = await supabase
      .from("scripts")
      .select("version")
      .eq("concept_id", script.concept_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (latest?.version ?? script.version) + 1;

    const { data: saved, error } = await supabase
      .from("scripts")
      .insert({
        concept_id: script.concept_id,
        body: parsed.body,
        source: "ai",
        status: "draft",
        version,
        model: "claude-opus-4-8",
        context: { revised_from: script.id, notes: parsed.notes ?? null },
        created_by: user!.id,
      })
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ script: saved, notes: parsed.notes ?? "" }, { status: 201 });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Revision failed" }, { status: 500 });
  }
}
