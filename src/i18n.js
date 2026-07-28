// The language system. Single source of truth for the language list, the
// preference key, the pre-paint boot script and the layout budgets.
//
// Plain ESM with NO imports on purpose: vite.config.js and node tests/*.mjs
// load this file directly. Same rule, same reason as theme.js — and the same
// trap: scripts/build-drill-preview.mjs inlines sibling modules by REGEX-
// STRIPPING import lines, so an import here would be silently deleted rather
// than error. The dictionaries live in src/i18n/ and are pulled together by
// src/i18n/index.js, which is free to import because nothing outside the
// bundler loads it.
//
// No browser globals at module top level either — `location` and `navigator`
// are read inside function bodies only, so bare node can import this.
//
// Adding a language = one entry in LANGS + one in LANG_AUTONYM + one dict file
// + one line in src/i18n/index.js. tests/i18n.mjs will tell you what's missing.

export const LANG_KEY = "drillboard:lang";

// Ice-hockey countries, by where the game is actually coached. Order is the
// chip order in Tune → Display.
export const LANGS = ["en", "sv", "fi", "cs", "sk", "de", "fr"];

// "auto" is not a language, it's the absence of an override.
export const LANG_ORDER = ["auto", ...LANGS];

// Autonyms — a language is ALWAYS named in itself. A Czech speaker who opens a
// German UI has to be able to find their own language, and that only works if
// the chip says "Čeština" rather than "Tschechisch". Deliberately lives here
// and NOT in the dictionaries, so it can never be "translated" by accident.
export const LANG_AUTONYM = {
  en: "English",
  sv: "Svenska",
  fi: "Suomi",
  cs: "Čeština",
  sk: "Slovenčina",
  de: "Deutsch",
  fr: "Français",
};

/* ------------------------------------------------------------------ */
/* layout budgets                                                      */

// Max rendered characters for keys under a given prefix, enforced by
// tests/i18n.mjs in EVERY language. These live here rather than in the test
// for the same reason theme.js owns PAIRS: it's a product constraint that has
// to ship with the data it constrains.
//
// The bar budget is the load-bearing one. .hd-barbtn is `width:50px;flex:none`
// with `gap:6px` (styles.js), so an overlong caption doesn't wrap or ellipsize
// — it paints straight over the neighbouring button's icon. 7 characters at
// 8.5px uppercase is what fits. These are captions under an icon; brevity is a
// feature, not a compromise. de "Zurück"(6), fi "Kumoa"(5), cs "Zpět"(4).
//
// Longest-prefix wins, so a more specific prefix can relax a general one.
export const BUDGET = {
  "bar.": 7,          // .hd-blbl under a 50px fixed-width button
  "pen.mode.": 7,     // .hd-penswopt inside the fixed-width knob switch
  "pen.tool.": 8,     // .hd-pentool in a nowrap row
  "pen.style.": 12,   // .hd-penopt popover
  "menu.item.": 28,   // .hd-item in a 230px menu (wraps, so this is taste)
  "zone.": 16,        // on-ice overlay labels, in rink feet
  "splash.": 10,      // GOAL!/SAVE! drawn at ~4.6 rink feet
};

// The budget that applies to a key, or null. Longest matching prefix wins.
export function budgetFor(key) {
  let best = null, bestLen = -1;
  for (const p of Object.keys(BUDGET)) {
    if (key.startsWith(p) && p.length > bestLen) { best = BUDGET[p]; bestLen = p.length; }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* resolution                                                          */

// "auto" (or an unknown value) resolves through the browser's language list.
// Mirrors resolveTheme(): an unknown pref falls through to auto rather than
// throwing, so a stale localStorage value from a removed language self-heals.
export function resolveLang(pref, navLangs) {
  if (pref && pref !== "auto" && LANGS.includes(pref)) return pref;
  for (const l of navLangs || []) {
    // match on the base subtag: "sv-SE" → "sv", "de-AT" → "de"
    const base = String(l).toLowerCase().split("-")[0];
    if (LANGS.includes(base)) return base;
  }
  return "en";
}

// ?lang=xx from the query string, or null.
//
// Query string, NEVER the hash: the hash is owned by #d=<url-safe-base64>
// (the shared-drill link), and a hash-based parse is one regex mistake away
// from corrupting somebody's drill. `?lang=de#d=…` is unambiguous.
export function readLangOverride(search) {
  const s = search != null ? search
    : (typeof location !== "undefined" ? location.search : "");
  const m = /[?&]lang=([A-Za-z-]+)/.exec(s || "");
  if (!m) return null;
  const base = m[1].toLowerCase().split("-")[0];
  return LANGS.includes(base) ? base : null;
}

/* ------------------------------------------------------------------ */
/* formatting helpers                                                  */

const pluralCache = {};

// Which plural form a count takes. cs/sk need one/few/many/other, fr needs
// one/many/other, the rest one/other. Intl.PluralRules is a platform built-in,
// not a dependency — but it's called in here, never at module scope, so this
// file stays safe to import under bare node and in the build config.
export function pluralCat(lang, n) {
  try {
    if (!pluralCache[lang]) pluralCache[lang] = new Intl.PluralRules(lang);
    return pluralCache[lang].select(n);
  } catch {
    return n === 1 ? "one" : "other";
  }
}

// {name} → vars.name. A missing var is left VERBATIM rather than blanked: a
// visible "{who}" on screen is a bug you can see and grep for, an empty gap
// is one you ship.
export function interpolate(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m);
}

// "a, b and c" in the target language. Replaces the hardcoded Oxford comma
// that joinAreas() used to apply to every language.
const listCache = {};
export function listJoin(lang, arr) {
  const a = (arr || []).filter(Boolean).map(String);
  if (a.length <= 1) return a[0] || "";
  try {
    if (!listCache[lang]) listCache[lang] = new Intl.ListFormat(lang, { type: "conjunction" });
    return listCache[lang].format(a);
  } catch {
    return a.length === 2 ? `${a[0]} and ${a[1]}`
      : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`;
  }
}

/* ------------------------------------------------------------------ */
/* pre-paint boot                                                      */

// Sets <html lang> before first paint. Must be injected as a CLASSIC inline
// <script> — type="module" defers past first paint. Same contract as
// theme.js's BOOT_SCRIPT; see vite.config.js.
//
// <html lang> rather than a data-* attribute: it's the standards-correct home
// for this, it drives UA hyphenation / spellcheck / VoiceOver pronunciation
// for free, and it gives styles.js the `:root[lang="de"]` escape hatches for
// the fixed-width controls that can't grow.
export const I18N_BOOT =
  `try{var L=${JSON.stringify(LANGS)},` +
  `m=/[?&]lang=([A-Za-z-]+)/.exec(location.search),` +
  `l=(m&&m[1]||localStorage.getItem(${JSON.stringify(LANG_KEY)})||"auto").toLowerCase().split("-")[0];` +
  `if(L.indexOf(l)<0){l="en";var s=navigator.languages||[navigator.language||"en"];` +
  `for(var i=0;i<s.length;i++){var b=String(s[i]).toLowerCase().split("-")[0];` +
  `if(L.indexOf(b)>=0){l=b;break}}}` +
  `document.documentElement.setAttribute("lang",l)}catch(e){}`;
