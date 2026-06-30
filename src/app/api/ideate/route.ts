import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

type ChatMsg = { role: "user" | "ai"; text: string };
type Source = { type?: string; name?: string; note?: string };

const CONCEPT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    concepts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          family: { type: "string" },
          hook: { type: "string" },
          angle: { type: "string" },
          archetype: { type: "string", enum: ["Qualifier", "Broad-appeal", "Mixed"] },
          sport: { type: "string" },
          feature: { type: "string" },
          hypothesis: { type: "string" },
        },
        required: ["family", "hook", "angle", "archetype", "sport", "feature", "hypothesis"],
      },
    },
  },
  required: ["reply", "concepts"],
} as const;

// POST /api/ideate — brainstorm with Claude using sources + performance context.
// Returns { reply, concepts[] }. Staff only.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Ideate isn't configured — set ANTHROPIC_API_KEY." },
      { status: 503 },
    );
  }

  const { messages, sources } = (await req.json()) as {
    messages: ChatMsg[];
    sources?: Source[];
  };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }

  // Ground the model in the existing slate + what's winning.
  const supabase = await createClient();
  const [{ data: families }, { data: proven }] = await Promise.all([
    supabase.from("concept_families").select("name").order("name"),
    supabase
      .from("creatives")
      .select("hook_line, hook_angle, sport")
      .eq("is_proven", true)
      .limit(8),
  ]);
  const familyList = (families ?? []).map((f: { name: string }) => f.name).join(", ");
  const provenList = (proven ?? [])
    .map((p: { hook_line: string | null; hook_angle: string | null; sport: string | null }) =>
      `• "${p.hook_line}" — ${p.hook_angle ?? "?"} / ${p.sport ?? "?"}`)
    .join("\n");

  const sourceList = (sources ?? [])
    .map((s) => `• [${s.type ?? "ref"}] ${s.name ?? ""}${s.note ? ` — ${s.note}` : ""}`)
    .join("\n");

  const system = `You are a senior paid-social creative strategist for XCLSV Media, working the Outlier sportsbook acquisition account. You help brainstorm short-form video ad concepts (9:16 UGC/demo style) and push the best ones into the concept bank as testable ideas.

Existing concept families: ${familyList || "(none yet)"}.

Recently proven winners:
${provenList || "(none yet)"}

When the user shares context (call transcripts, references, performance signals) and asks for angles, propose 1–3 concrete concepts. Each concept needs: a family (reuse an existing one when it fits, or name a new one), a punchy hook line (the spoken/on-screen opener), an angle, an audience archetype (Qualifier = high-intent existing bettors; Broad-appeal = cold/casual; Mixed), a sport, a product feature/pillar, and a one-sentence hypothesis stating what it tests and why you expect it to work. Ground every concept in what the user actually shared. Keep "reply" to a few sentences of strategic reasoning; put the concepts themselves in the concepts array. If the user is just chatting or refining and you have no new concept to add, return an empty concepts array.`;

  const apiMessages = messages.map((m) => ({
    role: m.role === "ai" ? ("assistant" as const) : ("user" as const),
    content: m.text,
  }));
  // Attach the current sources to the latest user turn for context.
  if (sourceList && apiMessages.length) {
    const last = apiMessages[apiMessages.length - 1];
    if (last.role === "user") {
      last.content = `${last.content}\n\n[Attached sources the agent should use]\n${sourceList}`;
    }
  }

  const client = new Anthropic({ apiKey });
  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: CONCEPT_SCHEMA } },
      system,
      messages: apiMessages,
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ reply: "I can't help with that one.", concepts: [] });
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";
    const parsed = JSON.parse(raw);
    return NextResponse.json({ reply: parsed.reply ?? "", concepts: parsed.concepts ?? [] });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ideation failed" },
      { status: 500 },
    );
  }
}
