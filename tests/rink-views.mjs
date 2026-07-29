// node tests/rink-views.mjs — the rink view boxes and the RINK token.
//
// VIEWS is written out in THREE places: constants.js (the app), drill-svg.js
// (self-declared so the export/print renderer works standalone) and
// build-drill-preview.mjs (inlined into the standalone HTML bundle). Nothing
// forced them to agree, so a view added in one place would render as `full` in
// an exported PNG and nobody would notice until a coach printed a drill. This
// pins them together, pins the rects to the sheet, and pins the legacy
// `RINK quarter` spelling that older saved boards and shared links still carry.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const { VIEWS, RINK_ALIAS, isQuarter, RINK } = await import("../src/constants.js");
const { parseDrill, serializeDrill } = await import("../src/drill-format.js");

// Pull a `const VIEWS = {...}` / `"...VIEWS = {...}"` literal out of a source
// file and evaluate just that object — the files around it can't be imported
// (drill-svg keeps VIEWS module-local; the script is a build tool).
function viewsIn(path) {
  const src = read(path);
  const m = src.match(/VIEWS\s*=\s*(\{[^}]*\})/);
  assert.ok(m, `no VIEWS literal found in ${path}`);
  return new Function(`return ${m[1]};`)();
}

const QUARTERS = ["quarter-tl", "quarter-tr", "quarter-bl", "quarter-br"];

check("every view rect lies on the sheet", () => {
  for (const [name, r] of Object.entries(VIEWS)) {
    assert.equal(r.length, 4, `${name} must be [x, y, w, h]`);
    const [x, y, w, h] = r;
    assert.ok(w > 0 && h > 0, `${name} has a zero/negative extent`);
    assert.ok(x >= 0 && y >= 0 && x + w <= RINK.W && y + h <= RINK.H,
      `${name} = ${r.join(",")} runs off the 200x85 sheet`);
  }
});

check("the four quarters tile the sheet without overlapping", () => {
  for (const q of QUARTERS) assert.ok(VIEWS[q], `missing view ${q}`);
  const area = QUARTERS.reduce((a, q) => a + VIEWS[q][2] * VIEWS[q][3], 0);
  assert.equal(area, RINK.W * RINK.H, "the four quarters must cover the whole sheet");
  // pairwise: any two quarters must be disjoint (strict, not just non-equal)
  for (let i = 0; i < QUARTERS.length; i++) {
    for (let j = i + 1; j < QUARTERS.length; j++) {
      const [ax, ay, aw, ah] = VIEWS[QUARTERS[i]], [bx, by, bw, bh] = VIEWS[QUARTERS[j]];
      const overlap = ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
      assert.equal(overlap, false, `${QUARTERS[i]} overlaps ${QUARTERS[j]}`);
    }
  }
});

check("quarter names match where they sit on the ice", () => {
  const mid = { x: RINK.W / 2, y: RINK.H / 2 };
  for (const q of QUARTERS) {
    const [x, y, w, h] = VIEWS[q];
    const corner = q.slice(-2);                 // "quarter" also contains a "t"
    const top = corner[0] === "t", left = corner[1] === "l";
    assert.equal(x + w <= mid.x, left, `${q}: left/right half is wrong`);
    assert.equal(y + h <= mid.y, top, `${q}: top/bottom half is wrong`);
  }
});

check("isQuarter recognises the quarters and nothing else", () => {
  for (const q of QUARTERS) assert.equal(isQuarter(q), true, q);
  assert.equal(isQuarter("full"), false);
  assert.equal(isQuarter("half"), false);
  // the legacy spelling still has to take the quarter code path
  assert.equal(isQuarter("quarter"), true);
});

check("the three copies of VIEWS agree", () => {
  const copies = {
    "src/drill-svg.js": viewsIn("src/drill-svg.js"),
    "scripts/build-drill-preview.mjs": viewsIn("scripts/build-drill-preview.mjs"),
  };
  for (const [path, table] of Object.entries(copies)) {
    for (const [name, rect] of Object.entries(VIEWS))
      assert.deepEqual(table[name], rect,
        `${path} is missing or disagrees on view "${name}"`);
    // extra keys are allowed ONLY if they are known aliases pointing at the
    // right rect — drill-svg keeps `quarter` for callers that skip parseDrill
    for (const [name, rect] of Object.entries(table)) {
      if (VIEWS[name]) continue;
      const target = RINK_ALIAS[name];
      assert.ok(target, `${path} has an unknown extra view "${name}"`);
      assert.deepEqual(rect, VIEWS[target], `${path}: alias "${name}" points at the wrong rect`);
    }
  }
});

check("build-drill-preview inlines the alias table too", () => {
  // the bundle strips drill-format's import, so RINK_ALIAS has to be declared
  // in the inlined preamble or the parser throws on `RINK quarter`
  const src = read("scripts/build-drill-preview.mjs");
  const m = src.match(/RINK_ALIAS\s*=\s*(\{[^}]*\})/);
  assert.ok(m, "no RINK_ALIAS literal in the preview bundle preamble");
  assert.deepEqual(new Function(`return ${m[1]};`)(), RINK_ALIAS);
});

check("build-drill-preview can still strip drill-svg's own VIEWS", () => {
  // the strip regex is a LINE match with no `}` allowed inside; reformatting
  // drill-svg's declaration would silently leave two colliding consts
  const stripped = read("src/drill-svg.js").replace(/^const VIEWS = \{[^}]*\};.*$/m, "");
  assert.equal(/^const VIEWS = /m.test(stripped), false,
    "drill-svg.js's VIEWS declaration no longer matches the strip regex in build-drill-preview.mjs");
});

check("every canonical RINK token round-trips", () => {
  for (const name of Object.keys(VIEWS)) {
    const d = parseDrill(`RINK ${name}\nPIECE P1 player 40 40\n`);
    assert.deepEqual(d.errors, [], `parse errors for RINK ${name}`);
    assert.equal(d.rink, name);
    assert.match(serializeDrill(d.rink, d.pieces), new RegExp(`^RINK ${name}$`, "m"));
  }
});

check("legacy `RINK quarter` reads as the top-right and is rewritten on save", () => {
  const d = parseDrill("RINK quarter\nPIECE P1 player 40 40\n");
  assert.deepEqual(d.errors, [], "the old spelling must still parse cleanly");
  assert.equal(d.rink, "quarter-tr", "must normalize at parse, so nothing downstream sees it");
  assert.deepEqual(VIEWS["quarter-tr"], [100, 0, 100, 42.5],
    "quarter-tr must be the exact rect the old `quarter` was, or saved drills shift");
  assert.match(serializeDrill(d.rink, d.pieces), /^RINK quarter-tr$/m);
});

check("an unknown rink is still an error", () => {
  const d = parseDrill("RINK sideways\nPIECE P1 player 40 40\n");
  assert.equal(d.rink, "full", "falls back to the default");
  assert.match(d.errors.join(" "), /unknown rink/);
});

console.log(`\n${passed} passed, 0 failed`);
