import Link from "next/link";
import type { Route } from "next";
import { requireUser } from "@/lib/auth";
import { billing, planOf } from "@/lib/billing";
import { signOutAction } from "../(auth)/actions";

// Everything under this layout is gated. force-dynamic because it reads the
// session cookie — Next would otherwise try to prerender it at build time and
// bake in a signed-out shell.
export const dynamic = "force-dynamic";

const NAV: { href: Route; label: string }[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/planner", label: "Practice plans" },
  { href: "/library", label: "My drills" },
  { href: "/account", label: "Account" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // middleware.ts already bounced anyone with no cookie at all; this is the
  // check that actually verifies the signature.
  const user = await requireUser();
  const sub = await billing.getSubscription(user.id);
  const plan = planOf(sub.planId);

  return (
    <div className="mx-auto flex w-full max-w-[1180px] gap-10 px-6 py-10 lg:gap-14">
      <nav aria-label="Account" className="hidden w-48 shrink-0 md:block">
        <ul className="sticky top-24 space-y-1">
          {NAV.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                className="block rounded-chip px-3 py-2 text-sm font-medium text-ink-soft hover:bg-raised hover:text-ink"
              >
                {n.label}
              </Link>
            </li>
          ))}
          <li className="pt-4">
            <div className="rounded-card border border-line bg-panel p-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Plan
              </p>
              <p className="mt-1 font-display text-base font-bold uppercase text-ink">
                {plan?.name ?? sub.planId}
              </p>
              {sub.planId === "free" && (
                <Link
                  href="/pricing"
                  className="mt-2 inline-block text-xs font-semibold text-accent underline underline-offset-4"
                >
                  Upgrade
                </Link>
              )}
            </div>
          </li>
          <li className="pt-2">
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-chip px-3 py-2 text-sm font-medium text-ink-muted hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
