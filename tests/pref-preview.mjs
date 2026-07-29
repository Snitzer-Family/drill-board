// node tests/pref-preview.mjs — the settings sheet's preview tiles.
//
// The tiles are the one part of the settings sheet that can lie. A row names its
// scene with a string, so a renamed scene leaves an empty tile and a deleted row
// leaves a scene nobody draws — and both look completely fine in a build, in
// npm test, and in a screenshot of the rows that still work. Nothing here can be
// verified by eye either: an orphaned scene is invisible BECAUSE it renders
// nowhere. So this pins the two ends together.
//
// It also pins the two rows that enumerate a table (Theme, Typeface) to the
// table, because retyping six theme names into a settings sheet is exactly how a
// sixth theme ends up with no way to select it.
//
// Neither file can be imported: pref-preview.jsx is JSX and the animator is an
// 11k-line React module. Both are read as text, like tests/rink-views.mjs does
// for the VIEWS literals.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = read("src/hockey-drill-animator.jsx");
const pv = read("src/pref-preview.jsx");
const rink = read("src/rink.jsx");
const styles = read("src/styles.js");

const { THEME_ORDER } = await import("../src/theme.js");
const { TYPEFACES } = await import("../src/constants.js");

// The keys of the SCENES object literal: the top-level `name: {` lines inside
// it. Scene bodies are nested objects, so this counts indentation rather than
// trying to brace-match — every scene is declared at exactly one level in.
function sceneKeys() {
  const start = pv.indexOf("export const SCENES = {");
  assert.ok(start >= 0, "no `export const SCENES = {` in pref-preview.jsx");
  const body = pv.slice(start);
  const end = body.indexOf("\n};");
  assert.ok(end > 0, "SCENES literal is not closed by a line starting `};`");
  return [...body.slice(0, end).matchAll(/^ {2}(\w+): \{$/gm)].map(m => m[1]);
}

// Every scene= a settings row asks for.
const usedScenes = [...app.matchAll(/scene="(\w+)"/g)].map(m => m[1]);

check("SCENES declares at least one scene", () => {
  assert.ok(sceneKeys().length >= 10, `only ${sceneKeys().length} scenes found — the regex probably stopped matching`);
});

check("every scene a settings row names exists", () => {
  const have = new Set(sceneKeys());
  assert.ok(usedScenes.length >= 10, `only ${usedScenes.length} scene= uses found in the animator`);
  for (const k of usedScenes) {
    assert.ok(have.has(k), `a settings row asks for scene "${k}", which SCENES does not define — that row renders an empty tile`);
  }
});

check("every scene is used by a settings row", () => {
  const used = new Set(usedScenes);
  for (const k of sceneKeys()) {
    assert.ok(used.has(k), `SCENES defines "${k}" but no row draws it — either wire it up or delete it`);
  }
});

check("the Theme row offers every theme, from THEME_ORDER", () => {
  assert.match(app, /scene="theme"[\s\S]{0,400}?THEME_ORDER\.map/,
    "the Theme row must enumerate THEME_ORDER, not a retyped list — a new theme would otherwise be unselectable");
  assert.ok(THEME_ORDER.length >= 2 && THEME_ORDER.includes("auto"),
    "THEME_ORDER must still start from the auto/pinned split the tile resolves");
});

check("the Theme tile resolves auto the way the app does", () => {
  assert.match(pv, /function themeOf\(v, c\) \{[\s\S]*?resolveTheme\("auto", c\.prefersDark\)/,
    "the auto tile must call resolveTheme with the live prefersDark, or it shows the wrong palette after sunset");
  assert.match(app, /pvCtx = useMemo\(\(\) => \(\{[^}]*prefersDark/,
    "pvCtx must carry prefersDark for that to be possible");
});

check("the Typeface row sets each pill in the face it offers", () => {
  const m = app.match(/TYPEFACES\.map\(\(\[v, lab, stack\]\)[\s\S]{0,400}?\)\)/);
  assert.ok(m, "the Typeface row must map TYPEFACES and destructure its stack");
  assert.match(m[0], /fontFamily: stack/,
    "each pill must be set in its own stack — that IS the preview for this row");
  for (const t of TYPEFACES) {
    assert.equal(t.length, 3, `TYPEFACES entry ${t[0]} must stay [id, label, stack]`);
  }
});

check("RinkMarkings takes a clipId, and the tiles pass one", () => {
  assert.match(rink, /clipId = "boards"/,
    "RinkMarkings must default clipId to boards so the app's own call is unchanged");
  assert.match(rink, /clipPath=\{`url\(#\$\{clipId\}\)`\}/,
    "the clip must go through the prop, or a tile silently inherits the app's stretched clip");
  assert.match(pv, /<RinkMarkings clipId=\{id\} \/>/,
    "the theme tile must pass its own id");
  assert.match(pv, /<clipPath id=\{id\}>/, "and define it");
});

check("a tile that fills with the accent still sets its text colour", () => {
  // the same rule tests/theme-contrast.mjs enforces across styles.js; pinned
  // here too because .hd-pvtile.on is the only accent fill added for this UI
  const m = styles.match(/\.hd-pvtile\.on \{[^}]*\}/);
  assert.ok(m, "no .hd-pvtile.on rule in styles.js");
  assert.match(m[0], /background:var\(--db-accent\)/);
  assert.match(m[0], /color:var\(--db-text-on-accent\)/);
});

check("the stored number prefs are validated against the range their control offers", () => {
  // One declaration, read by both the clamp and the control. Two copies and
  // raising a stepper's max leaves the new top of the range stored fine but
  // silently reset to the default on the next launch — which presents as the
  // setting "not sticking", and only at one end of its travel.
  assert.match(app, /const LINE_RANGE = \[[\d.]+, [\d.]+\], MARK_RANGE = \[[\d.]+, [\d.]+\];/,
    "LINE_RANGE / MARK_RANGE must stay one declaration");
  assert.match(app, /numPref\(LINE_KEY, 1, LINE_RANGE\)/);
  assert.match(app, /numPref\(MARK_KEY, 1, MARK_RANGE\)/);
  assert.match(app, /min=\{LINE_RANGE\[0\]\} max=\{LINE_RANGE\[1\]\}/,
    "the thickness stepper must take its bounds from LINE_RANGE, not literals");
  assert.match(app, /min=\{MARK_RANGE\[0\]\} max=\{MARK_RANGE\[1\]\}/,
    "the opacity slider must take its bounds from MARK_RANGE, not literals");
  // ...and both must actually be written back, or they are session-only again
  for (const k of ["LINE_KEY", "MARK_KEY"]) {
    assert.ok(app.includes(`localStorage.setItem(${k},`), `${k} is read but never written`);
  }
});

check("the tile label survives — a row is never picture-only", () => {
  assert.match(pv, /className="hd-pvlbl"/, "PrefPick must still render a text label under each tile");
  assert.match(styles, /\.hd-pvlbl \{/, "and styles.js must still style it");
  assert.match(pv, /role="radio" aria-checked=\{value === v\}/,
    "the tiles are a radio group, not decoration");
});

console.log(`\n${passed} passed, 0 failed`);
