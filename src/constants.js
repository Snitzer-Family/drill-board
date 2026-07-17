// Rink dimensions, view boxes, palette, speeds, app version, defaults.

export const RINK = { W: 200, H: 85 };
export const VIEWS = { full: [0, 0, 200, 85], half: [100, 0, 100, 85], quarter: [100, 0, 100, 42.5] };
export const COLORS = ["#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#22262b", "#7a3fa8"];
export const SPEED = { carry: 1, pass: 3, shot: 10 };
export const vb = m => VIEWS[m].join(" ");

export const APP_VERSION = "2.10";
// visual size of players/pucks/cones relative to true rink-feet scale
export const ICON_SCALE = 0.8;
// build stamp injected by vite.config.js `define`; "dev" when run standalone
export const BUILD_STAMP = typeof __BUILD_STAMP__ !== "undefined" ? __BUILD_STAMP__ : "dev";

export const DEFAULT_TEXT = `RINK full
`;

