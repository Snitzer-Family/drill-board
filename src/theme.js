// The colour system. Single source of truth for BOTH the CSS custom properties
// and the JS consumers that can't read them (canvas PNG export, the print-sheet
// stylesheet string, drill-svg.js's var() fallbacks, build-drill-preview.mjs —
// an <img>-loaded SVG has no host cascade, so those need literal values).
//
// Plain ESM with NO imports on purpose: vite.config.js, scripts/*.mjs and
// node tests/*.mjs all load this file directly.
//
// Naming: --db-<tier>[-<role>]. Two rules keep the system honest —
//   1. No token is named for a colour. `brand-red`, never `red`. `ui-select`
//      and `ice-select` are separate tokens that happen to share #ffd447 today;
//      that split is what stops on-ice amber leaking into chrome (and it lets
//      light mode darken the chrome one to clear contrast without touching ice).
//   2. The `ice-*` tier is a closed set and the ONLY tier the SVG consumes.
//
// Adding a theme = one new key in THEMES + one entry in THEME_ORDER. Everything
// else iterates. tests/theme-contrast.mjs will tell you which pairs it fails.

export const THEME_ATTR = "data-theme";
export const THEME_KEY = "drillboard:theme";

// Which theme each prefers-color-scheme value maps to. Exactly two slots —
// that's all the media query gives us. A theme absent here is manual-only.
export const AUTO_MAP = { light: "light", dark: "dark" };

// `color-scheme` is pinned PER THEME, never "light dark": it's what makes the
// native range thumb, <select> popup and scrollbars render right on iOS. A UA
// left to choose would fight the manual override.
export const SCHEME = { light: "light", dark: "dark" };

export const THEMES = {
  light: {
    /* surfaces — what you put content ON */
    "surface-app": "#e7edf3",
    "surface-bar": "#f4f7fa",
    "surface-panel": "#ffffff",
    // "panel at zero alpha" for the scroll-shadow gradients. NOT `transparent`:
    // Safari interpolates that through premultiplied black and shows a haze.
    "surface-panel-0": "rgba(255,255,255,0)",
    "surface-raised": "#e9eef4",
    "surface-sunken": "#f7fafc",

    /* text — what you put ON a surface */
    text: "#14202b",
    "text-soft": "#33414f",
    "text-muted": "#576572",
    "text-faint": "#5e6b78",
    "text-on-accent": "#ffffff",

    /* borders */
    border: "#d3dde6",
    "border-strong": "#b9c6d2",
    "border-hair": "#e4eaf0",

    /* state / accent — named for meaning, not hue */
    // #0c7e7a, not the historical #0f766e: the old teal was 2.93:1 against the
    // dark panel, so a filled .hd-mini.on chip failed 1.4.11 in dark mode. This
    // clears 3:1 there while still holding white label text at 4.91:1.
    accent: "#0c7e7a",
    focus: "#0b6d66",
    danger: "#b3222f",
    "danger-border": "#e6b4ba",
    "danger-bg": "#fdeef0",
    warn: "#8a6100",
    good: "#177a41",
    info: "#1657c4",
    "info-bg": "#e6eefc",
    "info-border": "#a9c4ee",
    track: "#7c8b9a",
    "track-thumb": "#ffffff",
    "ui-select": "#a06400",
    "brand-red": "#d7263d",

    /* ice / diagram — the only tier the SVG reads */
    ice: "#f5fafd",
    "ice-surround": "#eef5f9",
    "ice-line-red": "#d7263d",
    "ice-line-blue": "#1f4fa3",
    "ice-crease": "#1f4fa3",
    "ice-boards": "#31404e",
    "ice-dash": "#ffffff",
    "ice-ink": "#14171a",
    "ice-select": "#a06400",

    /* effects — alpha, composited over a declared base in the contrast test */
    "fx-glass": "rgba(255,255,255,.86)",
    "fx-scrim": "rgba(255,255,255,.94)",
    "fx-shadow": "0 3px 12px rgba(20,32,43,.14)",
    "fx-shadow-lg": "0 8px 24px rgba(20,32,43,.20)",
    // the scroll-shadow / drop-shadow edge tint, and its zero-alpha partner for
    // gradient stops. Also NOT `transparent` — same Safari premultiply problem.
    "fx-edge": "rgba(20,32,43,.16)",
    "fx-edge-0": "rgba(20,32,43,0)",
  },

  dark: {
    "surface-app": "#0c1014",
    "surface-bar": "#11161c",
    "surface-panel": "#1a222c",
    "surface-panel-0": "rgba(26,34,44,0)",
    "surface-raised": "#212b36",
    "surface-sunken": "#0f141a",

    text: "#e8edf2",
    "text-soft": "#dbe4ec",
    "text-muted": "#8b99a8",
    "text-faint": "#8593a3",
    "text-on-accent": "#ffffff",

    border: "#2c3846",
    "border-strong": "#3a4756",
    "border-hair": "#243040",

    accent: "#0c7e7a",
    focus: "#45c1cb",
    danger: "#ff8d9c",
    "danger-border": "#4a2a30",
    "danger-bg": "#3a2126",
    warn: "#e0a92e",
    good: "#3ecf7a",
    info: "#6ea8ff",
    "info-bg": "#1c2b45",
    "info-border": "#2c477a",
    track: "#6c7d8e",
    "track-thumb": "#e8eef4",
    "ui-select": "#ffd447",
    "brand-red": "#d7263d",

    ice: "#0d151c",
    "ice-surround": "#0d151c",
    "ice-line-red": "#ff5a6a",
    "ice-line-blue": "#5f92e2",
    "ice-crease": "#4a6f9e",
    "ice-boards": "#5b7186",
    "ice-dash": "#0d151c",
    "ice-ink": "#cdd8e2",
    "ice-select": "#ffd447",

    "fx-glass": "rgba(23,29,37,.84)",
    "fx-scrim": "rgba(10,13,17,.96)",
    "fx-shadow": "0 3px 12px rgba(0,0,0,.4)",
    "fx-shadow-lg": "0 8px 24px rgba(0,0,0,.5)",
    "fx-edge": "rgba(0,0,0,.55)",
    "fx-edge-0": "rgba(0,0,0,0)",
  },
};

