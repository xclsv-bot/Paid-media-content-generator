import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Refreshes the Supabase auth session on every request and gates app routes.
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isPublic = path === "/login" || path.startsWith("/auth");
  // Machine endpoints authenticate with a bearer secret, not a session cookie.
  // Without this carve-out the cookie gate 307s Vercel cron + the agent to
  // /login and their handlers (which fail closed on a bad/missing bearer)
  // never run at all.
  if (
    path.startsWith("/api/cron") ||
    path.startsWith("/api/agent") ||
    path === "/api/winners/refresh"
  ) {
    return NextResponse.next({ request });
  }

  const toLogin = () => {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If Supabase isn't configured, don't crash every route with an opaque
  // MIDDLEWARE_INVOCATION_FAILED 500. Fail closed: public routes render (so the
  // misconfig is visible at /login), protected routes redirect there.
  if (!supabaseUrl || !supabaseAnonKey) {
    return isPublic ? NextResponse.next({ request }) : toLogin();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user && !isPublic) return toLogin();
  } catch {
    // Auth/network failure — fail closed rather than 500 the whole site.
    if (!isPublic) return toLogin();
  }

  return response;
}

export const config = {
  // Run on everything except static assets and the Next internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
