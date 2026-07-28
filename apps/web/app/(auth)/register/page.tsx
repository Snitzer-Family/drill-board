import Link from "next/link";
import type { Metadata } from "next";
import { signUpAction } from "../actions";
import { Field, FormError, SubmitButton } from "@/components/Field";
import { Display } from "@/components/ui";

export const metadata: Metadata = { title: "Create an account" };

const MESSAGES: Record<string, string> = {
  email_taken: "There's already an account with that email.",
  weak_password: "Use at least 8 characters.",
  unknown: "Something went wrong. Try again.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <>
      <Display size="md" className="mt-10">Start free</Display>
      <p className="mt-3 text-ink-muted">
        One team, the full drill library, no card.{" "}
        <Link href="/login" className="text-accent underline underline-offset-4">
          Sign in instead
        </Link>
        .
      </p>

      <form action={signUpAction} className="mt-8 space-y-5">
        <input type="hidden" name="next" value={next ?? "/dashboard"} />
        <FormError message={error ? (MESSAGES[error] ?? MESSAGES.unknown) : undefined} />
        <Field label="Name" name="name" autoComplete="name" required={false} />
        <Field label="Email" name="email" type="email" autoComplete="email" />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
        />
        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="mt-5 text-xs text-ink-muted">
        By creating an account you agree to the{" "}
        <Link href="/legal/terms" className="underline underline-offset-4">terms</Link> and{" "}
        <Link href="/legal/privacy" className="underline underline-offset-4">privacy policy</Link>.
      </p>
    </>
  );
}
