import Link from "next/link";
import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { billing, planOf, withinLimit } from "@/lib/billing";
import { SEED_PLANS, planMinutes } from "@/content/seed/practice-plans";
import { Button, Card, Display, Eyebrow } from "@/components/ui";

export const metadata: Metadata = { title: "Practice plans" };

export default async function PlannerPage() {
  const user = await requireUser();
  const sub = await billing.getSubscription(user.id);
  const plan = planOf(sub.planId);
  const plans = SEED_PLANS.filter((p) => p.ownerId === user.id);
  const canAdd = withinLimit(sub, "practicePlans", plans.length);

  return (
    <div>
      <Eyebrow>Planner</Eyebrow>
      <Display size="md" className="mt-4">Practice plans</Display>
      <p className="mt-4 max-w-[58ch] text-ink-soft">
        A plan is a stack of timed blocks. Drills come from the library, the
        clock adds itself up, and the printed sheet is readable from the bench.
      </p>

      <div className="mt-8">
        <Button href={canAdd ? "/planner/new" : "/pricing"}>
          {canAdd ? "New plan" : `Upgrade past ${plan?.limits.practicePlans} plans`}
        </Button>
      </div>

      <ul className="mt-10 space-y-3">
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
                    <span className="tnum">{planMinutes(p)} min</span>
                  </p>
                </div>
                <span aria-hidden className="text-ink-faint">→</span>
              </Link>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
