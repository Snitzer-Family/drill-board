// Taking a pass is played off the FACE of the blade. Two things follow, and neither is
// visible to a browser probe: in the fill view the icon renders through a
// stretch-cancelling matrix, so screen angles are a non-linear function of local ones
// and angle differences are not preserved. This drives the timing core directly.
//
//   1. the blade turns so its FACE meets the puck, rather than the toe being aimed
//      down the passing lane and the puck gluing onto the end of it
//   2. the puck lands mid-blade and only slides out to the toe as the catch settles
//
// Run: node tests/catch-face.mjs
import { createTiming } from '../src/timing.js';

let pass = 0, fail = 0;
const T = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ ${extra}`);
};
const wrap = d => ((d % 360) + 540) % 360 - 180;

// The blade as drawn in icons.jsx, and the rest angle of its face normal. Mirrors the
// constants in timing.js on purpose: if the drawn blade moves and timing is not
// updated with it, these fall out of agreement and this test says so.
const HEEL = { fwd: 4.2, lat: 2.6 }, TIP = { fwd: 5.6, lat: 2.45 };
const MID = { fwd: (HEEL.fwd + TIP.fwd) / 2, lat: (HEEL.lat + TIP.lat) / 2 };
const FACE_REST = Math.atan2(TIP.fwd - HEEL.fwd, HEEL.lat - TIP.lat) * 180 / Math.PI;

const P = (id, x, y, extra = {}) => ({ id, kind: 'player', x, y, path: [], facing: 0, speed: 1, ...extra });
const build = (ax, ay, rx, ry, hand) => {
  const pieces = [
    P('A1', ax, ay), P('R1', rx, ry, hand ? { hand } : {}),
    { id: 'PK1', kind: 'puck', x: ax - 2, y: ay, path: [], speed: 1, carrier: 'A1',
      transfers: [{ at: -1, to: 'R1', recvAt: null, kind: 'pass' }], terminals: [] },
  ];
  const t = createTiming({ pieces, pace: 12, segRefs: { current: {} }, planCache: { current: {} },
    seed: 1, realisticShots: false, detail: true, odds: {} });
  const legs = t.getPlan().plans.PK1.legs;
  const ci = legs.findIndex(l => l.type === 'ride' && l.catch);
  return { t, pieces, ride: legs[ci], fly: legs[ci - 1] };
};

// Where does the blade FACE point in the world, at time e?  heading + side·(rest + swing)
const faceWorld = (t, rec, ride, tau) => {
  const e = ride.t0 + tau;
  const a = t.displayPosAt(rec, e).a || 0;
  const side = rec.hand === 'L' ? -1 : 1;
  return a + side * (FACE_REST + t.stickSwing(rec.id, e));
};

const SCENES = [
  ['head-on', 60, 42.5, 120, 42.5, null],
  ['from the strong side', 60, 20, 100, 55, null],
  ['from the weak side', 60, 65, 100, 30, null],
  ['head-on, left shot', 60, 42.5, 120, 42.5, 'L'],
  ['diagonal, left shot', 60, 70, 105, 35, 'L'],
];

console.log('-- the face meets the puck --');
for (const [name, ax, ay, rx, ry, hand] of SCENES) {
  const { t, pieces, ride, fly } = build(ax, ay, rx, ry, hand);
  const rec = pieces.find(q => q.id === 'R1');
  // the bearing the puck arrives FROM
  const from = Math.atan2(fly.y0 - fly.y1, fly.x0 - fly.x1) * 180 / Math.PI;
  const off = Math.abs(wrap(faceWorld(t, rec, ride, 0) - from));
  const sp = t.stickSpot(rec.id, ride.t0);
  const side = rec.hand === 'L' ? -1 : 1;
  console.log(`      ${name}: face ${off.toFixed(0)}° off square, lever lat ${sp.lat.toFixed(2)} ` +
    `(+ = forehand), swing ${t.stickSwing(rec.id, ride.t0).toFixed(0)}°`);
  // NOT "square to the puck": the lever rotates WITH the stick, so a perfectly square
  // face (-84° head-on) carries the puck round to lat -3.7 — the weak side — and every
  // pass lands on the receiver's backhand. The requirement is the pair:
  T(`${name}: the puck arrives on the FOREHAND side`, sp.lat > 0.5, `lever lat ${sp.lat.toFixed(2)}`);
  T(`${name}: ...with the blade angled toward it, not toe-on`,
    Math.abs(wrap(t.stickSwing(rec.id, ride.t0))) > 8,
    `only ${Math.abs(t.stickSwing(rec.id, ride.t0)).toFixed(0)}° of turn`);
}

console.log('\n-- it lands on the face, then settles to the toe --');
{
  const { t, pieces, ride } = build(60, 42.5, 120, 42.5, null);
  const rec = pieces.find(q => q.id === 'R1');
  // the lever is unswung by stickSpot's own rotation, so compare its LENGTH along the
  // blade: mid-blade at the catch, out at the toe once settled
  const lenOf = tau => { const s = t.stickSpot(rec.id, ride.t0 + tau); return Math.hypot(s.fwd, s.lat); };
  const midLen = Math.hypot(MID.fwd, MID.lat), tipLen = Math.hypot(TIP.fwd, TIP.lat);
  const atCatch = lenOf(0), settled = lenOf(0.4);
  console.log(`      lever at the catch ${atCatch.toFixed(2)} (mid-blade ${midLen.toFixed(2)}), ` +
    `settled ${settled.toFixed(2)} (toe ${tipLen.toFixed(2)})`);
  T('the puck arrives on the blade mid-point, not the toe', Math.abs(atCatch - midLen) < 0.25,
    `${atCatch.toFixed(2)} vs mid ${midLen.toFixed(2)}`);
  T('...and has slid out to the toe once the catch settles', Math.abs(settled - tipLen) < 0.15,
    `${settled.toFixed(2)} vs toe ${tipLen.toFixed(2)}`);

  console.log('\n-- the cradle --');
  const s0 = t.stickSwing(rec.id, ride.t0);
  const give = t.stickSwing(rec.id, ride.t0 + 0.12);
  const after = t.stickSwing(rec.id, ride.t0 + 0.4);
  const before = t.stickSwing(rec.id, ride.t0 - 0.25);
  console.log(`      rest ${before.toFixed(1)}° → catch ${s0.toFixed(1)}° → give ${give.toFixed(1)}° → settled ${after.toFixed(1)}°`);
  T('the blade is at rest before the catch', Math.abs(before) < 1, `${before.toFixed(1)}°`);
  T('it gives WITH the puck on contact', Math.abs(give) > Math.abs(s0) + 2,
    `gave ${(Math.abs(give) - Math.abs(s0)).toFixed(1)}°`);
  T('...and recovers to the carry pose', Math.abs(after) < 3, `${after.toFixed(1)}°`);
}

// A puck that settled on the ice and is picked up is still gathered on the blade — but
// it has no approach to meet, so the blade must NOT turn to present a face to it.
// (I first asserted a collected puck rides the toe; that was my assumption, and wrong:
// you put the blade ON a loose puck. What distinguishes it from a pass is the turn.)
console.log('\n-- a loose puck has no direction to meet --');
{
  const pieces = [
    P('R1', 60, 42.5, { path: [{ type: 'L', x: 100, y: 42.5, mode: 'carry', dir: 'fwd', stop: 0, rate: 1 }] }),
    { id: 'PK1', kind: 'puck', x: 100, y: 42.5, path: [], speed: 1,
      pickup: { to: 'R1', at: 0 }, transfers: [], terminals: [] },
  ];
  const t = createTiming({ pieces, pace: 12, segRefs: { current: {} }, planCache: { current: {} },
    seed: 1, realisticShots: false, detail: true, odds: {} });
  const legs = t.getPlan().plans.PK1.legs;
  const ride = legs.find(l => l.type === 'ride');
  const sp = t.stickSpot('R1', ride.t0 + 0.02);
  const len = Math.hypot(sp.fwd, sp.lat);
  const midLen = Math.hypot(MID.fwd, MID.lat), tipLen = Math.hypot(TIP.fwd, TIP.lat);
  console.log(`      lever ${len.toFixed(2)} (blade runs ${midLen.toFixed(2)}..${tipLen.toFixed(2)}), ` +
    `swing ${t.stickSwing('R1', ride.t0 + 0.02).toFixed(1)}°`);
  T('a collected puck is still gathered on the blade', len >= midLen - 0.3 && len <= tipLen + 0.3,
    `lever ${len.toFixed(2)}`);
  T('...but the blade does not turn for a puck that is not moving',
    Math.abs(t.stickSwing('R1', ride.t0 + 0.02)) < 12, `${t.stickSwing('R1', ride.t0 + 0.02).toFixed(1)}°`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
