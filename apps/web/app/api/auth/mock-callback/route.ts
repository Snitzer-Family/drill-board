import { NextResponse, type NextRequest } from "next/server";
import { mockIssue } from "@/lib/auth/mock";
import { SEED_USERS } from "@/content/seed/users";

// Stands in for an OAuth provider's redirect back to us. It exists so the
// "Continue with Google" path is walkable end to end; a real provider replaces
// this whole file with its own callback handler.
export async function GET(req: NextRequest) {
  const next = req.nextUrl.searchParams.get("next") ?? "/dashboard";
  // Same open-redirect guard as the form actions.
  const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  await mockIssue(SEED_USERS[0]);
  return NextResponse.redirect(new URL(dest, req.nextUrl.origin));
}
