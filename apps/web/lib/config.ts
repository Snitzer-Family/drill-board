// The board is a separate deployment on its own origin (board.coach.vision in
// production, a *.vercel.app URL on previews, localhost in dev). Every
// "Open in the board" link goes through here so there is one place to point.
export const BOARD_URL =
  process.env.NEXT_PUBLIC_BOARD_URL ?? "http://localhost:5290";

export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
