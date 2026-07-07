import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";

// Top navigation, role-aware. Server component.
export default async function AppNav() {
  const user = await getCurrentUser();
  if (!user) return null;
  const staff = isStaff(user);
  const creator = user.role === "creator";
  const client = user.role === "client_viewer";

  return (
    <header className="border-b border-white/10">
      <nav className="mx-auto flex max-w-6xl items-center gap-1 px-6 py-3 text-sm">
        <span className="mr-4 font-semibold">XCLSV</span>
        {creator ? (
          <NavLink href="/queue">My Queue</NavLink>
        ) : client ? (
          <>
            <NavLink href="/client">Home</NavLink>
            <NavLink href="/client/library">Content</NavLink>
            <NavLink href="/client/ideas">Ideas</NavLink>
            <NavLink href="/client/insights">Insights</NavLink>
          </>
        ) : (
          <>
            <NavLink href="/ideas">Ideas</NavLink>
            {staff && <NavLink href="/ideate">Ideate</NavLink>}
            {staff && <NavLink href="/signals">Signals</NavLink>}
            {staff && <NavLink href="/patterns">Patterns</NavLink>}
            {staff && <NavLink href="/this-week">This Week</NavLink>}
            <NavLink href="/review">Review</NavLink>
            {staff && <NavLink href="/performance">Performance</NavLink>}
            {staff && <NavLink href="/winners">Winners</NavLink>}
            <NavLink href="/client">Client view</NavLink>
          </>
        )}
        <span className="ml-auto text-white/40">
          {user.name ?? user.email} · {user.role}
        </span>
      </nav>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-white/70 hover:bg-white/10 hover:text-white"
    >
      {children}
    </Link>
  );
}
