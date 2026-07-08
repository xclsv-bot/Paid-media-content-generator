import { requireClientView } from "@/lib/client/data";

// Defense-in-depth: every /client/* page already calls requireClientView, but
// a layout-level guard means a future page that forgets it still can't render
// for a creator or an unauthenticated visitor.
export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireClientView();
  return <>{children}</>;
}
