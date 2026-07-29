// How high the keeper plays, and where a shot dies on them.
//
// Two files have to agree on one answer: the animator draws the sprite at
// goalieDepth() up the crease, and timing.js stops a saved puck at that same
// depth plus the pad face. They used to be hand-matched literals (2.5 in each),
// which is exactly the kind of pairing that drifts silently — the puck parks in
// open ice next to a goalie who is standing somewhere else, and nothing fails.
// So: the ramp is tested for shape here, and the two call sites are pinned by
// source grep so neither can quietly go back to a number.
//
// Same story for the drawn crease arc: three renderers gate it, and a net
// standing in the rink's painted crease must not have any of them draw a second
// arc on top of the paint. Run: node tests/goalie-crease.mjs
import { readFileSync } from 'node:fs';
import { goalieDepth, goalieAngle, GOALIE_NEAR, GOALIE_FAR, GOALIE_DEEP, GOALIE_HIGH, GOALIE_MAXREL, GOALIE_FACE } from '../src/timing.js';
import { atGoalSpot, GOAL_SPOTS } from '../src/constants.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const src = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

/* ---- the depth ramp ---- */
T('hugs the line when the puck is on top of them', goalieDepth(0), GOALIE_DEEP);
T('…and anywhere inside GOALIE_NEAR', goalieDepth(GOALIE_NEAR), GOALIE_DEEP);
T('fully out at GOALIE_FAR', goalieDepth(GOALIE_FAR), GOALIE_HIGH);
T('…and stays there beyond it', goalieDepth(200), GOALIE_HIGH);
{
  let mono = true, inRange = true;
  for (let d = 0; d <= 120; d += 0.5) {
    if (goalieDepth(d) < goalieDepth(d - 0.5) - 1e-9) mono = false;
    if (goalieDepth(d) < GOALIE_DEEP - 1e-9 || goalieDepth(d) > GOALIE_HIGH + 1e-9) inRange = false;
  }
  T('never backs up as the shooter gets further out', mono, true);
  T('never leaves [DEEP, HIGH]', inRange, true);
}
// The point of the change: a shot from the top of the circle is met well up the
// crease, not from the goal line. If this drops back under 4 ft, the keeper has
// gone back to sitting in the net for a 25 ft shot.
T('top of the circle (~25 ft) is met above 4 ft out', goalieDepth(25) > 4, true);
T('a walkout (~12 ft) is still played deep', goalieDepth(12) < 2.5, true);
T('the pad face pushes the puck further back still', GOALIE_FACE > 0, true);

/* ---- the post-to-post clamp ---- */
const deg = r => Math.round((r * 180) / Math.PI);
T('square shot is not turned', deg(goalieAngle(0, 0)), 0);
T('a shot from the side is clamped to the post', deg(goalieAngle(0, Math.PI / 2)), deg(GOALIE_MAXREL));
T('…and from behind, to the same post', deg(goalieAngle(0, Math.PI * 0.9)), deg(GOALIE_MAXREL));
T('…the other way too', deg(goalieAngle(0, -Math.PI * 0.9)), -deg(GOALIE_MAXREL));
T('clamp follows the net facing', deg(goalieAngle(180, Math.PI)), 180);

/* ---- neither call site may go back to a literal ---- */
{
  const anim = src('hockey-drill-animator.jsx');
  const goaliePos = anim.slice(anim.indexOf('function goaliePos'), anim.indexOf('function goaliePos') + 2600);
  T('goaliePos exists to slice', goaliePos.startsWith('function goaliePos'), true);
  T('the sprite reads the shared ramp', /goalieDepth\(/.test(goaliePos), true);
  T('…for the tracking case AND the frozen shot', (goaliePos.match(/goalieDepth\(/g) || []).length >= 2, true);
  T('no hand-rolled smoothstep left behind', /R_MIN|R_MAX|D_NEAR|D_FAR/.test(goaliePos), false);

  const tim = src('timing.js');
  const save = tim.slice(tim.indexOf('} else if (goalie) {'), tim.indexOf('} else if (goalie) {') + 420);
  T('the save point reads the same ramp', /goalieDepth\(/.test(save), true);
  T('…offset to the pad face', /GOALIE_FACE/.test(save), true);
  T('…and takes the same post-to-post clamp', /goalieAngle\(/.test(save), true);
}

/* ---- a net in the painted crease ---- */
for (const s of GOAL_SPOTS) {
  T(`net at (${s.x}, ${s.y}) is in the painted crease`, atGoalSpot({ kind: 'net', ...s }), true);
  T(`…still true turned around`, atGoalSpot({ kind: 'net', x: s.x, y: s.y, facing: 90 }), true);
}
T('a net out in the slot is not', atGoalSpot({ kind: 'net', x: 40, y: 42.5 }), false);
T('nor one a few feet off the spot', atGoalSpot({ kind: 'net', x: 15, y: 42.5 }), false);
T('a tire is never a net in a crease', atGoalSpot({ kind: 'tire', x: 11, y: 42.5 }), false);
T('and nothing at all is safe', atGoalSpot(null), false);

// All three renderers gate the drawn arc. Miss one and that surface paints a
// second crease on top of the rink's own.
T('the board gates the crease arc', /p\.crease && !atGoalSpot\(p\)/.test(src('icons.jsx')), true);
T('the export gates it too', /p\.crease && !inPaintedCrease\(p\)/.test(src('drill-svg.js')), true);
T('the editor greys the toggle out', /disabled=\{atGoalSpot\(p\)\}/.test(src('hockey-drill-animator.jsx')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