// Order of the Auto/Light/Dark chips in Tune → Display. "auto" is not a theme,
// it's the absence of an override.
export const THEME_ORDER = ["auto", "light", "dark"];

// Tokens holding a shadow (not a colour) — the contrast test skips parsing these.
export const SHADOW_TOKENS = ["fx-shadow", "fx-shadow-lg"];

/* ------------------------------------------------------------------ */
/* pairings the contrast test asserts                                  */

// Declared, never inferred. Inferring which text lands on which surface from
// the CSS would silently omit exactly the pairs that break.
// `over` composites an alpha bg over that token first.
export const PAIRS = [
  /* body text — WCAG 2.2 AA 1.4.3, 4.5:1 */
  { fg: "text", bg: "surface-panel", min: 4.5, why: "popup / menu body text" },
  { fg: "text", bg: "surface-raised", min: 4.5, why: ".hd-btn, .hd-stepper" },
  { fg: "text", bg: "surface-sunken", min: 4.5, why: ".hd-ta, .hd-input" },
  { fg: "text-soft", bg: "surface-raised", min: 4.5, why: ".hd-item, .hd-mini, .hd-barbtn" },
  { fg: "text-soft", bg: "surface-panel", min: 4.5, why: ".hd-poprow" },
  { fg: "text-muted", bg: "surface-panel", min: 4.5, why: ".hd-sechint, .hd-mh, .hd-note" },
  { fg: "text-muted", bg: "surface-bar", min: 4.5, why: ".hd-barhint" },
  { fg: "text-faint", bg: "surface-bar", min: 4.5, why: ".hd-ver version watermark" },
  { fg: "text-on-accent", bg: "accent", min: 4.5, why: "every .on state" },
  { fg: "text-on-accent", bg: "brand-red", min: 4.5, why: ".hd-scrubbtn.play" },
  { fg: "danger", bg: "surface-raised", min: 4.5, why: ".hd-item.danger, .hd-mini.danger" },
  { fg: "danger", bg: "surface-panel", min: 4.5, why: ".hd-err" },
  { fg: "warn", bg: "surface-panel", min: 4.5, why: "step warnings, unapplied-edit notes" },
  { fg: "good", bg: "surface-panel", min: 4.5, why: "goal-odds readout" },
  { fg: "info", bg: "surface-panel", min: 4.5, why: ".hd-mdprev a" },
  { fg: "info", bg: "info-bg", min: 4.5, why: ".hd-anchorbtn.wp waypoint chip" },
  { fg: "danger", bg: "danger-bg", min: 4.5, why: ".hd-anchorbtn.bad broken-anchor chip" },
  { fg: "text-soft", bg: "fx-glass", over: "ice", min: 4.5, why: ".hd-scrub over the ice" },
  { fg: "text-muted", bg: "fx-glass", over: "ice", min: 4.5, why: ".hd-scrubtime" },
  { fg: "text", bg: "fx-scrim", over: "ice", min: 4.5, why: ".hd-sheet overlay text" },

  /* UI + graphical objects — WCAG 2.2 AA 1.4.11, 3:1 */
  { fg: "focus", bg: "surface-panel", min: 3, why: ":focus-visible ring on a panel" },
  { fg: "focus", bg: "surface-raised", min: 3, why: ":focus-visible ring on a button" },
  { fg: "track", bg: "fx-glass", over: "ice", min: 3, why: ".hd-scrubtrack rail" },
  { fg: "track", bg: "surface-panel", min: 3, why: ".hd-sw switch track, off" },
  { fg: "track-thumb", bg: "track", min: 3, why: ".hd-sw knob vs its off track" },
  { fg: "track-thumb", bg: "accent", min: 3, why: ".hd-sw knob vs its on track" },
  // the step tick is 15px tall over a 4px rail, so the background that actually
  // identifies it is the glass panel, not the sliver of rail it crosses
  { fg: "warn", bg: "fx-glass", over: "ice", min: 3, why: ".hd-tick.step marker" },
  { fg: "ui-select", bg: "surface-panel", min: 3, why: ".hd-swatch.on selected ring" },
  { fg: "accent", bg: "surface-panel", min: 3, why: ".hd-mini.on fill vs the panel" },

  /* ice / diagram — 3:1 against the sheet they're drawn on */
  { fg: "ice-line-red", bg: "ice", min: 3, why: "goal + centre lines, faceoff circles" },
  { fg: "ice-line-blue", bg: "ice", min: 3, why: "blue lines, centre circle" },
  { fg: "ice-crease", bg: "ice", min: 3, why: "crease fill" },
  { fg: "ice-boards", bg: "ice", min: 3, why: "boards outline, inside edge" },
  { fg: "ice-boards", bg: "surface-app", min: 3, why: "boards outline, outside edge" },
  { fg: "ice-ink", bg: "ice", min: 3, why: "puck, pass + shot lines" },
  { fg: "ice-select", bg: "ice", min: 3, why: "on-ice selection ring" },
  { fg: "accent", bg: "ice", min: 3, why: "add-target crosshair" },
];

