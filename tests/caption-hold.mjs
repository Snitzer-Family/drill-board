// node tests/caption-hold.mjs — how long a presentation caption stays on screen.
//
// The hold lives inside the RAF loop, which no suite can reach, so the arithmetic
// it depends on is pinned here instead. What matters to a presenter: the pause
// they set is a FLOOR (never undercut, whatever the text), a caption too long to
// read in that floor stretches, one long note can't stall the play forever, and
// markdown they typed for emphasis doesn't silently buy extra seconds.

import assert from "node:assert/strict";
import { captionHold, READ_PACES, READ_PACE_DEFAULT, CAPTION_MAX_EXTRA } from "../src/constants.js";

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`ok  ${name}`); };

const BALANCED = READ_PACES[READ_PACE_DEFAULT].cps;
const MIN = 2.5;                                    // the app's default pause
const rpt = (s, n) => s.repeat(n).slice(0, n);

check("the pause is a floor — a short caption holds exactly it", () => {
  assert.equal(captionHold("The play begins", MIN, BALANCED), MIN);
  assert.equal(captionHold("", MIN, BALANCED), MIN);
  assert.equal(captionHold(null, MIN, BALANCED), MIN);
  assert.equal(captionHold(undefined, MIN, BALANCED), MIN);
});

check("a caption the floor already covers is not extended", () => {
  // at 13 c/s a 2.5s floor reads ~32 chars; right at the boundary, still the floor
  assert.equal(captionHold(rpt("a", 32), MIN, BALANCED), MIN);
  assert.ok(captionHold(rpt("a", 40), MIN, BALANCED) > MIN);
});

check("a longer caption stretches by its reading time", () => {
  const text = "Drive the net hard, stick on the ice, look for the rebound";
  assert.equal(text.length, 58);
  const held = captionHold(text, MIN, BALANCED);
  assert.ok(Math.abs(held - 58 / BALANCED) < 1e-9, `expected ~${58 / BALANCED}s, got ${held}`);
  assert.ok(held > MIN);
});

check("the added reading time is capped so one note can't stall the play", () => {
  assert.equal(captionHold(rpt("a", 5000), MIN, BALANCED), MIN + CAPTION_MAX_EXTRA);
  // and the cap rides ON TOP of the floor, so raising the pause still raises the max
  assert.equal(captionHold(rpt("a", 5000), 6, BALANCED), 6 + CAPTION_MAX_EXTRA);
});

check("hold never decreases as the caption grows", () => {
  let prev = 0;
  for (let n = 0; n <= 200; n += 7) {
    const held = captionHold(rpt("a", n), MIN, BALANCED);
    assert.ok(held >= prev, `hold dropped at ${n} chars: ${held} < ${prev}`);
    assert.ok(held >= MIN);
    prev = held;
  }
});

check("a slower pace holds a given caption longer", () => {
  const text = rpt("a", 90);
  const by = label => captionHold(text, MIN, READ_PACES.find(p => p.label === label).cps);
  assert.ok(by("Relaxed") > by("Balanced"), "Relaxed should outlast Balanced");
  assert.ok(by("Balanced") > by("Brisk"), "Balanced should outlast Brisk");
});

check('"Fixed" opts out — every caption holds exactly the pause', () => {
  const fixed = READ_PACES[0];
  assert.equal(fixed.label, "Fixed");
  assert.equal(fixed.cps, 0);
  assert.equal(captionHold(rpt("a", 500), MIN, fixed.cps), MIN);
  assert.equal(captionHold("short", MIN, fixed.cps), MIN);
  // a nonsense pace degrades to the same "no scaling" behaviour rather than NaN
  assert.equal(captionHold(rpt("a", 500), MIN, -3), MIN);
});

check("markdown the viewer never sees doesn't buy extra seconds", () => {
  const plain = rpt("a", 60);
  const cps = BALANCED;
  assert.equal(captionHold(`**${plain}**`, MIN, cps), captionHold(plain, MIN, cps));
  assert.equal(captionHold(`_${plain}_`, MIN, cps), captionHold(plain, MIN, cps));
  assert.equal(captionHold("`" + plain + "`", MIN, cps), captionHold(plain, MIN, cps));
  // a link is billed for its label, not its href
  assert.equal(captionHold(`[${plain}](https://example.com/a/very/long/url)`, MIN, cps),
    captionHold(plain, MIN, cps));
});

check("the pace table is well formed", () => {
  assert.ok(READ_PACES.length >= 2);
  assert.ok(READ_PACE_DEFAULT >= 0 && READ_PACE_DEFAULT < READ_PACES.length,
    "default index must be inside the table");
  READ_PACES.forEach(p => {
    assert.equal(typeof p.label, "string");
    assert.ok(p.label.length > 0 && p.label.length <= 9, `"${p.label}" must fit the stepper`);
    assert.equal(typeof p.cps, "number");
    assert.ok(p.cps >= 0);
  });
  // the stepper walks the table in order, so the paces must read monotonically
  const scaling = READ_PACES.filter(p => p.cps > 0).map(p => p.cps);
  assert.deepEqual(scaling, scaling.slice().sort((a, b) => b - a),
    "scaling paces must run fastest → slowest");
});

console.log(`\n${passed} passed, 0 failed`);
