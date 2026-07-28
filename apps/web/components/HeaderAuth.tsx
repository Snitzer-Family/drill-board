"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// Most of this site is statically generated, which means the header markup is
// baked at build time and cannot know who is looking at it. Reading the session
// server-side in the root layout would make every page dynamic — a heavy price
// for two links.
//
// So the session cookie stays httpOnly and authoritative, and a separate
// readable `cv_signed_in` hint decides only which links to draw. Forging the
// hint gets you a different navbar and nothing else: every gate goes through
// requireUser(), which verifies the signed cookie.
//
// Rendering the signed-out state until mount keeps the server and first client
// render identical, so there is no hydration mismatch — just a swap on the
// next frame for signed-in visitors.
export function HeaderAuth() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(/(?:^|;\s*)cv_signed_in=1/.test(document.cookie));
  }, []);

  if (signedIn) {
    return (
      <Link
        href="/dashboard"
        className="rounded-chip bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent"
      >
        Dashboard
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/login"
        className="text-sm font-medium text-ink-soft transition-colors hover:text-ink"
      >
        Sign in
      </Link>
      <Link
        href="/register"
        className="rounded-chip bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent"
      >
        Start free
      </Link>
    </>
  );
}
