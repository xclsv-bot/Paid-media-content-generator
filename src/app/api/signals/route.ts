import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/signals — manual staff entry of an organic content signal.
// Body: { platform, hookSummary, platformUrl?, creatorHandle?, format?, sport?, contentNotes? }
// Staff-only. Always lands as source='manual', review_status='pending'.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    platform,
    hookSummary,
    platformUrl,
    creatorHandle,
    format,
    sport,
    contentNotes,
  } = await req.json();

  if (!platform || !hookSummary) {
    return NextResponse.json(
      { error: "platform and hookSummary are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organic_signals")
    .insert({
      platform,
      hook_summary: hookSummary,
      platform_url: platformUrl || null,
      creator_handle: creatorHandle || null,
      format: format || null,
      sport: sport || null,
      content_notes: contentNotes || null,
      source: "manual",
      submitted_by: user!.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ signal: data }, { status: 201 });
}
