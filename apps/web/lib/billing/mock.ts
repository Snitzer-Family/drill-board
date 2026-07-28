import { cookies } from "next/headers";
import type { BillingProvider, PlanId, Subscription } from "./types";
import { PLANS } from "@/content/seed/plans";

// Checkout is simulated with a cookie so the whole flow — pick a plan, "pay",
// come back, see the plan reflected, hit a limit, get upsold — is walkable
// before a payment vendor exists. Nothing here touches money.

const SUB_COOKIE = "cv_sub";

const FREE: Subscription = {
  planId: "free",
  status: "active",
  interval: "month",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  seats: 1,
};

export const mockBilling: BillingProvider = {
  name: "mock",

  listPlans: () => PLANS,

  async getSubscription(): Promise<Subscription> {
    try {
      const raw = (await cookies()).get(SUB_COOKIE)?.value;
      if (!raw) return FREE;
      const [planId, interval] = raw.split(":");
      if (!PLANS.some((p) => p.id === planId)) return FREE;
      const end = new Date();
      end.setMonth(end.getMonth() + (interval === "year" ? 12 : 1));
      return {
        planId: planId as PlanId,
        status: "active",
        interval: interval === "year" ? "year" : "month",
        currentPeriodEnd: end.toISOString().slice(0, 10),
        cancelAtPeriodEnd: false,
        seats: 1,
      };
    } catch {
      // Outside a request scope (static generation) — treat as signed-out free.
      return FREE;
    }
  },

  async createCheckoutSession({ planId, interval }) {
    return { url: `/account/billing?mock_checkout=${planId}&interval=${interval}` };
  },

  async createPortalSession({ returnUrl }) {
    return { url: `${returnUrl}?mock_portal=1` };
  },

  async handleWebhook() {
    return new Response("ok (mock billing: nothing to verify)", { status: 200 });
  },
};

export const MOCK_SUB_COOKIE = SUB_COOKIE;
