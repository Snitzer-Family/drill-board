import type { SessionUser } from "@/lib/auth/types";

// Seed coaches for the mock provider. Sign in as any of these with the password
// below. Replaced wholesale by a real users table when auth is wired — nothing
// but lib/auth/mock.ts imports this.
export const MOCK_PASSWORD = "coach";

export const SEED_USERS: SessionUser[] = [
  {
    id: "usr_nate",
    email: "coach@coach.vision",
    name: "Nate Snitzer",
    handle: "nate",
    avatarUrl: null,
    emailVerified: true,
    createdAt: "2026-01-14",
    roles: ["coach", "admin"],
    prefs: { theme: null, units: "imperial" },
  },
  {
    id: "usr_pat",
    email: "pat@example.com",
    name: "Pat Delacroix",
    handle: "pat",
    avatarUrl: null,
    emailVerified: true,
    createdAt: "2026-03-02",
    roles: ["coach"],
    prefs: { theme: "dark", units: "metric" },
  },
];
