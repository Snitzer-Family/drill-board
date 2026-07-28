import Link from "next/link";
import type { Metadata } from "next";
import { signInAction } from "../actions";
import { Field, FormError, SubmitButton } from "@/components/Field";
import { Display } from "@/components/ui";
import { auth } from "@/lib/auth";
import { MOCK_PASSWORD, SEED_USERS } from "@/content/seed/users";

export const metadata: Metadata = { title: "Sign in" };

const MESSAGES: Record<string, string> = {
  invalid_credentials: "That email and password don't match.",
  rate_limited: "Too many attempts. Try again in a few minutes.",
  unknown: "Something went wrong. Try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <>
      <Display size="md" className="mt-10">Sign in</Display>
      <p className="mt-3 text-ink-muted">
        New here?{" "}
        <Link href="/register" className="text-accent underline underline-offset-4">
          Create an account
        </Link>
        .
      </p>

      <form action={signInAction} className="mt-8 space-y-5">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <FormError message={error ? (MESSAGES[error] ?? MESSAGES.unknown) : undefined} />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field label="Password" name="password" type="password" autoComplete="current-password" />
        <SubmitButton>Sign in</SubmitButton>
      </form>

      <p className="mt-5 text-sm">
        <Link
          href="/forgot-password"
          className="text-ink-muted underline underline-offset-4 hover:text-ink"
        >
          Forgot your password?
        </Link>
      </p>

      {/* Only rendered while the stub provider is active, so it can't survive
          into a real deployment by being forgotten. */}
      {auth.name === "mock" && (
        <div className="mt-10 rounded-card border border-info-border bg-info-bg p-4 text-sm text-ink-soft">
          <p className="font-semibold text-ink">Demo sign-in</p>
          <p className="mt-1.5">
            Auth is a stub. Use{" "}
            <code className="font-mono text-[0.9em]">{SEED_USERS[0].email}</code> with the
            password <code className="font-mono text-[0.9em]">{MOCK_PASSWORD}</code>.
          </p>
        </div>
      )}
    </>
  );
}
