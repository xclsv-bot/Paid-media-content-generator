import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateLearnings } from "@/lib/loop/generate";

export const maxDuration = 300;

// POST /api/learnings/generate  { org_id }  — staff triggers a fresh learnings
// snapshot for one client org.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { org_id: orgId } = await req.json();
  if (!orgId) return NextResponse.json({ error: "org_id is required" }, { status: 400 });

  const supabase = await createClient();
  const r = await generateLearnings(supabase, user!.id, orgId);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ learning: r.learning });
}
