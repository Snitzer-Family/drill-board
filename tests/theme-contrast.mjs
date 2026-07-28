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
import { THEMES, PAIRS, EXEMPT, NON_COLOR_TOKENS, AUTO_MAP, themeCss, teamInk } from "../src/theme.js";

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
      if (NON_COLOR_TOKENS.includes(k)) {
        assert.match(v, /\d|\)/, `${k} should be a shadow or filter value, got "${v}"`);
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

// The corner menus are SIZED by CSS and CENTRED by JS, so the two width figures
// must agree — a mismatch offsets every menu by half the difference, which looks
// like a vague alignment bug rather than a number being wrong in one place.
check("menu width agrees between styles.js and the anchoring JS", () => {
  const css = read("../src/styles.js");
  const js = read("../src/hockey-drill-animator.jsx");
  const cssW = /--hd-menu-w:\s*(\d+)px/.exec(css);
  const jsW = /const MENU_W = (\d+)/.exec(js);
  assert.ok(cssW, "--hd-menu-w not found in styles.js");
  assert.ok(jsW, "MENU_W not found in hockey-drill-animator.jsx");
  assert.equal(jsW[1], cssW[1], `MENU_W=${jsW[1]} but --hd-menu-w=${cssW[1]}px`);
  // and the stretch breakpoint must match the one the media query uses.
  // MENU_ANCHOR_MIN is DENSE_MIN, so resolve through it.
  const cssBp = /@media \(max-width: (\d+)px\) \{\s*\.hd-menu/.exec(css);
  const jsBp = /const DENSE_MIN = (\d+)/.exec(js);
  assert.ok(cssBp && jsBp, "menu breakpoint not found on both sides");
  assert.equal(+jsBp[1], +cssBp[1] + 1,
    `JS anchors at >=${jsBp[1]}px but CSS stretches up to ${cssBp[1]}px — ` +
    `there is a gap or overlap where both or neither apply`);
});

// The pen palette and the player bar are alternate CONTENTS of one element now,
// so there is one height and one reserved band. Both must derive from --hd-barh:
// if the bar's rendered height and the strip of ice reserved for it ever stop
// agreeing, the bar overlaps the ice (band too short) or the ice floats above a
// gap (too tall). Reading these heights off the CSS by hand has been wrong
// twice, so pin the structure instead.
check("the action bar is one border-box height, one reserved band", () => {
  const css = read("../src/styles.js");
  const m = /^\s*\.hd-act \{[^}]*\}/ms.exec(css);
  assert.ok(m, ".hd-act base rule not found");
  assert.match(m[0], /box-sizing:\s*border-box/,
    ".hd-act must be border-box or its stated height isn't its rendered height");
  assert.match(m[0], /height:\s*var\(--hd-barh\)/,
    ".hd-act must take its height from --hd-barh, not a literal");
  assert.doesNotMatch(m[0], /min-height/,
    ".hd-act must be a fixed height — min-height lets it grow past its reserved band");
  // the band is unconditional and computed from the SAME variable
  assert.match(css, /--hd-act: calc\(4px \+ var\(--hd-barh\) \+ var\(--hd-icegap\)\);/);
  assert.match(css, /\.hd-root\.act-off \{ --hd-act: 0px; \}/);
  // The two-row palette and its second height variable are gone for good.
  // Match declarations and var() uses, not bare names — the comments above
  // --hd-act deliberately explain what --hd-barh2 was and why it died.
  for (const dead of ["--hd-barh2", "--hd-scrub"]) {
    assert.doesNotMatch(css, new RegExp(`${dead}\\s*:`), `${dead} is still declared — one bar, one height`);
    assert.ok(!css.includes(`var(${dead})`), `${dead} is still used — one bar, one height`);
  }
  for (const dead of [".hd-root.pen-on {", ".hd-root.scrub-on {"])
    assert.ok(!css.includes(dead), `${dead}…} should no longer exist — the band is unconditional`);
});

// A piece's default colour is written out TWICE — once in the board editor's
// defaultColor(), once in the DSL parser — so a kind can end up one colour when
// you place it and another when you load the same board from text. That is
// exactly what happened to the stick (#14171a placed, #20242a parsed), and it
// stayed invisible because both are near-black. Pin the two tables together.
check("the two default-colour tables agree on every kind", () => {
  const js = read("../src/hockey-drill-animator.jsx");
  const fmt = read("../src/drill-format.js");
  const grab = (src, after) => {
    const i = src.indexOf(after);
    assert.ok(i >= 0, `couldn't find "${after}"`);
    const body = src.slice(i, i + 700);
    const out = {};
    for (const m of body.matchAll(/kind === "(\w+)" \? "(#[0-9a-fA-F]{6})"/g)) out[m[1]] = m[2].toLowerCase();
    return out;
  };
  const editor = grab(js, "const defaultColor =");
  const parser = grab(fmt, "let color = kind ===");
  const kinds = [...new Set([...Object.keys(editor), ...Object.keys(parser)])]
    .filter(k => k in editor && k in parser);
  assert.ok(kinds.length >= 7, `only matched ${kinds.length} kinds — did a table's shape change?`);
  for (const k of kinds)
    assert.equal(editor[k], parser[k],
      `${k}: the editor places it ${editor[k]} but the parser loads it ${parser[k]}`);
});

