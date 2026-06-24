import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createSignedReferenceUpload } from "@/lib/storage";

// POST /api/references/sign  { conceptId, fileName }
// Staff-only. Signed upload target in the private 'references' bucket.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { conceptId, fileName } = await req.json();
  if (!conceptId || !fileName) {
    return NextResponse.json(
      { error: "conceptId and fileName are required" },
      { status: 400 },
    );
  }

  const safe = String(fileName).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const path = `${conceptId}/${Date.now()}_${safe}`;
  try {
    const signed = await createSignedReferenceUpload(path);
    return NextResponse.json({ path: signed.path, token: signed.token });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to sign upload" },
      { status: 500 },
    );
  }
}
