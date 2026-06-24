import { createClient } from "@/lib/supabase/server";

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  role: "admin" | "editor" | "client_viewer";
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
