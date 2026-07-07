import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { defaultTargetCents } from "@/lib/metrics/perf";
import { latestLearnings, learningsPromptBlock } from "@/lib/loop/learnings";
import { latestOrganicSignals, organicSignalsPromptBlock } from "@/lib/loop/organic";
import { latestCrossClientPatterns, crossClientPatternsPromptBlock } from "@/lib/loop/crossClientPatterns";
import { EMPTY_CACHE_NOTE, getCachedWinners, winnerLine } from "@/lib/loop/winners-cache";
import { findNearDuplicate, getGoldenExamples, type GoldenExample } from "@/lib/loop/golden";
import { badExampleLine, EMPTY_BAD_NOTE, getBadExamples } from "@/lib/loop/bad";

export const maxDuration = 300; // give slow generations headroom (capped to plan max)

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

  // Resolve credentials from the environment (SDK order): ANTHROPIC_API_KEY,
  // then ANTHROPIC_AUTH_TOKEN, then Workload Identity Federation, then a local
  // `ant auth login` profile on disk. Construction throws if none are present.
  let client: Anthropic;
  try {
    client = new Anthropic();
  } catch {
    return NextResponse.json(
      {
        error:
          "Ideate isn't configured — add Anthropic credentials (set ANTHROPIC_API_KEY in the deployment, or run `ant auth login` in local dev).",
      },
      { status: 503 },
    );
  }

  const { messages, sources, org_id: orgId } = (await req.json()) as {
    messages: ChatMsg[];
    sources?: Source[];
    org_id?: string;
  };
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  if (!orgId) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }

  // Ground the model in the existing slate + what's winning — org-scoped: once
  // a second client's data exists in these tables, an unfiltered query would
  // mix one client's proprietary scripts/CPT figures/compliance notes into
  // another's grounding.
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("display_name, voice_note")
    .eq("id", orgId)
    .single();
  if (!org) return NextResponse.json({ error: "Unknown org_id" }, { status: 400 });
  const clientDesc = org.voice_note ?? org.display_name;

  const target = defaultTargetCents(); // cents; contract Target CPT ($30)
  const [{ data: families }, { data: proven }, { data: perf }] = await Promise.all([
    supabase.from("concept_families").select("name").eq("org_id", orgId).order("name"),
    supabase.from("creatives").select("hook_line, hook_angle, sport").eq("org_id", orgId).eq("is_proven", true).limit(8),
    supabase.from("creative_performance").select("creative_id, spend, cpt").eq("org_id", orgId).gt("spend", 0),
  const [{ data: families }, { data: proven }, cache, golden, bad] = await Promise.all([
    supabase.from("concept_families").select("name").order("name"),
    supabase.from("creatives").select("hook_line, hook_angle, sport").eq("is_proven", true).limit(8),
    getCachedWinners(supabase, 8),
    getGoldenExamples(supabase, 6),
    getBadExamples(supabase, 6),
  ]);
  const familyList = (families ?? []).map((f: { name: string }) => f.name).join(", ");
  const provenList = (proven ?? [])
    .map((p: { hook_line: string | null; hook_angle: string | null; sport: string | null }) =>
      `• "${p.hook_line}" — ${p.hook_angle ?? "?"} / ${p.sport ?? "?"}`)
    .join("\n");

  // Live performance signals: label each spent concept Hit/Miss vs the CPT target.
  type PerfRow = { creative_id: string; spend: number | null; cpt: number | null };
  type Label = {
    id: string;
    hook_line: string | null;
    hook_angle: string | null;
    archetype: string | null;
    sport: string | null;
    cpt_target_cents: number | null;
    concept_families: { name: string } | { name: string }[] | null;
  };
  const perfRows = ((perf ?? []) as PerfRow[]).filter((r) => r.cpt != null);
  let perfSignals = "(no live performance data yet — connect Meta or import a CSV)";
  if (perfRows.length) {
    const { data: labels } = await supabase
      .from("creatives")
      .select("id, hook_line, hook_angle, archetype, sport, cpt_target_cents, concept_families(name)")
      .eq("org_id", orgId)
      .in("id", perfRows.map((r) => r.creative_id));
    const byId = new Map<string, Label>();
    ((labels ?? []) as unknown as Label[]).forEach((c) => byId.set(c.id, c));
    const enriched = perfRows.map((r) => {
      const c = byId.get(r.creative_id);
      const famRaw = c?.concept_families;
      const fam = !famRaw ? "?" : Array.isArray(famRaw) ? famRaw[0]?.name ?? "?" : famRaw.name;
      const cpt = Number(r.cpt);
      return {
        cpt,
        hit: isHit(cpt, c?.cpt_target_cents ?? target),
        line: `• "${c?.hook_line ?? "?"}" — ${fam} / ${c?.hook_angle ?? "?"} / ${c?.archetype ?? "?"} / ${c?.sport ?? "?"} · CPT $${cpt.toFixed(2)}`,
      };
    });
    const winners = enriched.filter((e) => e.hit === true).sort((a, b) => a.cpt - b.cpt).slice(0, 8);
    const misses = enriched.filter((e) => e.hit === false).sort((a, b) => b.cpt - a.cpt).slice(0, 6);
    perfSignals =
      [
        winners.length ? `TOP PERFORMERS (CPT at/under target):\n${winners.map((e) => e.line).join("\n")}` : "",
        misses.length ? `UNDERPERFORMING (CPT over target):\n${misses.map((e) => e.line).join("\n")}` : "",
      ].filter(Boolean).join("\n\n") || "(spend exists but nothing is judged against target yet)";
  // Live performance signals come from the loop's stores — the winners cache,
  // the golden set, and the bad-example store, all gated at write time by
  // /api/winners/refresh — never an inline Hit/CPT filter here.
  let perfSignals: string;
  if (cache.error) {
    perfSignals = `(winners cache unavailable: ${cache.error})`;
  } else if (cache.winners.length === 0) {
    perfSignals = EMPTY_CACHE_NOTE;
  } else {
    perfSignals = `TOP PERFORMERS (proven winners from the cache — Hit + volume-gated):\n${cache.winners.map(winnerLine).join("\n")}`;
  }

  // Golden examples: the winning scripts themselves — the patterns to build on.
  const goldenLine = (g: GoldenExample) =>
    `• "${g.dimensions?.hook_line ?? "?"}" — ${g.dimensions?.family ?? "?"} / ${g.dimensions?.hook_angle ?? "?"} / ${g.dimensions?.sport ?? "?"}\n  Why it won: ${g.why_it_won}\n  Script: ${g.script.slice(0, 300)}`;
  const goldenBlock = golden.error
    ? `(golden set unavailable: ${golden.error})`
    : golden.examples.length
      ? `GOLDEN EXAMPLES (proven winning scripts — study the pattern, don't restate them):\n${golden.examples.map(goldenLine).join("\n")}`
      : "(golden set is empty — no winner has a captured script yet; the daily refresh populates it)";

  // Bad examples: proven losers + compliance rejections — the patterns to avoid.
  const losers = bad.examples.filter((b) => b.kind === "proven_loser");
  const rejections = bad.examples.filter((b) => b.kind === "review_rejection");
  const badBlock = bad.error
    ? `(bad-example store unavailable: ${bad.error})`
    : bad.examples.length
      ? [
          losers.length ? `PROVEN LOSERS (mature, volume-gated, CPT well over target):\n${losers.map(badExampleLine).join("\n")}` : "",
          rejections.length ? `COMPLIANCE REJECTIONS (scripts the reviewer failed — never repeat these mistakes):\n${rejections.map(badExampleLine).join("\n")}` : "",
        ].filter(Boolean).join("\n\n")
      : EMPTY_BAD_NOTE;
  const targetDollars = target != null ? `$${(target / 100).toFixed(2)}` : "the target";
  const learnBlock = learningsPromptBlock(await latestLearnings(supabase, orgId));
  const organicBlock = organicSignalsPromptBlock(await latestOrganicSignals(supabase));
  const patternsBlock = crossClientPatternsPromptBlock(await latestCrossClientPatterns(supabase));
  const learnBlock = learningsPromptBlock(await latestLearnings(supabase));

  const sourceList = (sources ?? [])
    .map((s) => `• [${s.type ?? "ref"}] ${s.name ?? ""}${s.note ? ` — ${s.note}` : ""}`)
    .join("\n");

  const system = `You are a senior paid-social creative strategist for XCLSV Media, working the ${clientDesc} account. You help brainstorm short-form video ad concepts (9:16 UGC/demo style) and push the best ones into the concept bank as testable ideas.

Existing concept families: ${familyList || "(none yet)"}.

Slate-proven concepts (manual flag from the original slate — editorial, not performance-derived):
${provenList || "(none yet)"}

Live performance signals (Target CPT ${targetDollars}; lower CPT is better):
${perfSignals}

${goldenBlock}

${badBlock}

Use the live signals: lean into the pattern behind the golden examples, diagnose why the losers miss and avoid their traps, never repeat a compliance mistake, and propose angles that both exploit what's working AND explore new formats/families to widen the set of winners. Do NOT near-duplicate a golden example (same family + angle + format) — vary the pattern, don't restate it.

${learnBlock || ""}

${patternsBlock || ""}

When the user shares context (call transcripts, references, performance signals) and asks for angles, propose 1–3 concrete concepts. Each concept needs: a family (reuse an existing one when it fits, or name a new one), a punchy hook line (the spoken/on-screen opener), an angle, an audience archetype (Qualifier = high-intent existing bettors; Broad-appeal = cold/casual; Mixed), a sport, a product feature/pillar, and a one-sentence hypothesis stating what it tests and why you expect it to work. Ground every concept in what the user actually shared and the live signals. If a concept is inspired by organic signal rather than the live CPT data above, say so explicitly in the hypothesis (e.g. "testing whether this organically-trending hook clears the $30 CPT gate") — organic signal is a hypothesis source, never a substitute for the CPT gate. Keep "reply" to a few sentences of strategic reasoning; put the concepts themselves in the concepts array. If the user is just chatting or refining and you have no new concept to add, return an empty concepts array.`;
When the user shares context (call transcripts, references, performance signals) and asks for angles, propose 1–3 concrete concepts. Each concept needs: a family (reuse an existing one when it fits, or name a new one), a punchy hook line (the spoken/on-screen opener), an angle, an audience archetype (Qualifier = high-intent existing bettors; Broad-appeal = cold/casual; Mixed), a sport, a product feature/pillar, and a one-sentence hypothesis stating what it tests and why you expect it to work. Ground every concept in what the user actually shared and the live signals. Keep "reply" to a few sentences of strategic reasoning; put the concepts themselves in the concepts array. If the user is just chatting or refining and you have no new concept to add, return an empty concepts array.`;

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

  try {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      // Low effort keeps the chat responsive and well under the function timeout
      // (a longer "refine" turn at medium effort was overrunning it).
      output_config: { effort: "low", format: { type: "json_schema", schema: CONCEPT_SCHEMA } },
      system,
      messages: apiMessages,
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ reply: "I can't help with that one.", concepts: [] });
    }
    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock && "text" in textBlock ? textBlock.text : "{}";
    const parsed = JSON.parse(raw);
    // Diversity guard: flag (never drop) concepts that near-duplicate a golden
    // example, so staff see the overlap and decide.
    type Concept = { family?: string | null; angle?: string | null; format?: string | null };
    const concepts = ((parsed.concepts ?? []) as Concept[]).map((con) => ({
      ...con,
      near_duplicate: findNearDuplicate(con, golden.examples),
    }));
    return NextResponse.json({ reply: parsed.reply ?? "", concepts });
  } catch (e) {
    // Missing/expired/invalid credentials → surface as "not configured".
    if (e instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        {
          error:
            "Ideate credentials are missing or invalid — set ANTHROPIC_API_KEY in the deployment, or run `ant auth login` in local dev.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Ideation failed" },
      { status: 500 },
    );
  }
}
