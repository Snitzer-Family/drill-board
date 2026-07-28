import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { billing, planOf } from "@/lib/billing";
import { Card, Display, Eyebrow } from "@/components/ui";
import { SEED_PLANS } from "@/content/seed/practice-plans";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const user = await requireUser();
  const sub = await billing.getSubscription(user.id);
  const plan = planOf(sub.planId);
  const teams = [...new Set(SEED_PLANS.filter((p) => p.ownerId === user.id).map((p) => p.team))];

  return (
    <div>
      <Eyebrow>Account</Eyebrow>
      <Display size="md" className="mt-4">Teams</Display>
      <p className="mt-4 text-ink-soft">
        <span className="tnum">{teams.length}</span> of{" "}
        <span className="tnum">{plan?.limits.teams ?? "—"}</span> on the {plan?.name} plan.
      </p>

      <ul className="mt-8 space-y-3">
        {teams.map((t) => (
          <Card key={t} accent="none" className="p-4">
            <p className="font-display text-base font-bold uppercase tracking-tight text-ink">{t}</p>
            <p className="mt-1 text-sm text-ink-muted">
              {SEED_PLANS.filter((p) => p.team === t).length} practice plans
            </p>
          </Card>
        ))}
      </ul>
    </div>
  );
}
