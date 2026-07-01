import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateLearnings } from "@/lib/loop/generate";

export const maxDuration = 300;

// POST /api/learnings/generate — staff triggers a fresh learnings snapshot.
export async function POST() {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const supabase = await createClient();
  const r = await generateLearnings(supabase, user!.id);
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ learning: r.learning });
}
