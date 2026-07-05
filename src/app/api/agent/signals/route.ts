import { NextResponse } from "next/server";
import { isAuthorizedAgent } from "@/lib/agent-auth";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/agent/signals
// The seam an organic-signal research helper plugs into. Auth: `Authorization: Bearer <AGENT_API_KEY>`.
// Body: { platform, hookSummary, platformUrl?, creatorHandle?, format?, sport?,
//         contentNotes?, engagementSnapshot?, conceptFamilyId?, hookAngleId?, externalRef? }
// Inserts (or upserts by externalRef) with source='agent', review_status='pending' always —
// unlike /api/agent/scripts, there is no approve override: a human must review every
// organic signal before it can ground Ideate.
export async function POST(req: Request) {
  if (!isAuthorizedAgent(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: {
    platform?: string;
    hookSummary?: string;
    platformUrl?: string;
    creatorHandle?: string;
    format?: string;
    sport?: string;
    contentNotes?: string;
    engagementSnapshot?: unknown;
    conceptFamilyId?: string;
    hookAngleId?: string;
    externalRef?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    platform,
    hookSummary,
    platformUrl,
    creatorHandle,
    format,
    sport,
    contentNotes,
    engagementSnapshot,
    conceptFamilyId,
    hookAngleId,
    externalRef,
  } = payload;

  if (!platform || !hookSummary) {
    return NextResponse.json(
      { error: "platform and hookSummary are required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  const row = {
    platform,
    hook_summary: hookSummary,
    platform_url: platformUrl ?? null,
    creator_handle: creatorHandle ?? null,
    format: format ?? null,
    sport: sport ?? null,
    content_notes: contentNotes ?? null,
    engagement_snapshot: engagementSnapshot ?? null,
    concept_family_id: conceptFamilyId ?? null,
    hook_angle_id: hookAngleId ?? null,
    external_ref: externalRef ?? null,
    source: "agent",
    review_status: "pending",
  };

  const { data: signal, error } = externalRef
    ? await admin
        .from("organic_signals")
        .upsert(row, { onConflict: "platform,external_ref" })
        .select()
        .single()
    : await admin.from("organic_signals").insert(row).select().single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ signal }, { status: 201 });
}