// Pen ink has to be visible on the sheet it lands on. Black ink was 1.01:1 on
// the dark rink — literally the same colour as the ice — and yellow was 1.35:1
// on the light one. TEAM_LIFT flips those (and a couple of others measurement
// turned up) at PAINT time only; the stored colour never changes, so a drill
// saved with black ink is still black ink and the DSL round-trip is untouched.
check("every pen ink is visible on every sheet", () => {
  const INKS = ["#ffd447", "#d7263d", "#1f4fa3", "#1f8a4c", "#e0731d", "#7a3fa8", "#111318"];
  for (const theme of Object.keys(THEMES)) {
    const ice = THEMES[theme].ice;
    for (const stored of INKS) {
      const painted = teamInk(theme, stored);
      const r = contrast(parseHex(painted), parseHex(ice));
      assert.ok(r >= 3, `${theme}: ink ${stored}` +
        (painted === stored ? "" : ` (painted ${painted})`) +
        ` is ${r.toFixed(2)}:1 on the ice — a stroke you can't see`);
    }
  }
});

// Same problem, different piece: props moulded in black rubber were ~1.1:1 on
// the dark rink — the ice with a faint outline round it. These are the DEFAULT
// body colours, the ones a piece gets when nobody has chosen one, so they have
// to be visible on whatever sheet they land on.
check("default prop bodies are visible on every sheet", () => {
  const BODIES = {
    tire: "#1c1c1e", bumper: "#1b1e22", cone: "#e0731d", deker: "#c79a4e",
    passer: "#57636f", light: "#2ea043", net: "#c81e33", stick: "#20242a",
  };
  for (const theme of Object.keys(THEMES)) {
    const ice = THEMES[theme].ice;
    for (const [kind, stored] of Object.entries(BODIES)) {
      // the stick reads its body from a token rather than a stored colour
      const painted = kind === "stick" ? THEMES[theme]["ice-stick"] : teamInk(theme, stored);
      const r = contrast(parseHex(painted), parseHex(ice));
      assert.ok(r >= 3, `${theme}: ${kind} body ${stored}` +
        (painted === stored ? "" : ` (painted ${painted})`) +
        ` is ${r.toFixed(2)}:1 on the ice — it disappears into the rink`);
    }
  }
});

// STYLES is one big template literal, so a stray backtick — even inside a CSS
// comment, quoting a property name — closes the string and the whole file stops
// parsing. Worse, the build error points at the next odd character rather than
// the backtick, and on a clean tree the copy-preview plugin's ENOENT (dist/ was
// never written) masks it completely. Cost twenty minutes twice; catch it in a
// one-second node test instead.
check("styles.js has no stray backticks inside the STYLES literal", () => {
  const css = read("../src/styles.js");
  const body = css.slice(css.indexOf("export const STYLES = `") + 23);
  const end = body.indexOf("`");
  assert.ok(end >= 0, "STYLES literal is never closed");
  assert.equal(body.slice(0, end).includes("`"), false);
  // the only backtick after the opener must be the one that closes it
  assert.equal((body.match(/`/g) || []).length, 1,
    "a backtick inside STYLES ends the template literal early — use plain prose");
});

// The single-line guarantee. The palette used to wrap to a second row on a
// narrow phone, which is the only reason a second height variable ever existed.
// nowrap on both bars is what makes one height true at every width; without it
// the reserved band silently goes short and the bar sits on the ice.
check("neither bottom bar can wrap to a second row", () => {
  const css = read("../src/styles.js");
  for (const name of ["act", "bar"]) {
    // anchored to the start of a line so this finds the BASE rule, not one of
    // the `.hd-root:not(.dense) .hd-act {…}` overrides that precede it
    const m = new RegExp(`^\\s*\\.hd-${name} \\{[^}]*\\}`, "ms").exec(css);
    assert.ok(m, `.hd-${name} base rule not found`);
    assert.match(m[0], /flex-wrap:\s*nowrap/,
      `.hd-${name} must be flex-wrap:nowrap — a second row breaks the reserved band`);
  }
});

// The bar's layout tier and the corner menus' stretch breakpoint are the same
// number, so a device changes personality exactly once as it rotates. DENSE_MIN
// is the JS source of truth; the stylesheet keys off the .dense class it writes,
// which is why there is no bar media query to drift against.
check("DENSE_MIN drives both the bar tier and the menu anchoring", () => {
  const js = read("../src/hockey-drill-animator.jsx");
  const d = /const DENSE_MIN = (\d+)/.exec(js);
  assert.ok(d, "DENSE_MIN not found in hockey-drill-animator.jsx");
  assert.match(js, /MENU_ANCHOR_MIN = DENSE_MIN/,
    "MENU_ANCHOR_MIN must be derived from DENSE_MIN, not a second copy of the number");
  assert.match(js, new RegExp(`min-width: \\$\\{DENSE_MIN\\}px`),
    "the dense matchMedia query must interpolate DENSE_MIN rather than repeat it");
});

// A rule that FILLS with the accent must also set the on-accent text colour,
// or it inherits whatever the base rule had. That was invisible while the app
// was dark-only — the inherited grey happened to be light — and turned into
// dark-on-teal the moment a light theme existed. Pair contrast can't catch
// this: both tokens are individually fine, the rule just never opts in.
const ACCENT_FILL_NO_TEXT = new Set([
  // the sliding knob shared by the mode switch and the pen segment; the labels
  // it slides under live on .hd-modeopt / .hd-segopt, which do set on-accent
  ".hd-modeknob, .hd-segknob",
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
