// fitInside: the rule that a drawn shape is a RIGID body at the rink boundary.
// The boundary may MOVE a mark, it must never reshape it. This used to be a
// per-point clamp, which pinned the points that crossed the wall while the rest
// kept travelling — the shape squashed flat, and because the drag fed its own
// clamped output back in, the squash accumulated and committed to the drill.
// The rigidity test below is the one that would have caught that.
import { fitInside } from '../src/geometry.js';
import { RINK } from '../src/constants.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const R = v => Math.round(v * 1e6) / 1e6;

// a 20×10 rectangle-ish shape with a couple of interior points, at (x,y)
const shape = (x, y) => [
  { x, y }, { x: x + 20, y }, { x: x + 20, y: y + 10 }, { x, y: y + 10 }, { x: x + 7, y: y + 4 },
];
// every pairwise distance — invariant under translation, destroyed by a squash
const dists = pts => {
  const out = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++)
    out.push(R(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)));
  return out;
};
const inside = pts => pts.every(q => q.x >= -1e-9 && q.x <= RINK.W + 1e-9 && q.y >= -1e-9 && q.y <= RINK.H + 1e-9);

// ---- already inside: identity, so React state doesn't churn on every move ----
{
  const s = shape(50, 30);
  T('inside → returned by identity', fitInside(s) === s, true);
  T('flush against every edge is still inside', fitInside([{ x: 0, y: 0 }, { x: RINK.W, y: RINK.H }]).length, 2);
  T('empty/missing → passthrough', [fitInside([]).length, fitInside(null)], [0, null]);
}

// ---- rigidity: pushed past each edge and each corner, the shape is intact ----
for (const [name, x, y] of [
  ['left', -30, 40], ['right', RINK.W - 5, 40], ['top', 60, -25], ['bottom', 60, RINK.H - 3],
  ['top-left', -30, -25], ['top-right', RINK.W - 5, -25],
  ['bottom-left', -30, RINK.H - 3], ['bottom-right', RINK.W - 5, RINK.H - 3],
]) {
  const s = shape(x, y), out = fitInside(s);
  T(`${name}: shape preserved`, dists(out), dists(s));
  T(`${name}: ends up inside`, inside(out), true);
}

// ---- slide: the axes shift independently, so a shape hugs a wall and slides ----
{
  const s = shape(-30, 40), out = fitInside(s);
  T('past the left wall: x lands at 0', R(Math.min(...out.map(q => q.x))), 0);
  T('past the left wall: y is untouched', out.map(q => R(q.y)), s.map(q => R(q.y)));
  const b = shape(60, RINK.H - 3), ob = fitInside(b);
  T('past the bottom: y lands at H', R(Math.max(...ob.map(q => q.y))), RINK.H);
  T('past the bottom: x is untouched', ob.map(q => R(q.x)), b.map(q => R(q.x)));
}

// ---- bigger than the rink: centred, not pinned to one edge ----
{
  const s = [{ x: -50, y: -10 }, { x: RINK.W + 50, y: RINK.H + 40 }];
  const out = fitInside(s);
  T('oversized: still rigid', dists(out), dists(s));
  T('oversized: centred on x', R(out[0].x + out[1].x), RINK.W);
  T('oversized: centred on y', R(out[0].y + out[1].y), RINK.H);
}

// ---- per-point flags survive: sharp corners (c) and stylus pressure (p) ----
{
  const s = [{ x: -10, y: 5, c: true, p: 0.4 }, { x: 10, y: 25, p: 0.9 }];
  const out = fitInside(s);
  T('keeps the sharp-corner flag', [out[0].c, out[1].c], [true, undefined]);
  T('keeps stylus pressure', [out[0].p, out[1].p], [0.4, 0.9]);
  T('does not mutate the input', [s[0].x, s[0].y], [-10, 5]);
}

// ---- a drag is recoverable: derive from the grab snapshot, never from state ----
{
  const pts0 = shape(20, 40);                       // geometry at grab time
  const drag = (tx, ty) => fitInside(pts0.map(q => ({ ...q, x: q.x + tx, y: q.y + ty })));
  const jammed = drag(-50, 0);                      // shove 30ft past the left wall
  T('jammed into the wall: intact', dists(jammed), dists(pts0));
  T('jammed into the wall: resting on it', R(Math.min(...jammed.map(q => q.x))), 0);
  const back = drag(-15, 0);                        // ease back off it
  T('eased back: no drift, follows the pointer', back.map(q => R(q.x)), pts0.map(q => R(q.x - 15)));
  T('returned home is byte-identical', drag(0, 0).map(q => [R(q.x), R(q.y)]), pts0.map(q => [R(q.x), R(q.y)]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
