import Link from "next/link";
import type { Metadata } from "next";
import { requestResetAction } from "../actions";
import { Field, SubmitButton } from "@/components/Field";
import { Display } from "@/components/ui";

export const metadata: Metadata = { title: "Reset your password" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>;
}) {
  const { sent } = await searchParams;

  return (
    <>
      <Display size="md" className="mt-10">Reset password</Display>

      {sent ? (
        // Deliberately does not say whether the address existed.
        <div className="mt-6 rounded-card border border-info-border bg-info-bg p-4 text-sm text-ink-soft">
          <p className="font-semibold text-ink">Check your email</p>
          <p className="mt-1.5">
            If there's an account for that address, a reset link is on its way.
          </p>
        </div>
      ) : (
        <>
          <p className="mt-3 text-ink-muted">
            We'll email you a link to set a new one.
          </p>
          <form action={requestResetAction} className="mt-8 space-y-5">
            <Field label="Email" name="email" type="email" autoComplete="email" />
            <SubmitButton>Send reset link</SubmitButton>
          </form>
        </>
      )}

      <p className="mt-6 text-sm">
        <Link href="/login" className="text-ink-muted underline underline-offset-4 hover:text-ink">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
