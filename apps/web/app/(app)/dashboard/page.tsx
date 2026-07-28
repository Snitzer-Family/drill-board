import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { billing, planOf, withinLimit } from "@/lib/billing";
import { SEED_PLANS, planMinutes } from "@/content/seed/practice-plans";
import { allDrills } from "@/lib/content/drills";
import { Button, Card, Display, Eyebrow, StepNumber } from "@/components/ui";
import { BOARD_URL } from "@/lib/config";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const user = await requireUser();
  const sub = await billing.getSubscription(user.id);
  const plan = planOf(sub.planId);

  const plans = SEED_PLANS.filter((p) => p.ownerId === user.id);
  const canAddPlan = withinLimit(sub, "practicePlans", plans.length);
  const featured = allDrills().filter((d) => d.featured).slice(0, 2);

  return (
    <div>
      <Eyebrow>{plan?.name ?? "Bench"} plan</Eyebrow>
      <Display size="md" className="mt-4">
        {user.name ? `Evening, ${user.name.split(" ")[0]}` : "Welcome back"}
      </Display>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button href={canAddPlan ? "/planner/new" : "/pricing"}>
          {canAddPlan ? "Plan a practice" : "Upgrade to add a plan"}
        </Button>
        <Button href={BOARD_URL} variant="secondary">Open the board</Button>
      </div>

      {/* The entitlement check is the same withinLimit() every gated feature
          calls, so the upsell can't drift from what the server enforces. */}
      {!canAddPlan && (
        <p className="mt-4 rounded-card border border-info-border bg-info-bg px-4 py-3 text-sm text-ink-soft">
          You're using {plans.length} of {plan?.limits.practicePlans} practice plans on the{" "}
          {plan?.name} plan.{" "}
          <Link href="/pricing" className="font-semibold text-accent underline underline-offset-4">
            See plans
          </Link>
          .
        </p>
      )}

      <section className="mt-12">
        <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Your next practices
        </h2>
        <ul className="mt-4 space-y-3">
          {plans.map((p) => (
            <li key={p.id}>
              <Card accent="blue">
                <Link href={`/planner/${p.id}`} className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-bold uppercase tracking-tight text-ink">
                      {p.title}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      {p.team} · <span className="tnum">{p.date}</span> ·{" "}
                      <span className="tnum">{planMinutes(p)} min</span> ·{" "}
                      <span className="tnum">{p.blocks.length}</span> blocks
                    </p>
                  </div>
                  <span aria-hidden className="text-ink-faint">→</span>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          Worth a look
        </h2>
        <ul className="mt-4 space-y-3">
          {featured.map((d, i) => (
            <li key={d.slug} className="flex gap-3">
              <StepNumber n={i + 1} />
              <div>
                <Link
                  href={`/drills/${d.slug}`}
                  className="font-semibold text-ink underline-offset-4 hover:underline"
                >
                  {d.title}
                </Link>
                <p className="mt-0.5 text-sm text-ink-muted">{d.summary}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
