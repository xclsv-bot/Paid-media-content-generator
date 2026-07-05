import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const REVIEW_STATUSES = ["pending", "approved", "rejected"];

// PATCH /api/signals/:id  { reviewStatus?, conceptFamilyId?, hookAngleId? }
// Staff-only triage: tag against existing family/hook-angle vocabulary and
// flip review_status. Only 'approved' rows ever ground Ideate.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const patch: Record<string, unknown> = {};

  if ("reviewStatus" in body) {
    if (!REVIEW_STATUSES.includes(body.reviewStatus)) {
      return NextResponse.json({ error: "Invalid reviewStatus" }, { status: 400 });
    }
    patch.review_status = body.reviewStatus;
    patch.reviewed_by = user!.id;
    patch.reviewed_at = new Date().toISOString();
  }
  if ("conceptFamilyId" in body) patch.concept_family_id = body.conceptFamilyId || null;
  if ("hookAngleId" in body) patch.hook_angle_id = body.hookAngleId || null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organic_signals")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ signal: data });
}
