import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { Card, Display, Eyebrow } from "@/components/ui";
import { Field, SubmitButton } from "@/components/Field";

export const metadata: Metadata = { title: "Account" };

const SUBPAGES = [
  { href: "/account/billing", label: "Billing", note: "Plan, invoices, cancel" },
  { href: "/account/settings", label: "Settings", note: "Theme, units, board defaults" },
  { href: "/account/team", label: "Team", note: "Rosters and coaches" },
] as const;

export default async function AccountPage() {
  const user = await requireUser();

  return (
    <div>
      <Eyebrow>Account</Eyebrow>
      <Display size="md" className="mt-4">Your profile</Display>

      <form className="mt-8 max-w-lg space-y-5">
        <Field label="Name" name="name" defaultValue={user.name ?? ""} required={false} />
        <Field label="Email" name="email" type="email" defaultValue={user.email} />
        <Field
          label="Public handle"
          name="handle"
          defaultValue={user.handle ?? ""}
          required={false}
          hint={
            user.handle
              ? `Your public page is /u/${user.handle}`
              : "Pick one to get a public coach page."
          }
        />
        <SubmitButton>Save profile</SubmitButton>
      </form>

      {user.handle && (
        <p className="mt-4 text-sm">
          <Link href={`/u/${user.handle}`} className="text-accent underline underline-offset-4">
            View your public page
          </Link>
        </p>
      )}

      <div className="mt-12 grid gap-4 sm:grid-cols-3">
        {SUBPAGES.map((s) => (
          <Card key={s.href} accent="none">
            <Link href={s.href} className="block p-4">
              <p className="font-display text-base font-bold uppercase tracking-tight text-ink">
                {s.label}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{s.note}</p>
            </Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
