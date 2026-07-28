// The auth contract the whole site codes against. No vendor is chosen yet, and
// nothing here should ever mention one: the point of writing the interface
// first is that swapping in Supabase/Clerk/anything else later is a new file
// implementing this, plus env vars — and zero call-site changes.
//
// Shape notes that exist for a reason:
//   - getSession() returns null rather than throwing. An unauthenticated
//     visitor is the normal case, not an exception, and a throwing session read
//     turns every public page into a try/catch.
//   - the sign-in/up methods return a RESULT rather than throwing, because the
//     failure modes ("email taken", "rate limited") are things a form has to
//     render inline, not 500s.

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  /** The public profile slug, /u/[handle]. Null until the coach picks one. */
  handle: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  createdAt: string;
  roles: Array<"coach" | "admin">;
  prefs: {
    /** A theme name from drill-core's THEME_ORDER, or null for "auto". */
    theme: string | null;
    units: "imperial" | "metric";
  };
}

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_taken"
  | "weak_password"
  | "not_found"
  | "rate_limited"
  | "unknown";

export type AuthResult =
  | { ok: true; user: SessionUser }
  | { ok: false; code: AuthErrorCode; message: string };

export interface AuthProvider {
  readonly name: string;
  /** Server-only. Reads cookies/headers. Never throws — returns null instead. */
  getSession(): Promise<SessionUser | null>;
  signUp(input: { email: string; password: string; name?: string }): Promise<AuthResult>;
  signIn(input: { email: string; password: string }): Promise<AuthResult>;
  /** Returns a URL to redirect() to; the callback lands on /api/auth/callback. */
  signInWithOAuth(
    provider: "google" | "apple",
    nextPath?: string,
  ): Promise<{ redirectUrl: string }>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<{ ok: true }>;
  updateProfile(
    patch: Partial<Pick<SessionUser, "name" | "handle" | "avatarUrl" | "prefs">>,
  ): Promise<AuthResult>;
}
