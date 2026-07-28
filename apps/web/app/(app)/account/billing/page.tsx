import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { billing, listPlans, money, planOf } from "@/lib/billing";
import { Button, Card, Display, Eyebrow } from "@/components/ui";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ mock_checkout?: string; interval?: string }>;
}) {
  const user = await requireUser();
  const { mock_checkout } = await searchParams;
  const sub = await billing.getSubscription(user.id);
  const plan = planOf(sub.planId);

  return (
    <div>
      <Eyebrow>Account</Eyebrow>
      <Display size="md" className="mt-4">Billing</Display>

      {/* The simulated-checkout banner is what makes the stub honest: the flow
          is walkable end to end, and nobody can mistake it for a real payment. */}
      {mock_checkout && (
        <p className="mt-6 rounded-card border border-warn bg-info-bg px-4 py-3 text-sm text-ink-soft">
          <strong className="text-ink">Simulated checkout.</strong> No payment
          provider is connected yet, so nothing was charged and no plan changed.
        </p>
      )}

      <Card accent="blue" className="mt-8 p-5">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Current plan
        </p>
        <p className="mt-1 font-display text-2xl font-bold uppercase text-ink">
          {plan?.name ?? sub.planId}
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          {plan ? money(plan.price[sub.interval]) : "—"}
          {plan && plan.price[sub.interval] > 0 ? ` / ${sub.interval}` : ""} · status{" "}
          <span className="font-mono">{sub.status}</span>
          {sub.currentPeriodEnd && (
            <> · renews <span className="tnum">{sub.currentPeriodEnd}</span></>
          )}
        </p>
      </Card>

      <h2 className="mt-12 text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        Change plan
      </h2>
      <ul className="mt-4 grid gap-4 sm:grid-cols-3">
        {listPlans().map((p) => (
          <li key={p.id}>
            <Card accent={p.id === sub.planId ? "red" : "none"} className="flex h-full flex-col p-4">
              <p className="font-display text-lg font-bold uppercase text-ink">{p.name}</p>
              <p className="tnum mt-1 font-mono text-sm text-ink-muted">
                {money(p.price.month)}{p.price.month > 0 ? " / mo" : ""}
              </p>
              <p className="mt-2 flex-1 text-sm text-ink-muted">{p.tagline}</p>
              <div className="mt-4">
                {p.id === sub.planId ? (
                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                    Current
                  </span>
                ) : (
                  <Button href={`/account/billing?mock_checkout=${p.id}&interval=month`} variant="secondary">
                    Choose {p.name}
                  </Button>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <p className="mt-8 text-sm text-ink-muted">
        Full plan comparison on the{" "}
        <Link href="/pricing" className="text-accent underline underline-offset-4">pricing page</Link>.
      </p>
    </div>
  );
}
