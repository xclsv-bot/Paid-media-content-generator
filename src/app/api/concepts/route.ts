import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const ARCHETYPES = ["Qualifier", "Broad-appeal", "Mixed"];

// Resolve a family by name within an org (create it if new). Returns the
// concept_family_id. concept_families is org-scoped (unique on org_id, name)
// since one client's family narrative/compliance notes are not safe to share
// with another's.
async function resolveFamily(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  name: string | null | undefined,
): Promise<string | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  const { data: existing } = await supabase
    .from("concept_families")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", trimmed)
    .maybeSingle();
  if (existing?.id) return existing.id;
  const { data: created } = await supabase
    .from("concept_families")
    .insert({ org_id: orgId, name: trimmed })
    .select("id")
    .single();
  return created?.id ?? null;
}

// POST /api/concepts — create a new concept (staff). Body mirrors the brief fields.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json();
  if (!b.hook_line || !String(b.hook_line).trim()) {
    return NextResponse.json({ error: "hook_line is required" }, { status: 400 });
  }
  if (!b.org_id) {
    return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  }
  const archetype = ARCHETYPES.includes(b.archetype) ? b.archetype : null;

  const supabase = await createClient();
  const concept_family_id = await resolveFamily(supabase, b.org_id, b.family);

  const { data, error } = await supabase
    .from("creatives")
    .insert({
      org_id: b.org_id,
      concept_family_id,
      ad_name: b.ad_name || null,
      hook_line: b.hook_line,
      hypothesis: b.hypothesis || null,
      content_summary: b.content_summary || null,
      hook_angle: b.hook_angle || null,
      archetype,
      feature_pillar: b.feature_pillar || null,
      sport: b.sport || null,
      format: b.format || null,
      cta: b.cta || null,
      variant_differentiator: b.variant_differentiator || null,
      compliance_note: b.compliance_note || null,
      idea_status: b.idea_status || "Backlog",
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optionally schedule the new concept straight into the current week as a
  // deliverable (the "Add to This Week" action). Target the Active cycle if
  // there is one; otherwise the most recent OPEN (non-Closed) cycle — i.e. the
  // week you're building even before it's activated. Only a truly empty/closed
  // slate falls back to Ideas-only.
  let cycle: { id: string; label: string } | null = null;
  if (b.add_to_cycle) {
    const { data: active } = await supabase
      .from("cycles")
      .select("id, label")
      .eq("org_id", b.org_id)
      .eq("status", "Active")
      .order("starts_on", { ascending: false })
      .limit(1)
      .maybeSingle();
    let target = active ?? null;
    if (!target) {
      const { data: recentOpen } = await supabase
        .from("cycles")
        .select("id, label")
        .neq("status", "Closed")
        .order("starts_on", { ascending: false })
        .limit(1)
        .maybeSingle();
      target = recentOpen ?? null;
    }
    if (target?.id) {
      const { error: dErr } = await supabase
        .from("deliverables")
        .insert({ cycle_id: target.id, concept_id: data.id });
      if (!dErr) cycle = { id: target.id, label: target.label };
    }
  }

  return NextResponse.json({ id: data.id, cycle }, { status: 201 });
}
