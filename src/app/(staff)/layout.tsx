import { requireStaff } from "@/lib/auth";

// Defense-in-depth for every internal staff surface (mirrors
// src/app/client/layout.tsx): pages in this group still call requireStaff()
// where they need the user, but a future page that forgets it can no longer
// render for a creator or client. getCurrentUser() is request-cached, so the
// double check costs nothing.
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireStaff();
  return <>{children}</>;
}
