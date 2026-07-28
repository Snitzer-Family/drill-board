import type { Plan } from "@/lib/billing/types";

// The pricing table. Local, typed, and read synchronously so /pricing stays
// static. providerPriceId stays empty until a billing vendor is chosen — the
// only edit needed here at that point.
export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Bench",
    tagline: "One team, everything you need to run a practice.",
    price: { month: 0, year: 0 },
    currency: "usd",
    features: [
      "The full drill library",
      "The animator on any device",
      "5 saved drills",
      "2 practice plans",
    ],
    limits: { savedDrills: 5, practicePlans: 2, teams: 1, aiImports: 3 },
  },
  {
    id: "coach",
    name: "Coach",
    tagline: "For the season you actually plan out.",
    price: { month: 900, year: 9000 },
    currency: "usd",
    features: [
      "Everything in Bench",
      "Unlimited saved drills and plans",
      "Printable practice sheets",
      "Import drills from a photo",
      "Your public coach profile",
    ],
    limits: { savedDrills: null, practicePlans: null, teams: 2, aiImports: 50 },
    highlighted: true,
  },
  {
    id: "club",
    name: "Club",
    tagline: "Share a drill book across a whole association.",
    price: { month: 4900, year: 49000 },
    currency: "usd",
    features: [
      "Everything in Coach",
      "Up to 20 teams",
      "Shared club drill book",
      "Coach accounts and roles",
      "Priority support",
    ],
    limits: { savedDrills: null, practicePlans: null, teams: 20, aiImports: null },
  },
];
