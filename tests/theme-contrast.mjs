// node tests/theme-contrast.mjs — asserts every declared foreground/background
// pairing in src/theme.js meets its WCAG 2.2 AA contrast threshold, in EVERY
// theme, and that the token set stays complete and the collapse doesn't decay.
//
// Dependency-free (the app is React-only by policy), same check()/tally shape
// as tests/drill-fit.mjs.
//
// Adoption debt lives in KNOWN below: those checks are reported but don't fail
// the run — AND the run fails if a KNOWN entry starts passing, so the list
// can't rot. That keeps this usable as a gate while the migration lands.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { THEMES, PAIRS, EXEMPT, SHADOW_TOKENS, AUTO_MAP, themeCss } from "../src/theme.js";

let passed = 0, failed = 0, known = 0;
// Empty is the goal state. Add a check name here only to land a migration in
// stages; the run FAILS once the entry starts passing, so it can't rot.
const KNOWN = new Set([]);

const check = (name, fn) => {
  try {
    fn();
    if (KNOWN.has(name)) {
      console.log(`FAIL  ${name}\n      listed in KNOWN but now PASSES — remove it from the list`);
      failed++;
    } else { passed++; console.log(`ok    ${name}`); }
  } catch (e) {
    if (KNOWN.has(name)) { known++; console.log(`todo  ${name}\n      ${e.message}`); }
    else { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); }
  }
};

/* ---------------- WCAG 2.x contrast math ---------------- */

// WCAG 2.0 "relative luminance": sRGB channel -> linear light
const toLinear = c => {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const parseHex = h => {
  let s = String(h).trim().replace(/^#/, "");
  if (s.length === 3) s = s.split("").map(x => x + x).join("");
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
};
const parseRgba = s => {
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i
    .exec(String(s).trim());
  if (!m) return null;
  return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] };
};
const luminance = ([r, g, b]) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
// WCAG 2.0 "contrast ratio"
const contrast = (fg, bg) => {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};
// src-over compositing. Needed for real answers: .hd-scrub is rgba(...,.84)
// over the ice, and measuring text against the UNBLENDED rgba is wrong in
// both directions depending on which is lighter.
const over = (top, bottomRgb) => {
  const t = parseRgba(top);
  if (!t) return parseHex(top);
  return t.rgb.map((c, i) => Math.round(c * t.a + bottomRgb[i] * (1 - t.a)));
};

// Resolve a token to an rgb triple, compositing over `base` if it has alpha.
const rgbOf = (theme, token, baseToken) => {
  const raw = THEMES[theme][token];
  assert.ok(raw !== undefined, `theme "${theme}" is missing token "${token}"`);
  const base = baseToken
    ? rgbOf(theme, baseToken)
    : [255, 255, 255]; // only reached for an alpha token with no declared base
  const rgb = over(raw, base);
  assert.ok(rgb, `token "${token}" in "${theme}" is not a colour: ${raw}`);
  return rgb;
};
const r2 = n => Math.round(n * 100) / 100;

/* ---------------- per-theme assertions ---------------- */

const REF = Object.keys(THEMES[AUTO_MAP.light]).sort();

for (const theme of Object.keys(THEMES)) {
  check(`${theme}: declares every token`, () => {
    assert.deepEqual(Object.keys(THEMES[theme]).sort(), REF,
      `token set differs from "${AUTO_MAP.light}"`);
  });

  check(`${theme}: every value parses`, () => {
    for (const [k, v] of Object.entries(THEMES[theme])) {
      if (SHADOW_TOKENS.includes(k)) {
        assert.match(v, /\d+px/, `${k} should look like a shadow, got "${v}"`);
        continue;
      }
      assert.ok(parseHex(v) || parseRgba(v), `${k} is not a colour: "${v}"`);
    }
  });

  for (const p of PAIRS) {
    const label = `${theme}: ${p.fg} on ${p.bg}${p.over ? ` over ${p.over}` : ""} >= ${p.min}`;
    check(label, () => {
      const ratio = contrast(rgbOf(theme, p.fg), rgbOf(theme, p.bg, p.over));
      assert.ok(ratio >= p.min,
        `${r2(ratio)}:1 < ${p.min}:1 — ${p.why}\n      ` +
        `${p.fg}=${THEMES[theme][p.fg]}  ${p.bg}=${THEMES[theme][p.bg]}`);
    });
  }

  for (const e of EXEMPT) {
    check(`${theme}: ${e.fg}/${e.bg} exempt, above ${e.floor}`, () => {
      const ratio = contrast(rgbOf(theme, e.fg), rgbOf(theme, e.bg));
      assert.ok(ratio >= e.floor,
        `${r2(ratio)}:1 < floor ${e.floor}:1 — the boundary has vanished entirely`);
    });
  }
}

/* ---------------- emission + drift guards ---------------- */

