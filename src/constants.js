// Rink dimensions, view boxes, palette, speeds, app version, defaults.

export const RINK = { W: 200, H: 85 };
export const VIEWS = { full: [0, 0, 200, 85], half: [100, 0, 100, 85], quarter: [100, 0, 100, 42.5] };
export const COLORS = ["#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#22262b", "#7a3fa8"];
export const SPEED = { carry: 1, pass: 7, shot: 10 };
export const vb = m => VIEWS[m].join(" ");

export const APP_VERSION = "4.24";
// DSL schema version, stamped into every serialized drill (`DSL <n>` header) so
// production builds can eventually render a drill per the version that wrote it.
// Bump ONLY on a breaking DSL change (new kinds/modifiers that older builds would
// misread). Compatibility gating is not implemented yet — this just records intent.
export const DSL_VERSION = 1;
// visual size of players/pucks/cones relative to true rink-feet scale
export const ICON_SCALE = 0.8;
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
PIECE N1 net 17 42.5
PIECE N2 net 183 42.5 face=180
`;

