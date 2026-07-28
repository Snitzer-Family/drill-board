// Seed practice plans for the authed shell. Slugs in `drills` must exist in
// content/drills — tests/seed-integrity.mjs enforces that, because a dangling
// reference here renders a blank block rather than an error.
export interface PlanBlock {
  minutes: number;
  title: string;
  /** A drill slug, or null for a non-drill block (warm-up, water, scrimmage). */
  drill: string | null;
  note?: string;
}

export interface PracticePlan {
  id: string;
  ownerId: string;
  title: string;
  date: string;
  team: string;
  blocks: PlanBlock[];
}

export const SEED_PLANS: PracticePlan[] = [
  {
    id: "pln_tuesday",
    ownerId: "usr_nate",
    title: "Tuesday — entries and support",
    date: "2026-08-04",
    team: "U12 A",
    blocks: [
      { minutes: 8, title: "Edges and warm-up", drill: null, note: "Both ends, no pucks for the first 3." },
      { minutes: 8, title: "Give-and-Go to the Net", drill: "give-and-go-half-ice" },
      { minutes: 10, title: "Chip Off the Boards, Behind the D", drill: "chip-off-the-boards" },
      { minutes: 4, title: "Water", drill: null },
      { minutes: 12, title: "Wheel Breakout, Strong Side", drill: "wheel-breakout-strong-side" },
      { minutes: 8, title: "Small-area game", drill: null, note: "Half ice, 3v3, two-touch." },
    ],
  },
  {
    id: "pln_thursday",
    ownerId: "usr_nate",
    title: "Thursday — breakouts under pressure",
    date: "2026-08-06",
    team: "U12 A",
    blocks: [
      { minutes: 6, title: "Warm-up", drill: null },
      { minutes: 14, title: "Wheel Breakout, Strong Side", drill: "wheel-breakout-strong-side", note: "Add a forechecker after the third rep." },
      { minutes: 10, title: "Chip Off the Boards, Behind the D", drill: "chip-off-the-boards" },
      { minutes: 10, title: "Scrimmage", drill: null },
    ],
  },
];

export const planMinutes = (p: PracticePlan) =>
  p.blocks.reduce((n, b) => n + b.minutes, 0);