check("themeCss emits a block per theme plus the media query", () => {
  const css = themeCss();
  for (const t of Object.keys(THEMES)) {
    assert.ok(css.includes(`[data-theme="${t}"]`), `no override block for "${t}"`);
  }
  assert.ok(css.includes("@media (prefers-color-scheme:dark)"), "no prefers-color-scheme block");
  assert.ok(css.includes("color-scheme:light") && css.includes("color-scheme:dark"),
    "color-scheme must be pinned per block");
  assert.ok(!/color-scheme:\s*light dark/.test(css),
    "`color-scheme: light dark` lets the UA fight the manual override");
});

const read = p => readFileSync(new URL(p, import.meta.url), "utf8");

check("index.html carries both theme markers", () => {
  const html = read("../index.html");
  assert.ok(html.includes("<!--theme-css-->"), "missing <!--theme-css--> marker");
  assert.ok(html.includes("<!--theme-boot-->"), "missing <!--theme-boot--> marker");
  assert.ok(!/<body[^>]*style=/i.test(html),
    "inline style on <body> outranks every stylesheet and would pin one theme");
});

// The player bar and the pen palette are alternate contents of the same slot,
// so they must share one height and both be border-box — otherwise switching
// tools in landscape jogs the ice, and the reserved band (which is computed
// from --hd-barh) silently stops matching what actually renders. Reading these
// heights off the CSS by hand has been wrong twice, so pin the structure.
check("the two bottom panels share one border-box height", () => {
  const css = read("../src/styles.js");
  const rule = name => {
    const m = new RegExp(`\\.hd-${name} \\{[^}]*\\}`, "s").exec(css);
    assert.ok(m, `.hd-${name} rule not found`);
    return m[0];
  };
  for (const [name, prop] of [["scrub", "height"], ["pen", "min-height"]]) {
    const r = rule(name);
    assert.match(r, /box-sizing:\s*border-box/,
      `.hd-${name} must be border-box or its stated height isn't its rendered height`);
    assert.match(r, new RegExp(`${prop}:\\s*var\\(--hd-barh\\)`),
      `.hd-${name} must take its ${prop} from --hd-barh, not a literal`);
  }
  // and the reserved bands must be derived from the same variables
  assert.match(css, /\.hd-root\.scrub-on \{ --hd-scrub: calc\(4px \+ var\(--hd-barh\)/);
  assert.match(css, /\.hd-root\.pen-on \{ --hd-scrub: calc\(4px \+ var\(--hd-barh2\)/);
});

// A rule that FILLS with the accent must also set the on-accent text colour,
// or it inherits whatever the base rule had. That was invisible while the app
// was dark-only — the inherited grey happened to be light — and turned into
// dark-on-teal the moment a light theme existed. Pair contrast can't catch
// this: both tokens are individually fine, the rule just never opts in.
const ACCENT_FILL_NO_TEXT = new Set([
  ".hd-penswknob",   // the sliding knob; its label lives on .hd-penswopt
  ".hd-sw.on",       // switch track, no text at all
]);
check("every accent-filled rule sets the on-accent text colour", () => {
  const css = read("../src/styles.js");
  const offenders = [];
  for (const block of css.split("}")) {
    const i = block.indexOf("{");
    if (i < 0) continue;
    const sel = block.slice(0, i).replace(/\/\*[\s\S]*?\*\//g, "").trim().split("\n").pop().trim();
    const body = block.slice(i + 1);
    if (!/background:\s*var\(--db-accent\)/.test(body)) continue;
    if (/color:\s*var\(--db-text-on-accent\)/.test(body)) continue;
    if (ACCENT_FILL_NO_TEXT.has(sel)) continue;
    offenders.push(sel);
  }
  assert.deepEqual(offenders, [],
    `accent-filled but inheriting their text colour: ${offenders.join(", ")}`);
});

// drill-svg.js's var() fallbacks are what an <img>-loaded SVG actually renders
// (no host cascade), which is the PNG export and the print sheet. They must come
// off THEMES.light, not be retyped — a hardcoded fallback is a silent drift that
// only shows up as a slightly-wrong colour in an exported image.
check("drill-svg.js takes its var fallbacks from the token table", () => {
  const src = read("../src/drill-svg.js");
  const hard = [...src.matchAll(/V\(\s*"[^"]+"\s*,\s*("(#|rgb)[^"]*")\s*\)/g)].map(m => m[1]);
  assert.deepEqual(hard, [], `hardcoded var() fallbacks in drill-svg.js: ${hard.join(", ")}`);
  assert.ok(/const L = THEMES\.light/.test(src), "drill-svg.js should resolve fallbacks via THEMES.light");
});

// This is what actually enforces the 78-values -> one-token-set collapse. Without
// it the next feature quietly reintroduces a one-off grey.
check("styles.js has no raw colour literals", () => {
  const css = read("../src/styles.js")
    // the pen/eraser cursor art is a fixed data-URI: a cursor can't take var()
    .replace(/cursor:\s*url\("data:[^"]*"\)/g, "")
    .replace(/url\("data:image\/svg\+xml[^"]*"\)/g, "");
  const stray = [...new Set(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [])];
  assert.deepEqual(stray, [], `raw colours left in styles.js: ${stray.join(", ")}`);
});

console.log(`\n${passed} passed, ${failed} failed` + (known ? `, ${known} known-outstanding` : ""));
process.exit(failed ? 1 : 0);
