// The billing contract. Same principle as lib/auth: no vendor named anywhere,
// so swapping in Stripe is a new file plus env vars.
//
// The one shape decision worth defending: listPlans() is SYNCHRONOUS and reads
// local data. That is what keeps /pricing fully static, and it means a billing
// outage can't take the pricing page down — the only thing a provider is needed
// for is checkout and the state of a specific subscription.

export type PlanId = "free" | "coach" | "club";
export type BillingInterval = "month" | "year";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Cents, per interval. 0 = free. */
  price: Record<BillingInterval, number>;
  currency: "usd";
  features: string[];
  /** null = unlimited. The keys are what withinLimit() gates on. */
  limits: {
    savedDrills: number | null;
    practicePlans: number | null;
    teams: number;
    aiImports: number | null;
  };
  highlighted?: boolean;
  /** Filled in when a provider lands; empty until then. */
  providerPriceId?: Partial<Record<BillingInterval, string>>;
}

export type SubscriptionStatus =
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled";

export interface Subscription {
  planId: PlanId;
  status: SubscriptionStatus;
  interval: BillingInterval;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  seats: number;
}

export interface BillingProvider {
  readonly name: string;
  /** Local table. Safe at build time — this is what keeps /pricing SSG. */
  listPlans(): Plan[];
  getSubscription(userId: string): Promise<Subscription>;
  createCheckoutSession(input: {
    userId: string;
    planId: PlanId;
    interval: BillingInterval;
    returnUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { userId: string; returnUrl: string }): Promise<{ url: string }>;
  handleWebhook(req: Request): Promise<Response>;
}
