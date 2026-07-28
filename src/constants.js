// Rink dimensions, view boxes, palette, speeds, app version, defaults.

export const RINK = { W: 200, H: 85 };
export const VIEWS = { full: [0, 0, 200, 85], half: [100, 0, 100, 85], quarter: [100, 0, 100, 42.5] };
export const COLORS = ["#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#22262b", "#7a3fa8"];
export const SPEED = { carry: 1, pass: 7, shot: 10 };
export const vb = m => VIEWS[m].join(" ");

// The coach's whiteboard shorthand — offered both as a player NAME preset and as
// the whiteboard symbol, so the two read as one vocabulary and translate freely.
export const WB_SYMS = ["X", "O", "F", "D", "G", "C", "W", "CO", "LW", "RW", "LD", "RD", "△", "○", "□"];
// What a player actually draws in whiteboard mode: an explicit sym= wins, else
// the NAME is the symbol — except an auto-assigned P1/P2 id, which falls back to
// the classic X. Clamped to 3 chars: the DSL doesn't cap label length, only the
// popup input does, and a long imported name would blow out the glyph.
export const symOf = p => {
  const s = (p.sym || "").trim();
  if (s) return s.slice(0, 3);
  const l = (p.label || "").trim();
  return l && !/^P\d+$/.test(l) ? l.slice(0, 3) : "X";
};

// Interface typefaces. All are already ON the device — no web font, because
// that would be a network fetch and a new dependency, and this app gets used in
// a cold rink with no signal. Each stack ends at the system face, so a device
// without the named one simply looks like "System".
//   rounded — SF Pro Rounded on Apple. Can only be judged on an iPhone: Chrome
//     on macOS resolves ui-rounded to the plain system face, so it renders
//     identically there and a desktop screenshot says nothing about it.
//   avenir  — measures ~6% narrower per caption than SF Pro, so it costs no room
//   verdana — the most legible at 11.5px, but ~8% wider and it eats the hint
export const TYPEFACES = [
  ["system", "System", 'system-ui, -apple-system, "Segoe UI", sans-serif'],
  ["rounded", "Rounded", 'ui-rounded, "SF Pro Rounded", system-ui, -apple-system, sans-serif'],
  ["avenir", "Avenir", '"Avenir Next", Avenir, system-ui, -apple-system, sans-serif'],
  ["verdana", "Verdana", 'Verdana, Geneva, system-ui, sans-serif'],
];
export const TYPEFACE_KEY = "drillboard:typeface";

export const APP_VERSION = "6.80";
// DSL schema version, stamped into every serialized drill (`DSL <n>` header) so
// production builds can eventually render a drill per the version that wrote it.
// Bump ONLY on a breaking DSL change (new kinds/modifiers that older builds would
// misread). Compatibility gating is not implemented yet — this just records intent.
export const DSL_VERSION = 9;
// visual size of players/pucks/cones relative to true rink-feet scale
export const ICON_SCALE = 0.8;
// a route line starts this many rink feet clear of the player icon (drawing only —
// timing still measures from the true start point)
export const ROUTE_START_GAP = 3;
// build stamp injected by vite.config.js `define`; "dev" when run standalone
export const BUILD_STAMP = typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "dev";

// odds a shot on a goalie is stopped (else it beats the goalie for a goal)
export const SAVE_PROB = 0.5;
// a free shot on an EMPTY net usually scores; these are the miss odds (the rest
// of the probability mass is a goal). A miss rings the post and rebounds, sails
// wide into the corner, or flies over the net.
export const MISS_POST = 0.12;
export const MISS_WIDE = 0.11;
export const MISS_OVER = 0.11;
// odds any shot is taken in the AIR (sauce-style rise + shadow, dropping at the
// net) vs flat along the ice. An "over the net" miss is always airborne.
export const SHOT_AIR_PROB = 0.4;
// fraction of speed a missed puck keeps when it caroms off a board or post
// (restitution); 1 = perfectly elastic, lower = the boards absorb more energy
export const BOUNCE_REST = 0.6;

export const DEFAULT_TEXT = `RINK full
PIECE N1 net 11 42.5
PIECE N2 net 189 42.5 face=180
`;

