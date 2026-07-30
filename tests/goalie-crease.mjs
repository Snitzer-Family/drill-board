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
import { goalieDepth, goalieSpot, GOALIE_NEAR, GOALIE_FAR, GOALIE_DEEP, GOALIE_HIGH, GOALIE_FACE,
  GOALIE_ARC_MAX, GOALIE_RVH, GOALIE_SLIDE, GOALIE_FACE_MAX } from '../src/timing.js';
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

/* ---- arc, then RVH on the post, then the push across ---- */
const rad = d => (d * Math.PI) / 180;
const at = (d, dist = 40, facing = 0) => goalieSpot(facing, rad(d), dist);
const r2 = n => Math.round(n * 100) / 100;
const same = (a, b, tol = 0.01) => Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;

T('square: straight out at the depth the ramp gives', [r2(at(0).x), r2(at(0).y)], [r2(goalieDepth(40)), 0]);
T('…and square means square', at(0).a, 0);
T('mid angle plays the arc, still well off the line', at(35).x > 4 && Math.abs(at(35).y) > 2, true);
// The whole point: past the arc they stop tracking and sit on the post. A
// keeper who kept sliding round to 140° would be behind their own goal line.
T('sealed to the post by RVH', same(at(96), at(140)), true);
T('…and holds it right across the band', same(at(100), at(148)), true);
// The seal is set by the SPRITE, not by the centre: the keeper is ~6.8 ft across
// against a 6 ft mouth, so a centre parked near the 3 ft pipe puts the mask, an
// arm, a pad and the blocker inside the post itself. Measured on the board, 1.15
// keeps every body part off the pipe. Anything above ~1.6 puts limbs back in it.
T('the RVH centre stays well inside the pipe', Math.abs(at(120).y) < 1.6, true);
T('…but far enough off centre for the two sides to read apart',
  Math.abs(at(120).y - at(-120).y) > 1.8, true);
T('…and out in front of the goal line, not buried in the cage', at(120).x > 2, true);
T('the far side mirrors', [r2(at(-120).x), r2(at(-120).y)], [r2(at(120).x), r2(-at(120).y)]);
// Continuity at 180 is what stops a 6 ft teleport when the puck crosses behind.
T('both sides meet in the middle at 180', same(at(179.9), at(-179.9), 0.05), true);
T('…on the goal line, centred', Math.abs(at(180).y) < 0.01, true);
T('a puck straight behind is not tracked round the cage', Math.abs(at(180).x) < 2, true);
{
  let jump = 0, prev = at(-180);
  for (let d = -180; d <= 180; d += 0.5) { const c = at(d); jump = Math.max(jump, Math.hypot(c.x - prev.x, c.y - prev.y)); prev = c; }
  T('no teleport anywhere round the sweep', jump < 0.5, true);
}
T('never faces back through its own cage', Math.abs(at(180).a) <= (GOALIE_FACE_MAX * 180) / Math.PI + 0.01, true);
T('facing tracks the puck inside the arc', at(40).a, 40);
// the whole solve is net-relative, so it has to survive a net turned around
{
  const s = goalieSpot(180, rad(180), 40);   // puck straight out in front of a flipped net
  T('a flipped net solves in its own frame', [r2(s.x), r2(s.y)], [r2(-goalieDepth(40)), 0]);
}
T('the bands are ordered', GOALIE_ARC_MAX < GOALIE_RVH && GOALIE_RVH < GOALIE_SLIDE && GOALIE_SLIDE < Math.PI, true);

/* ---- neither call site may go back to a literal ---- */
{
  const anim = src('hockey-drill-animator.jsx');
  const goaliePos = anim.slice(anim.indexOf('function goaliePos'), anim.indexOf('function goaliePos') + 2600);
  T('goaliePos exists to slice', goaliePos.startsWith('function goaliePos'), true);
  T('the sprite reads the shared solve', /goalieSpot\(/.test(goaliePos), true);
  T('no hand-rolled smoothstep left behind', /R_MIN|R_MAX|D_NEAR|D_FAR/.test(goaliePos), false);
  T('…and no hand-rolled angle clamp either', /MAXREL/.test(goaliePos), false);

  // …and the drawn shot caret has to back off the KEEPER, not the cage. A flat
  // SHOT_TIP_GAP puts it exactly where a keeper meeting a long shot stands.
  T('the caret standoff reads the keeper solve', /const goalieCaretGap = [\s\S]{0,900}goalieSpot\(/.test(anim), true);
  T('the drawn shot uses it', /Math\.max\(SHOT_TIP_GAP, goalieCaretGap\(L, ux, uy\)\)/.test(anim), true);
  T('…the stagger clusters on the same point', (anim.match(/Math\.max\(SHOT_TIP_GAP, goalieCaretGap\(L, ux, uy\)\)/g) || []).length >= 2, true);
  T('…and branch ghosts stand off too', /goalieCaretGap\(\{ x0: a\.x/.test(anim), true);

  const tim = src('timing.js');
  const save = tim.slice(tim.indexOf('} else if (goalie) {'), tim.indexOf('} else if (goalie) {') + 560);
  T('the save point reads the same solve', /goalieSpot\(/.test(save), true);
  T('…offset to the pad face', /GOALIE_FACE/.test(save), true);
}

/* ---- a manned net draws in two layers, keeper sandwiched ---- */
{
  const anim = src('hockey-drill-animator.jsx'), ico = src('icons.jsx');
  T('the icon can draw a net in parts', /part === "base"[\s\S]{0,200}part === "top"/.test(ico), true);
  T('…posts in the base, under the keeper', /part === "base" \? <g pointerEvents="none">\{ring\}\{crease\}\{posts\}/.test(ico), true);
  T('…crossbar and netting on top of them', /part === "top" \? <g pointerEvents="none">\{shell\}/.test(ico), true);
  T('an UNMANNED net still draws in one go', /\{ring\}\{crease\}\{shell\}\{posts\}/.test(ico), true);
  T('a manned net hands its top to the later pass', /part=\{!whiteboard && p\.kind === "net" && p\.goalie \? "base" : undefined\}/.test(anim), true);
  T('…which is ranked above the keeper', /p\.netTopOf \? 0\.6[\s\S]{0,60}p\.goalieOf \? 0\.5/.test(anim), true);
  T('…and skipped in whiteboard, which has no sprite to cover', /whiteboard \? \[\] : pieces[\s\S]{0,160}netTopOf/.test(anim), true);
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
