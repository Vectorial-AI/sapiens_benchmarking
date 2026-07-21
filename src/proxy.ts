import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, isAuthEnabled, isValidAuthToken } from "@/lib/auth";

export async function proxy(request: NextRequest) {
  if (!isAuthEnabled()) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const authed = await isValidAuthToken(token);

  if (authed) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  const next = `${pathname}${request.nextUrl.search}`;
  if (next && next !== "/") {
    loginUrl.searchParams.set("next", next);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Protect app pages + APIs. Leave public:
     * - /benchmark (report page)
     * - /release-notes
     * - /login
     * - /sapiens-benchmark.html (iframe source)
     * - Next internals + common static assets
     */
    "/((?!_next/static|_next/image|favicon.ico|benchmark(?:/.*)?|release-notes(?:/.*)?|login(?:/.*)?|sapiens-benchmark\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?)$).*)",
  ],
};
