import { NextResponse } from "next/server";
import { getCurrentUser, isStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Saved Ideate chats. GET ?org=<id> lists them; POST creates or updates one
// (the workspace autosaves after every exchange). Staff only — RLS backstops.

const MAX_JSON_CHARS = 400_000; // a chat pastes transcripts; cap runaway payloads

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const org = new URL(req.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "org is required" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ideation_conversations")
    .select("id, title, updated_at")
    .eq("org_id", org)
    .order("updated_at", { ascending: false })
    .limit(25);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isStaff(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, org_id, title, messages, sources } = (await req.json().catch(() => ({}))) as {
    id?: string;
    org_id?: string;
    title?: string;
    messages?: unknown;
    sources?: unknown;
  };
  if (!org_id) return NextResponse.json({ error: "org_id is required" }, { status: 400 });
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required" }, { status: 400 });
  }
  const payload = {
    messages,
    sources: Array.isArray(sources) ? sources : [],
    title: typeof title === "string" && title.trim() ? title.trim().slice(0, 120) : null,
  };
  if (JSON.stringify(payload).length > MAX_JSON_CHARS) {
    return NextResponse.json({ error: "Conversation too large to save" }, { status: 413 });
  }

  const supabase = await createClient();
  if (id) {
    const { data, error } = await supabase
      .from("ideation_conversations")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ conversation: data });
  }
  const { data, error } = await supabase
    .from("ideation_conversations")
    .insert({ ...payload, org_id, created_by: user!.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
