import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AuthProvider, SessionUser } from "./types";
import { mockAuth } from "./mock";

// The single switch. When a real provider lands it is one more branch here and
// one new file — every call site below and in app/ stays exactly as it is.
const PROVIDERS: Record<string, AuthProvider> = {
  mock: mockAuth,
};

const chosen = process.env.AUTH_PROVIDER ?? "mock";
const provider = PROVIDERS[chosen];
if (!provider) {
  throw new Error(
    `AUTH_PROVIDER="${chosen}" is not registered. Known: ${Object.keys(PROVIDERS).join(", ")}`,
  );
}

export const auth = provider;

/** For pages that render differently when signed in but don't require it. */
export const optionalUser = (): Promise<SessionUser | null> => auth.getSession();

/**
 * For anything behind the authed shell. Redirects to /login with a `next` so
 * the coach lands back where they were aiming.
 *
 * The pathname comes from the x-pathname header that middleware.ts sets —
 * server components can't otherwise see the URL they're rendering for.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await auth.getSession();
  if (user) return user;
  const path = (await headers()).get("x-pathname") || "/dashboard";
  redirect(`/login?next=${encodeURIComponent(path)}`);
}

export type { SessionUser, AuthProvider, AuthResult } from "./types";
