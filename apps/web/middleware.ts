import { NextResponse, type NextRequest } from "next/server";

// Two jobs, both small:
//
// 1. Publish the pathname as a header. Server components can't see the URL they
//    are rendering for, and requireUser() needs it to build ?next=.
// 2. A cheap cookie-presence redirect for the authed area, so a signed-out
//    visitor doesn't pay for a full render before being bounced. It is a fast
//    path, NOT the security boundary — the cookie is only checked for
//    existence here; requireUser() verifies the signature.

const GATED = /^\/(dashboard|planner|library|account)(\/|$)/;

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (GATED.test(pathname) && !req.cookies.has("cv_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Everything except static assets and image optimisation.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
