"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { auth } from "@/lib/auth";

// typedRoutes checks link targets at compile time, which is exactly what we
// want for the nav — but `next` here is a runtime value that has already been
// validated by safeNext(). The cast is where that validation is cashed in, so
// it is deliberately the ONLY place one appears.
const asRoute = (path: string) => path as Route;

// Failures come back as a ?error= code on the same page rather than as thrown
// state. That keeps every auth page a server component and, more usefully, means
// the forms work with JavaScript off — which is the behaviour you want from a
// sign-in page above almost any other.

// Only ever redirect to a path on this site. Without this check, ?next= is an
// open redirect: /login?next=https://evil.example sends a freshly-authenticated
// coach straight off the site.
function safeNext(raw: FormDataEntryValue | null): string {
  const s = typeof raw === "string" ? raw : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/dashboard";
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function signInAction(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const res = await auth.signIn({
    email: str(formData, "email"),
    password: str(formData, "password"),
  });
  if (!res.ok) {
    redirect(asRoute(`/login?error=${res.code}&next=${encodeURIComponent(next)}`));
  }
  redirect(asRoute(next));
}

export async function signUpAction(formData: FormData) {
  const next = safeNext(formData.get("next"));
  const res = await auth.signUp({
    email: str(formData, "email"),
    password: str(formData, "password"),
    name: str(formData, "name") || undefined,
  });
  if (!res.ok) {
    redirect(asRoute(`/register?error=${res.code}&next=${encodeURIComponent(next)}`));
  }
  redirect(asRoute(next));
}

export async function signOutAction() {
  await auth.signOut();
  redirect("/");
}

export async function requestResetAction(formData: FormData) {
  await auth.requestPasswordReset(str(formData, "email"));
  // Always the same response — see the provider comment. Telling the caller
  // whether the address exists is a user-enumeration oracle.
  redirect("/forgot-password?sent=1");
}
