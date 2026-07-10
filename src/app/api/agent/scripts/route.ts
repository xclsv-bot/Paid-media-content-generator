import { NextResponse } from "next/server";
import { isAuthorizedAgent } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { insertNextScriptVersion } from "@/lib/scripts";
import { getGoldenExamples, findDuplicateScript } from "@/lib/loop/golden";

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

  // Output diversity gate: an agent-posted body must not near-copy a golden
  // script either (allow_duplicate overrides). Scope golden to the concept's org.
  if (!(payload as { allow_duplicate?: boolean }).allow_duplicate) {
    const { data: concept } = await admin.from("creatives").select("org_id").eq("id", resolvedId).single();
    if (concept?.org_id) {
      const { examples } = await getGoldenExamples(admin, concept.org_id, 50);
      const dup = findDuplicateScript(body, examples);
      if (dup) {
        return NextResponse.json(
          { error: `Script near-duplicates a golden example ("${dup}"). Vary it or set allow_duplicate:true.`, duplicate_of: dup },
          { status: 422 },
        );
      }
    }
  }

  // Next version number is computed inside the helper, which retries on the
  // unique(concept_id, version) collision so concurrent agent posts don't 500.
  const { data: script, error } = await insertNextScriptVersion(admin, resolvedId, {
    body,
    source: "ai",
    status: approve ? "approved" : "draft",
    model: model ?? null,
    context: context ?? null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ script }, { status: 201 });
}
