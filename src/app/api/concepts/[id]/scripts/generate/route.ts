import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAnthropic, NOT_CONFIGURED, Anthropic } from "@/lib/anthropic";
import { rubricText } from "@/lib/loop/rubric";
import { insertNextScriptVersion } from "@/lib/scripts";

export const maxDuration = 300; // capped to plan max

const GEN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    body: { type: "string" },
    notes: { type: "string" },
  },
  required: ["body", "notes"],
} as const;

// Human-readable short label for a winner ad name (drop brand tokens + date).
function shortName(adName: string): string {
  const parts = adName.split(/\s*_\s*/).map((s) => s.trim());
  return parts.slice(2).filter((p) => !/^\d/.test(p)).join(" · ") || adName;
}

// POST /api/concepts/:id/scripts/generate — write the FIRST creator-ready script
// straight from the concept brief (no prior script needed). Staff only. Saved as
// an AI draft; the existing Review / Revise / Approve flow takes it from there.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id: conceptId } = await params;
  const supabase = await createClient();

  const { data: c } = await supabase
    .from("creatives")
    .select(
      "hook_line, hypothesis, hook_angle, archetype, sport, feature_pillar, format, cta, content_summary, compliance_note, concept_families(name, compliance_note), organizations(display_name, voice_note)",
    )
    .eq("id", conceptId)
    .single();
  if (!c) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  const fam = Array.isArray(c.concept_families) ? c.concept_families[0] : c.concept_families;
  const org = Array.isArray(c.organizations) ? c.organizations[0] : c.organizations;
  const clientDesc = org?.voice_note ?? org?.display_name ?? "the client's account";
  const clientName = org?.display_name ?? "the client";

  // Ground the writer in what's actually winning (proven graduates).
  const { data: winners } = await supabase
    .from("creative_metrics")
    .select("ad_name, cpa")
    .eq("verdict", "GRADUATE")
    .order("cpa", { ascending: true })
    .limit(5);
  const winningText =
    (winners ?? [])
      .map((w) => `- ${shortName(w.ad_name)}${w.cpa != null ? ` · CPA $${Number(w.cpa).toFixed(2)}` : ""}`)
      .join("\n") || "(no graduates yet — lean on the hypothesis)";

  const context = [
    `Family: ${fam?.name ?? "—"}`,
    `Hook line: ${c.hook_line ?? "—"}`,
    c.hypothesis ? `Hypothesis (what this tests): ${c.hypothesis}` : "",
    `Angle: ${c.hook_angle ?? "—"} · Audience: ${c.archetype ?? "—"} · Sport: ${c.sport ?? "—"} · Feature: ${c.feature_pillar ?? "—"}`,
    `Format: ${c.format ?? "—"} · CTA: ${c.cta ?? "—"}`,
    c.content_summary ? `Brief: ${c.content_summary}` : "",
    fam?.compliance_note ? `FAMILY COMPLIANCE RULE: ${fam.compliance_note}` : "",
    c.compliance_note ? `CONCEPT COMPLIANCE RULE: ${c.compliance_note}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = `You are a creative director briefing a short-form video creator for ${clientDesc}. Write a CREATIVE BRIEF for the concept below — NOT a script. Give the creator the idea, a starting point, and clear guardrails, then trust them to execute. Suggest, don't dictate: preserve their creative freedom. No timed beats, no shot lists, no word-for-word voiceover.

Match this shape and voice — a sharp friend putting them on game, talking TO the creator:
- "The concept:" — 2–4 sentences on what to teach or show and why it works, the rough length (~10–15s, 9:16 vertical), and a LOOSE example opener ("Open with something like '…'"). Leave execution open ("show the one move you'd make — whatever that is for you"). Anchor it in a concrete, in-season example when it helps.
- "Tone:" — one or two sentences on the voice (e.g. confident and credible, like someone who actually knows the data — not hypey, not "get rich").
- "Two rules:" — the 2–3 must-keeps and don'ts (fold in the compliance rules above, framed as creative rules), then the closing CTA.

Non-negotiables to bake into the brief: wins are always the outcome of research, never luck; never frame it as picks, locks, or guaranteed wins — it's about smarter research. Close with the concept's CTA${c.cta ? ` ("${c.cta}")` : ""} as the sign-off.

Lean on what's already working (below) for the angle, but don't copy a specific ad:
${winningText}

This brief should still respect the same quality bar the finished piece is judged on:
${rubricText(clientName)}

Return the brief in "body" (a few short paragraphs a creator reads in 30 seconds, using the "The concept: / Tone: / Two rules:" shape), and a one-line "notes" for internal staff on the strategic why.`;

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
      output_config: { effort: "medium", format: { type: "json_schema", schema: GEN_SCHEMA } },
      system,
      messages: [{ role: "user", content: `CONCEPT\n${context}` }],
    });
    if (response.stop_reason === "refusal") {
      return NextResponse.json({ error: "The writer declined this one." }, { status: 422 });
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(textBlock && "text" in textBlock ? textBlock.text : "{}");
    if (!parsed.body) return NextResponse.json({ error: "Empty script" }, { status: 500 });

    const { data: saved, error } = await insertNextScriptVersion(supabase, conceptId, {
      body: parsed.body,
      source: "ai",
      status: "draft",
      model: "claude-opus-4-8",
      context: { generated: true, notes: parsed.notes ?? null },
      created_by: user!.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ script: saved, notes: parsed.notes ?? "" }, { status: 201 });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "Generation failed" }, { status: 500 });
  }
}
