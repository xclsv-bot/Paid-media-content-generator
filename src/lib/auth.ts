import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "editor" | "creator" | "client_viewer";
  org_id: string;
  organizations: { slug: string; display_name: string; is_agency: boolean } | null;
};

// Resolve the signed-in user + their app role/org. Returns null if unauthenticated.
//
// Deduped per request via React cache(): the layout (AppNav), the page, and any
// components all call this in a single render, and cache() collapses them into
// one auth.getUser() + profile query instead of repeating the round-trip.
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, email, name, role, org_id, organizations(slug, display_name, is_agency)")
    .eq("id", user.id)
    .single();

  if (!profile) return null;
  const organizations = Array.isArray(profile.organizations)
    ? profile.organizations[0] ?? null
    : profile.organizations;
  return { ...profile, organizations } as AppUser;
});

export function isStaff(u: AppUser | null): boolean {
  return !!u && !!u.organizations?.is_agency && (u.role === "admin" || u.role === "editor");
}

// Where each role lands after login (and where non-staff get bounced when
// they hit an internal page). /ideas is returned ONLY for actual staff —
// an admin/editor whose org isn't the agency (misconfigured account) gets
// the client portal instead of bouncing /ideas → requireStaff → /ideas
// forever.
export function homeFor(u: AppUser | null): string {
  if (!u) return "/login";
  if (u.role === "creator") return "/queue";
  if (isStaff(u)) return "/ideas";
  return "/client";
}

// Page guard for staff-only surfaces: anyone else is sent to their own home
// (creator → queue, client → portal) instead of a staff page they can't use.
export async function requireStaff(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!isStaff(user)) redirect(homeFor(user));
  return user!;
}
