import Link from "next/link";
import { getCurrentUser, isStaff } from "@/lib/auth";
import NavLink from "@/components/NavLink";

// Top navigation, role-aware. Staff links follow the pipeline left to right:
// generate ideas → concept bank → schedule → produce → review → measure.
export default async function AppNav() {
  const user = await getCurrentUser();
  if (!user) return null;
  const staff = isStaff(user);
  const creator = user.role === "creator";
  const client = user.role === "client_viewer";

  return (
    <header className="border-b border-white/10">
      <nav className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-6 py-3 text-sm">
        <Link href="/" className="mr-4 flex flex-shrink-0 items-center gap-1.5 font-semibold">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-emerald-400 text-[11px] font-bold text-black">X</span>
          XCLSV
        </Link>
        {creator ? (
          <NavLink href="/queue">My Queue</NavLink>
        ) : client ? (
          <>
            <NavLink href="/client" exact>Home</NavLink>
            <NavLink href="/client/library">Content</NavLink>
            <NavLink href="/client/ideas">Ideas</NavLink>
            <NavLink href="/client/insights">Insights</NavLink>
          </>
        ) : (
          <>
            <NavLink href="/ideate">Ideate</NavLink>
            <NavLink href="/ideas">Ideas</NavLink>
            <NavLink href="/this-week">This Week</NavLink>
            <NavLink href="/queue">Queue</NavLink>
            <NavLink href="/review">Review</NavLink>
            <span className="mx-1.5 h-4 w-px flex-shrink-0 bg-white/10" aria-hidden />
            <NavLink href="/performance">Performance</NavLink>
            <NavLink href="/winners">Winners</NavLink>
            <NavLink href="/patterns">Patterns</NavLink>
            <span className="mx-1.5 h-4 w-px flex-shrink-0 bg-white/10" aria-hidden />
            <NavLink href="/client">Client view</NavLink>
          </>
        )}
        <span className="ml-auto flex-shrink-0 pl-3 text-white/40">
          {user.name ?? user.email} · {user.role === "client_viewer" ? "client" : user.role}
        </span>
      </nav>
    </header>
  );
}
