import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/videos  — register a VideoAsset row AFTER the browser finished the
// direct upload to storage. Staff, or a creator assigned to the concept
// (RLS on video_assets enforces the assignment on insert).
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || (!isStaff(user) && user.role !== "creator")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    creativeId,
    storagePath,
    fileName,
    versionLabel = "v1",
    sizeBytes = null,
    durationS = null,
    contentType = "video/mp4",
  } = body;

  if (!creativeId || !storagePath || !fileName) {
    return NextResponse.json(
      { error: "creativeId, storagePath and fileName are required" },
      { status: 400 },
    );
  }
  // The path must be one /api/uploads/sign minted for THIS creative — anything
  // else would let a row point at (and later sign downloads for) another
  // concept's master files.
  if (
    typeof storagePath !== "string" ||
    storagePath.includes("..") ||
    !storagePath.startsWith(`${creativeId}/`)
  ) {
    return NextResponse.json({ error: "Invalid storagePath" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("video_assets")
    .insert({
      creative_id: creativeId,
      storage_path: storagePath,
      file_name: fileName,
      version_label: versionLabel,
      size_bytes: sizeBytes,
      duration_s: durationS,
      content_type: contentType,
      uploaded_by: user!.id,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ video: data }, { status: 201 });
}

// GET /api/videos?org=<org_id>&transcribed=1 — recent production cuts that have
// a transcript, with their concept's hook line. Feeds Ideate's source picker:
// what the creators actually SAID in delivered cuts is first-class ideation
// fuel alongside reference videos.
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "org is required" }, { status: 400 });

  const supabase = await createClient();
  let q = supabase
    .from("video_assets")
    .select("id, file_name, transcript, transcribed_at, creatives!inner(id, hook_line, ad_name, org_id)")
    .not("transcript", "is", null)
    .order("transcribed_at", { ascending: false })
    .limit(12)
    .eq("creatives.org_id", org);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const videos = (data ?? []).map((v) => {
    const c = Array.isArray(v.creatives) ? v.creatives[0] : v.creatives;
    return {
      id: v.id,
      file_name: v.file_name,
      transcript: v.transcript,
      hook_line: (c as { hook_line?: string | null })?.hook_line ?? null,
    };
  });
  return NextResponse.json({ videos });
}
