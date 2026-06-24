import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// POST /api/meta/link  { adName, creativeId, adId?, adAccountId? }
// Staff-only reconciliation: link an ad name that didn't auto-match to a creative.
// After linking, re-run the import and the rows will join.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { adName, creativeId, adId } = body;
  const adAccountId = body.adAccountId || process.env.META_AD_ACCOUNT_ID || null;
  if (!adName || !creativeId) {
    return NextResponse.json(
      { error: "adName and creativeId are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meta_ads")
    .insert({
      creative_id: creativeId,
      ad_name: adName,
      meta_ad_id: adId || `name:${adName}`,
      ad_account_id: adAccountId,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ link: data }, { status: 201 });
}
