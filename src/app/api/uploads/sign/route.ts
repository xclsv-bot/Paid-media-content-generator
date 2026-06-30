import { NextResponse } from "next/server";
import { getCurrentUser, canUploadVideo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildStoragePath, createSignedUpload } from "@/lib/storage";

// POST /api/uploads/sign  { creativeId, fileName, versionLabel? }
// Staff or an assigned creator. Returns a one-time signed upload target the
// browser uploads to. Which creative a creator may target is enforced by RLS on
// the visibility query below, not by this coarse gate.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!canUploadVideo(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { creativeId, fileName, versionLabel = "v1" } = await req.json();
  if (!creativeId || !fileName) {
    return NextResponse.json(
      { error: "creativeId and fileName are required" },
      { status: 400 },
    );
  }

  // Confirm the creative exists and is visible to this user (RLS-backed query).
  const supabase = await createClient();
  const { data: creative } = await supabase
    .from("creatives")
    .select("id")
    .eq("id", creativeId)
    .single();
  if (!creative) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }

  const path = buildStoragePath(creativeId, versionLabel, fileName);
  try {
    const signed = await createSignedUpload(path);
    return NextResponse.json({
      path: signed.path,
      token: signed.token,
      signedUrl: signed.signedUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to sign upload" },
      { status: 500 },
    );
  }
}
