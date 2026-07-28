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

const LIGHT = {
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

    /* what a puck ACTION does, as a stripe down the side of its step card.
       Named for the move, not the hue: the puck arrives (gain), goes to a
       teammate (pass), goes at the net (shot), or goes to space off the boards
       or glass (loose). Decorative — every step also states its type in text —
       so these carry no contrast pair. */
    "act-gain": "#1657c4",
    "act-pass": "#177a41",
    "act-shot": "#c0182b",
    "act-loose": "#b4610d",

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
    // Hover is a FILTER, not a colour, so one rule covers every control whatever
    // it's filled with — default chip, accent-filled .on state, danger text, a
    // raw colour swatch. The direction has to flip per theme: on a light UI
    // "lighter" is invisible, so light darkens and dark lightens.
    "fx-hover": "brightness(0.955)",
};

const DARK = {
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

    /* see the light theme for what these mean */
    "act-gain": "#6ea8ff",
    "act-pass": "#3ecf7a",
    "act-shot": "#ff5a6a",
    "act-loose": "#e0731d",

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
    "fx-hover": "brightness(1.18)",
};

/* =================== PROPOSAL MOCKUPS — evaluation only ===================
   Three candidate schemes, live so they can be compared on-device. Built by
   spreading over LIGHT/DARK so they can't fall out of key parity.

   To remove: delete this block, the three entries in THEMES, their THEME_ORDER
   and THEME_LABEL entries, and TEAM_LIFT below. Nothing else references them.

   Measured facts these are answering (see the contrast test for the method):
   - ice vs surface-app is 1.04:1 in dark and 1.12:1 in light, so the rink
     barely separates from the room it sits in;
   - the six stored team colours were chosen for white ice — on #0d151c, blue
     (2.37), purple (2.72) and black (1.21) all fail 3:1;
   - no middle ground exists: a mid-slate sheet drops the worst team colour to
     1.39:1, and even a faintly tinted #e3ecf3 puts orange under 3.
   ------------------------------------------------------------------------ */

// 1. "Fresh Sheet" — light. Make the rink the BRIGHTEST surface and drop the
//    surround, so the sheet reads as lit rather than as another panel.
const SHEET = {
  ...LIGHT,
  "surface-app": "#dde5ec",
  "surface-bar": "#e9eff5",
  "surface-raised": "#e4ebf2",
  text: "#0e1a24",
  "text-muted": "#55677a",
  accent: "#10707c",          // frost cyan, hue 186 — clear of team blue at 218
  focus: "#0b6d66",
  ice: "#fbfdff",             // 1.25:1 against the room, up from 1.12
  "ui-select": "#b87e00",     // #c98a00 measured 2.89 on the brighter sheet
  "ice-select": "#b87e00",
};

// 2. "Barn" — the arena at night: the room goes properly dark, the sheet stays
//    lit. Best-measuring option (rink separation 18.8:1, every team colour keeps
//    its white-ice contrast) but dark mode then doesn't darken the biggest
//    surface on screen, and a lit rink may glare at a dark arena.
const BARN = {
  ...DARK,
  "surface-app": "#05080b",
  "surface-bar": "#0a1015",
  "surface-panel": "#131c26",
  "surface-panel-0": "rgba(19,28,38,0)",
  "surface-raised": "#1b2531",
  "surface-sunken": "#080d12",
  border: "#26323f",
  "border-strong": "#364554",
  "border-hair": "#1a242f",
  accent: "#147a86",
  // the glass player bar now composites over a LIT sheet (#3b4148, not the near
  // black it used to sit on), so its text and rail have to lift with it
  "text-muted": "#9aaec1",
  // the rail is squeezed from both sides — light enough to read on the glass
  // (3.23) but dark enough for its own knob (3.20), which has to go pure white
  track: "#8292a2",
  "track-thumb": "#ffffff",
  // the sheet and everything on it revert to the light treatment
  ice: "#fbfdff",
  "ice-line-red": "#d7263d",
  "ice-line-blue": "#1f4fa3",
  "ice-crease": "#1f4fa3",
  // the boards outline is the one thing straddling both worlds — lit sheet
  // inside, near-black room outside — so it needs 3:1 against BOTH
  "ice-boards": "#545f69",
  "ice-dash": "#ffffff",
  "ice-ink": "#14171a",
  "ice-select": "#b87e00",
};

// 3. "Slate" — keeps the dark rink and fixes what sits ON it instead: the sheet
//    lifts for separation, and team colours get a per-theme RENDERED value (see
//    TEAM_LIFT) while their stored DSL value never changes.
const SLATE = {
  ...DARK,
  "surface-app": "#04070a",
  "surface-bar": "#090f15",
  "surface-panel": "#141d27",
  "surface-panel-0": "rgba(20,29,39,0)",
  "surface-raised": "#1c2733",
  accent: "#137d89",       // 3.08 on the slate sheet, 3.49 on its panel
  ice: "#1a2836",             // 1.35:1 against the room, up from 1.04
  "ice-surround": "#1a2836",
  "ice-line-red": "#ff6472",
  "ice-line-blue": "#6ba3f0",
  "ice-crease": "#547399",
  "ice-boards": "#6a819a",
  "ice-dash": "#1a2836",
  "ice-ink": "#d6e2ee",
};

// Per-theme RENDERED team colours. The stored DSL value is never touched — this
// is the same trick that rescued the puck: hue and saturation are held and only
// lightness moves, so a red player still reads red. Keyed by the stored hex.
// A theme absent here renders team colours exactly as authored.
export const TEAM_LIFT = {
  slate: {
    "#d7263d": "#de475b",   // red     3.71 -> 4.53 on the slate sheet
    "#1f4fa3": "#457bdc",   // blue    2.37 -> 4.50
    "#1f8a4c": "#20904f",   // green   4.20 -> 4.51
    "#e0731d": "#c46519",   // orange  5.82 -> 4.58
    "#22262b": "#727f90",   // black   1.21 -> 4.52
    "#7a3fa8": "#9c67c6",   // purple  2.72 -> 4.53
  },
};
// stored colour -> what this theme should actually paint
export const teamInk = (theme, stored) =>
  (TEAM_LIFT[theme] && TEAM_LIFT[theme][String(stored).toLowerCase()]) || stored;

/* ================= end proposal mockups ================= */

export const THEMES = { light: LIGHT, dark: DARK, sheet: SHEET, barn: BARN, slate: SLATE };

// Order of the chips in Tune → Display. "auto" is not a theme, it's the absence
// of an override — only light/dark are reachable from the OS preference, so the
// proposal schemes are manual-only by construction.
export const THEME_ORDER = ["auto", "light", "dark", "sheet", "barn", "slate"];
export const THEME_LABEL = {
  auto: "Auto", light: "Light", dark: "Dark",
  sheet: "Sheet", barn: "Barn", slate: "Slate",
};

// Tokens that aren't colours — box-shadow values and the hover filter. The
// contrast test skips parsing these rather than failing on them.
export const NON_COLOR_TOKENS = ["fx-shadow", "fx-shadow-lg", "fx-hover"];

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
