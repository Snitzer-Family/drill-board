import type { BillingProvider, Plan, Subscription } from "./types";
import { mockBilling } from "./mock";

const PROVIDERS: Record<string, BillingProvider> = {
  mock: mockBilling,
};

const chosen = process.env.BILLING_PROVIDER ?? "mock";
const provider = PROVIDERS[chosen];
if (!provider) {
  throw new Error(
    `BILLING_PROVIDER="${chosen}" is not registered. Known: ${Object.keys(PROVIDERS).join(", ")}`,
  );
}

export const billing = provider;
export const listPlans = () => provider.listPlans();
export const planOf = (id: string): Plan | undefined =>
  provider.listPlans().find((p) => p.id === id);

/**
 * The single entitlement check. Every gated feature calls this and nothing
 * else, which is what makes the plan table the only thing that changes when
 * limits move — and what makes a vendor swap invisible to features.
 *
 * `current` is the count BEFORE the action, so this answers "may they add one?".
 */
export function withinLimit(
  sub: Subscription,
  key: keyof Plan["limits"],
  current: number,
): boolean {
  const plan = planOf(sub.planId);
  if (!plan) return false;
  // A lapsed subscription falls back to the free plan's limits rather than
  // locking someone out of data they already have.
  if (sub.status === "past_due" || sub.status === "canceled") {
    const free = planOf("free");
    const cap = free?.limits[key];
    return cap === null || cap === undefined ? true : current < cap;
  }
  const cap = plan.limits[key];
  if (cap === null) return true;
  return current < cap;
}

/** Prices are cents; render them here so no page reinvents the formatting. */
export const money = (cents: number) =>
  cents === 0
    ? "Free"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
      }).format(cents / 100);

export type { Plan, Subscription, PlanId, BillingInterval } from "./types";
