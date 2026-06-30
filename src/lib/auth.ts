import { createClient } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "editor" | "client_viewer" | "creator";
  org: "XCLSV" | "Outlier";
};

// Resolve the signed-in user + their app role/org. Returns null if unauthenticated.
export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, email, name, role, org")
    .eq("id", user.id)
    .single();

  return (profile as AppUser) ?? null;
}

export function isStaff(u: AppUser | null): boolean {
  return !!u && u.org === "XCLSV" && (u.role === "admin" || u.role === "editor");
}

// A restricted creator (assigned-deliverable scope). Never staff.
export function isCreator(u: AppUser | null): boolean {
  return !!u && u.role === "creator";
}

// Who may upload a video / register a VideoAsset. Staff for any concept; a
// creator only for concepts assigned to them — the per-row check is enforced by
// RLS (va_creator_write / creatives_creator_read), this is just the coarse gate.
export function canUploadVideo(u: AppUser | null): boolean {
  return isStaff(u) || isCreator(u);
}