// Pairs that intentionally do NOT meet AA, each with the reason. Asserted to
// stay above a floor so a refactor can't make them vanish entirely, but exempt
// from the ratio. Honest exemptions beat a suite that's green by omission.
export const EXEMPT = [
  {
    fg: "border", bg: "surface-panel", floor: 1.1,
    why: "1.4.11 covers boundaries REQUIRED to identify a control. .hd-item is " +
      "identified by its fill and its text label; the hairline is decoration. " +
      "Raising it to 3:1 would need ~#667789 and outline the entire UI.",
  },
  {
    fg: "border-strong", bg: "surface-raised", floor: 1.1,
    why: "as above — .hd-btn / .hd-barbtn read from fill + label, not the edge",
  },
  {
    fg: "border-hair", bg: "surface-panel", floor: 1.02,
    why: ".hd-field divider — a grouping hint, conveys no state",
  },
  {
    fg: "warn", bg: "track", floor: 1.5,
    why: "where the step tick crosses the scrub rail it is low-contrast, but the " +
      "tick stands 15px against a 4px rail — it's identified against the glass " +
      "panel (asserted at 3:1 in PAIRS), not against the rail it passes through",
  },
  {
    fg: "ice-line-red", bg: "ice-crease", floor: 1.2,
    why: "the crease outline sits ON the crease; both clear 3:1 against the ICE, " +
      "which is what identifies the object. Matches a real rink.",
  },
];

/* ------------------------------------------------------------------ */
/* CSS emission                                                        */

const decls = t => Object.entries(THEMES[t]).map(([k, v]) => `--db-${k}:${v}`).join(";");

// Three layers, in this order:
//   1. :root                      — the zero-JS floor. Light tokens always exist.
//   2. @media prefers-color-scheme — upgrades to dark with no script at all.
//   3. :root[data-theme=…]        — the persisted manual override, wins on
//                                   specificity AND source order.
// The :not([data-theme]) in layer 2 is redundant given both of those; it's there
// so a future reorder of these blocks can't silently break the override.
export function themeCss() {
  const blocks = [`:root{${decls("light")};color-scheme:${SCHEME.light}}`];
  for (const [query, name] of Object.entries(AUTO_MAP)) {
    if (name === "light") continue; // already the floor
    blocks.push(
      `@media (prefers-color-scheme:${query}){:root:not([${THEME_ATTR}]){` +
      `${decls(name)};color-scheme:${SCHEME[name] || name}}}`
    );
  }
  for (const name of Object.keys(THEMES)) {
    blocks.push(
      `:root[${THEME_ATTR}="${name}"]{${decls(name)};color-scheme:${SCHEME[name] || name}}`
    );
  }
  // The app's own background lives here rather than in styles.js because
  // styles.js is injected by React — this has to be right at first paint.
  blocks.push(`html,body{margin:0;padding:0;overflow:hidden;background:var(--db-surface-app)}`);
  return blocks.join("\n");
}

// Applies the persisted override before first paint. Must be injected as a
// CLASSIC inline <script> — type="module" defers past first paint and would
// reintroduce the flash. try/catch because iOS private mode throws on access.
export const BOOT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});` +
  `if(t&&t!=="auto")document.documentElement.setAttribute(${JSON.stringify(THEME_ATTR)},t)}` +
  `catch(e){}`;

/* ------------------------------------------------------------------ */
/* JS consumers                                                        */

// "auto" (or an unknown value) resolves through the OS preference.
export const resolveTheme = (pref, prefersDark) =>
  pref && pref !== "auto" && THEMES[pref]
    ? pref
    : prefersDark ? AUTO_MAP.dark : AUTO_MAP.light;

export const tokens = name => THEMES[name] || THEMES[AUTO_MAP.light];
