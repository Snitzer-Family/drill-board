import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { AuthProvider, AuthResult, SessionUser } from "./types";
import { MOCK_PASSWORD, SEED_USERS } from "@/content/seed/users";

// A believable stand-in, not a toy: it issues a real signed cookie, so session
// handling, redirects and the authed layout are all exercised for real. What it
// does NOT do is store anything — mutations live for one request.
//
// The guard below is the important line in this file. A stub that reaches
// production would accept a fixed password for a seeded admin account, so it
// refuses to load there at all rather than trusting anyone to remember to flip
// AUTH_PROVIDER before launch.
if (process.env.VERCEL_ENV === "production" && process.env.AUTH_PROVIDER === "mock") {
  throw new Error(
    "The mock auth provider must never run in production. " +
      "Set AUTH_PROVIDER to a real provider, or unset VERCEL_ENV if this is a local production build.",
  );
}

const SESSION_COOKIE = "cv_session";
const HINT_COOKIE = "cv_signed_in";
const MAX_AGE = 60 * 60 * 24 * 30;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  // Dev convenience, but never silently in a deployed environment: an unsigned
  // session is a "type any user id into your cookie jar" vulnerability.
  if (!s) {
    if (process.env.VERCEL_ENV) throw new Error("AUTH_SECRET is required when deployed");
    return "dev-only-insecure-secret";
  }
  return s;
}

const sign = (v: string) => createHmac("sha256", secret()).update(v).digest("hex");

function verify(token: string): string | null {
  const at = token.lastIndexOf(".");
  if (at < 1) return null;
  const [value, sig] = [token.slice(0, at), token.slice(at + 1)];
  const expected = sign(value);
  // Constant-time: a fast string compare leaks the signature a byte at a time.
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return value;
}

const find = (pred: (u: SessionUser) => boolean) => SEED_USERS.find(pred) ?? null;

async function issue(user: SessionUser) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, `${user.id}.${sign(user.id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  // A readable HINT, carrying no authority: it exists only so the site header
  // can show "Dashboard" instead of "Sign in" on statically-generated pages,
  // which cannot read an httpOnly cookie. Forging it changes the nav links and
  // nothing else — every gate goes through the signed cookie above.
  jar.set(HINT_COOKIE, "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export const mockAuth: AuthProvider = {
  name: "mock",

  async getSession() {
    try {
      const raw = (await cookies()).get(SESSION_COOKIE)?.value;
      if (!raw) return null;
      const id = verify(raw);
      return id ? find((u) => u.id === id) : null;
    } catch {
      // cookies() throws when called outside a request scope (e.g. during
      // static generation). "Not signed in" is the right answer there.
      return null;
    }
  },

  async signIn({ email, password }): Promise<AuthResult> {
    const user = find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    // One message for both branches: distinguishing "no such account" from
    // "wrong password" is a user-enumeration oracle.
    if (!user || password !== MOCK_PASSWORD)
      return { ok: false, code: "invalid_credentials", message: "That email and password don't match." };
    await issue(user);
    return { ok: true, user };
  },

  async signUp({ email, password, name }): Promise<AuthResult> {
    if (find((u) => u.email.toLowerCase() === email.trim().toLowerCase()))
      return { ok: false, code: "email_taken", message: "There's already an account with that email." };
    if (password.length < 8)
      return { ok: false, code: "weak_password", message: "Use at least 8 characters." };
    const user: SessionUser = {
      id: `usr_${Buffer.from(email).toString("hex").slice(0, 10)}`,
      email,
      name: name ?? null,
      handle: null,
      avatarUrl: null,
      emailVerified: false,
      createdAt: new Date().toISOString().slice(0, 10),
      roles: ["coach"],
      prefs: { theme: null, units: "imperial" },
    };
    // Not persisted — the mock has no store. The session is real, so the authed
    // shell works, but the account is gone on restart. That is the honest
    // behaviour for a stub; a real provider is what makes it durable.
    await issue(user);
    return { ok: true, user };
  },

  async signInWithOAuth(provider, nextPath = "/dashboard") {
    return {
      redirectUrl: `/api/auth/mock-callback?provider=${provider}&next=${encodeURIComponent(nextPath)}`,
    };
  },

  async signOut() {
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    jar.delete(HINT_COOKIE);
  },

  async requestPasswordReset() {
    // Always "ok", deliberately: telling a caller whether the address exists is
    // the same enumeration leak as a specific sign-in error.
    return { ok: true };
  },

  async updateProfile(patch): Promise<AuthResult> {
    const user = await mockAuth.getSession();
    if (!user) return { ok: false, code: "not_found", message: "Not signed in." };
    return { ok: true, user: { ...user, ...patch, prefs: { ...user.prefs, ...patch.prefs } } };
  },
};

export const MOCK_SESSION_COOKIE = SESSION_COOKIE;
export const mockIssue = issue;
