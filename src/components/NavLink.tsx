"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Nav item with current-page highlighting. `/client` should not light up for
// `/client/library`, so match is exact for parents that have sibling links and
// prefix for detail routes (e.g. /creatives/[id] keeps nothing lit — fine).
export default function NavLink({
  href,
  children,
  exact = false,
}: {
  href: string;
  children: React.ReactNode;
  exact?: boolean;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-1.5 transition-colors ${
        active ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}
