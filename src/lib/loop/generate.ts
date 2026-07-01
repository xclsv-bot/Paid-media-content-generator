import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnthropic, NOT_CONFIGURED, Anthropic } from "@/lib/anthropic";
import { getLearningInputs } from "@/lib/loop/scoreboard";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    narrative: { type: "string" },
    do_more: { type: "array", items: { type: "string" } },
    do_less: { type: "array", items: { type: "string" } },
    watchouts: { type: "array", items: { type: "string" } },
  },
  required: ["narrative", "do_more", "do_less", "watchouts"],
} as const;

export type GenResult = { status: number; learning?: unknown; error?: string };

// Shared analyst logic: read the gated scoreboard + winners/losers, write a
// structured learnings snapshot. Used by the staff button (user client) and the
// weekly heartbeat (admin client). `supabase` must be able to insert learnings.
export async function generateLearnings(
  supabase: SupabaseClient,
  createdBy: string | null,
): Promise<GenResult> {
  const inputs = await getLearningInputs(supabase);
  if (inputs.maturedCount === 0) {
    return { status: 422, error: "Nothing has matured yet — no confident cohorts to learn from." };
  }

  const system = `You are a paid-social performance analyst for the Outlier sportsbook account. From the data below — a per-dimension scoreboard (hit rate = share of creatives at/under the ${inputs.targetDollars} CPT target) plus the top winning and losing creatives with their scripts — write the current, actionable learnings for the next round of creative.

Be specific and grounded in the numbers: name the families/angles/audiences/formats that are winning and missing, and infer WHY from the scripts (hook style, proof, structure). "do_more"/"do_less" are concrete, script-level directives a writer can act on. "watchouts" flags small-sample or compliance risks. Keep "narrative" to a short paragraph. Do not invent data not present.`;

  const userContent = `SCOREBOARD (mature cohorts, gated by trials)\n${inputs.scoreboardText}\n\nTOP WINNERS\n${inputs.winnersText}\n\nWORST PERFORMERS\n${inputs.losersText}`;

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

    const { data: saved, error } = await supabase
      .from("learnings")
      .insert({
        scope: "global",
        narrative: parsed.narrative ?? "",
        do_more: parsed.do_more ?? [],
        do_less: parsed.do_less ?? [],
        watchouts: parsed.watchouts ?? [],
        attribution: { scoreboard: inputs.scoreboardText },
        model: "claude-opus-4-8",
        created_by: createdBy,
      })
      .select()
      .single();
    if (error) return { status: 500, error: error.message };
    return { status: 200, learning: saved };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { status: 503, error: NOT_CONFIGURED };
    return { status: 500, error: e instanceof Error ? e.message : "Failed" };
  }
}
