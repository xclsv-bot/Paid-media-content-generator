import { NextResponse } from "next/server";
import { isAuthorizedAgent } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/agent/scripts
// The seam your script-generating agent plugs into. Auth: `Authorization: Bearer <AGENT_API_KEY>`.
// Body: { conceptId? | sheetId?, body, model?, context?, approve? }
// Inserts a new versioned script (source = 'ai', status = 'draft' unless approve).
// A human approves it in the Concept brief before it reaches a creator.
export async function POST(req: Request) {
  if (!isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    conceptId?: string;
    sheetId?: string;
    body?: string;
    model?: string;
    context?: unknown;
    approve?: boolean;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { conceptId, sheetId, body, model, context, approve } = payload;
  if (!body || (!conceptId && !sheetId)) {
    return NextResponse.json(
      { error: "body and one of conceptId / sheetId are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Resolve the concept.
  let resolvedId = conceptId ?? null;
  if (!resolvedId && sheetId) {
    const { data } = await admin
      .from("creatives")
      .select("id")
      .eq("sheet_id", sheetId)
      .maybeSingle();
    resolvedId = data?.id ?? null;
  }
  if (!resolvedId) {
    return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  }

  // Next version number for this concept.
  const { data: latest } = await admin
    .from("scripts")
    .select("version")
    .eq("concept_id", resolvedId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const version = (latest?.version ?? 0) + 1;

  const { data: script, error } = await admin
    .from("scripts")
    .insert({
      concept_id: resolvedId,
      body,
      source: "ai",
      status: approve ? "approved" : "draft",
      version,
      model: model ?? null,
      context: context ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ script }, { status: 201 });
}
