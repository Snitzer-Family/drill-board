// A rim is wall physics: the puck rides the boards and DIES ON THE WALL at
// the point nearest its collector — it never leaves the wall to meet them.
// The collect spot only chooses how far around the puck runs. These pin that
// for the unaimed rim (rimPath) and the aimed one (rimTo), including the
// drill that first showed the puck popping into the middle (rim=0:P2@3~-18).
import * as boards from '../src/boards.js';
import { parseDrill } from '../src/drill-format.js';
import { createTiming } from '../src/timing.js';

let pass = 0, fail = 0;
const T = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log((ok ? 'PASS' : 'FAIL').padEnd(5), name, ok ? '' : `→ got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

const last = pts => pts[pts.length - 1];
// every point past the release's entry chord hugs the boundary
const hugsWall = pts => pts.slice(1).every(p => boards.edgeDist(p.x, p.y) < 0.6);
// the end sits on the wall, at the boundary point nearest the collector
const diesNearest = (pts, to, tol = 3.5) => {
  const e = last(pts), proj = boards.project(to);
  return boards.edgeDist(e.x, e.y) < 0.6 && Math.hypot(e.x - proj.x, e.y - proj.y) < tol;
};

{ // unaimed rim: collectors at several offsets from several boards
  const cases = [
    ['top boards → mid collector', { x: 30, y: 6 }, { x: 120, y: 12 }],
    ['bottom boards → slot collector', { x: 170, y: 80 }, { x: 140, y: 68 }],
    ['left boards → wing collector', { x: 6, y: 20 }, { x: 15, y: 60 }],
  ];
  for (const [name, from, to] of cases) {
    const pts = boards.rimPath(from, to);
    T(`rimPath ${name}: never leaves the wall`, hugsWall(pts), true);
    T(`rimPath ${name}: dies at the wall nearest the collector`, diesNearest(pts, to), true);
    T(`rimPath ${name}: starts at the release`, pts[0], { x: from.x, y: from.y });
  }
}

{ // a collector standing essentially ON the boards: the rim reaches them
  const pts = boards.rimPath({ x: 30, y: 6 }, { x: 120, y: 2.6 });
  T('rimPath on-boards collector: dies beside them', diesNearest(pts, { x: 120, y: 2.6 }, 1), true);
}

{ // aimed rim on a straight wall
  const pts = boards.rimTo({ x: 150, y: 80 }, 0, { x: 185, y: 40 });
  T('rimTo: never leaves the wall', hugsWall(pts), true);
  T('rimTo: dies at the wall nearest the collector', diesNearest(pts, { x: 185, y: 40 }), true);
}

{ // THE drill that showed the pop into the middle: rim=0:P2@3~-18 with the
  // collect spot ~29ft off the right wall. The puck rims the top boards,
  // rounds the corner, and dies ON the right wall — the collect point never
  // bends it off the boards.
  const pts = boards.rimTo({ x: 122.7, y: 20.1 }, -18, { x: 168.8, y: 34.7 });
  T('corner drill: never leaves the wall', hugsWall(pts), true);
  T('corner drill: dies on the right wall beside the collect spot',
    diesNearest(pts, { x: 168.8, y: 34.7 }), true);
}

{ // a very short rim (release and collector close together) stays valid
  const pts = boards.rimPath({ x: 30, y: 6 }, { x: 44, y: 8 });
  T('short rim: still release → wall', pts.length >= 2 && hugsWall(pts), true);
}

{ // the stop is a friction GLIDE, not a brake: pucks are on ice, so the
  // collected rim shares the terminal rim's long ease — deceleration is
  // monotone over a real tail and ends at a crawl, through the actual planner
  const dsl = `DSL 10
RINK half
PIECE N1 net 189 42.5 #c81e33 face=180
PIECE P1 player 122.7 20.1 #d7263d P1
PATH P1 L 140,25 L 160,30
PIECE P2 player 120 60 #d7263d P2
PATH P2 L 145,55 L 160,45 L 168.8,34.7
PIECE PK1 puck 115 20 #14171a on=P1 rim=0:P2@3~-18`;
  const { pieces } = parseDrill(dsl);
  const t = createTiming({ pieces, pace: 1, segRefs: { current: {} },
    planCache: { current: { key: null, plans: {}, warp: {}, rel: {} } } });
  const flys = t.getPlan().plans.PK1.legs.filter(L => L.type === 'fly' && L.rim);
  const v = L => Math.hypot(L.x1 - L.x0, L.y1 - L.y0) / Math.max(1e-9, L.t1 - L.t0);
  const tail = flys.slice(-14).map(v);
  T('rim glide: tail decelerates monotonically', tail.every((s, i) => i === 0 || s <= tail[i - 1] + 0.01), true);
  T('rim glide: dies at a crawl, not a brake', v(flys[flys.length - 1]) < 0.25 * v(flys[0]), true);
  T('rim glide: the ramp spans a real tail (>8 slowing legs)',
    tail.filter((s, i) => i > 0 && s < tail[i - 1] - 0.01).length > 8, true);
  // real friction glide: v(rem) = v0·√(rem/d), so the first 40% of the run
  // barely slows (reads as coast) while the tail takes most of the time
  const head = flys.slice(0, Math.floor(flys.length * 0.4)).map(v);
  T('rim glide: near-coast head (first 40% loses <25% of launch speed)',
    head.every(s => s > head[0] * 0.75), true);
  // the energy equation: total glide time for a dying run is 2·d/v0 (constant
  // deceleration from exactly the speed this distance costs)
  const dist = flys.reduce((a, L) => a + Math.hypot(L.x1 - L.x0, L.y1 - L.y0), 0);
  const dur = flys[flys.length - 1].t1 - flys[0].t0;
  const ratio = dur / (2 * dist / v(flys[0]));
  T('rim glide: travel time matches the launch energy (≈2·d/v0)', ratio > 0.85 && ratio < 1.15, true, );
}

{ // Coulomb friction, both ends: v0 = √(2·μg·d), so a SHORT rim is launched
  // soft (the slow shot CAUSES the short rim) and a long one hard
  const rig = tgt => {
    const dsl = `DSL 10
RINK half
PIECE P1 player 150 10 #d7263d P1
PIECE P2 player ${tgt} #d7263d P2
PIECE PK1 puck 150 10 #14171a on=P1 rim=0:P2~0`;
    const { pieces } = parseDrill(dsl);
    const t = createTiming({ pieces, pace: 1, segRefs: { current: {} },
      planCache: { current: { key: null, plans: {}, warp: {}, rel: {} } } });
    const flys = t.getPlan().plans.PK1.legs.filter(L => L.type === 'fly' && L.rim);
    const L = flys[0];
    return { v0: Math.hypot(L.x1 - L.x0, L.y1 - L.y0) / (L.t1 - L.t0), t };
  };
  const short = rig('170 6'), long2 = rig('195 70');
  T('short rim launches soft, long rim launches hard', short.v0 < 0.75 * long2.v0, true);
}

{ // the display must not drag a wall-dying puck to its collector — the catch
  // nudge is blade-sized polish, and a routeless collector (ride leg directly
  // after the fly) is exactly the case that used to pull the puck 25ft+ off
  // the glass at the end of the run
  const dsl = `DSL 10
RINK half
PIECE P1 player 122.7 20.1 #d7263d P1
PIECE P2 player 168.8 34.7 #d7263d P2
PIECE PK1 puck 115 20 #14171a on=P1 rim=0:P2~-18`;
  const { pieces } = parseDrill(dsl);
  const t = createTiming({ pieces, pace: 1, segRefs: { current: {} },
    planCache: { current: { key: null, plans: {}, warp: {}, rel: {} } } });
  const plan = t.getPlan().plans.PK1;
  const flys = plan.legs.filter(L => L.type === 'fly' && L.rim);
  const lastF = flys[flys.length - 1];
  const pk = pieces.find(p => p.id === 'PK1');
  const offWall = [];
  for (const f of [0.9, 0.97, 0.995]) {
    const pos = t.displayPosAt(pk, lastF.t0 + (lastF.t1 - lastF.t0) * f);
    offWall.push(+boards.edgeDist(pos.x, pos.y).toFixed(1));
  }
  T('display keeps the dying puck on the wall (no pull to the collector)',
    offWall.every(d => d < 2.5), true, );
}

{ // board chips ride the SAME ice as rims: launch energy matched to the
  // travel (v0 ∝ √d — a harder chip for a farther pickup falls out of the
  // physics) and the whole run is the glide (duration ≈ 2·d/v0)
  const rig = x2 => {
    const dsl = `DSL 10
RINK half
PIECE P1 player 150 42 #d7263d P1
PIECE P2 player ${x2} 42 #d7263d P2
PIECE PK1 puck 150 42 #14171a on=P1 chip=0:P2~0`;
    const { pieces } = parseDrill(dsl);
    const t = createTiming({ pieces, pace: 1, segRefs: { current: {} },
      planCache: { current: { key: null, plans: {}, warp: {}, rel: {} } } });
    const flys = t.getPlan().plans.PK1.legs.filter(L => L.type === 'fly' && L.chip);
    const v = L => Math.hypot(L.x1 - L.x0, L.y1 - L.y0) / Math.max(1e-9, L.t1 - L.t0);
    const d = flys.reduce((a, L) => a + Math.hypot(L.x1 - L.x0, L.y1 - L.y0), 0);
    return { v0: v(flys[0]), d, dur: flys[flys.length - 1].t1 - flys[0].t0 };
  };
  const near = rig(170), far = rig(190);
  T('chip (no bank): energy matches distance (v0 ∝ √d)',
    Math.abs(near.v0 / far.v0 - Math.sqrt(near.d / far.d)) < 0.12, true);
  T('chip (no bank): travel time matches the launch energy (≈2·d/v0)',
    far.dur / (2 * far.d / far.v0) > 0.85 && far.dur / (2 * far.d / far.v0) < 1.15, true);
}

{ // a BANKED chip: hard and flat into the glass, the board absorbs its share
  // (OD.bounce — the same restitution missed shots keep), then the remainder
  // bleeds off on the shared ice. Aim straight up from mid-ice: contact at
  // the top wall, then back down past the start to the collector.
  const dsl = `DSL 10
RINK half
PIECE P1 player 150 20 #d7263d P1
PIECE P2 player 150 38 #d7263d P2
PIECE PK1 puck 150 20 #14171a on=P1 chip=0:P2~-90`;
  const { pieces } = parseDrill(dsl);
  const t = createTiming({ pieces, pace: 1, segRefs: { current: {} },
    planCache: { current: { key: null, plans: {}, warp: {}, rel: {} } } });
  const flys = t.getPlan().plans.PK1.legs.filter(L => L.type === 'fly' && L.chip);
  const v = L => Math.hypot(L.x1 - L.x0, L.y1 - L.y0) / Math.max(1e-9, L.t1 - L.t0);
  // the bank is the one leg boundary with a big speed drop
  let bank = -1;
  for (let k = 1; k < flys.length; k++) if (v(flys[k]) < v(flys[k - 1]) * 0.8) { bank = k; break; }
  T('banked chip: a contact exists (one sharp speed drop)', bank > 0, true);
  const head = flys.slice(0, bank).map(v);
  T('banked chip: hard and flat INTO the glass',
    head.every(s => Math.abs(s - head[0]) < head[0] * 0.02), true);
  const keep = v(flys[bank]) / v(flys[bank - 1]);
  T('banked chip: the board keeps ~the restitution share', keep > 0.5 && keep < 0.72, true);
  const tail = flys.slice(bank).map(v);
  T('banked chip: the rest bleeds off to a crawl', tail[tail.length - 1] < 0.3 * tail[0], true);
  const e = flys[flys.length - 1];
  T('banked chip: still dies at the collector', Math.hypot(e.x1 - 150, e.y1 - 38) < 1, true);
}

{ // a collect beyond stick reach does NOT collect: the puck rests on the wall
  // and the chain ends there — no snap, no teleport. Within reach, it works.
  const rig = lastWp => {
    const dsl = `DSL 10
RINK half
PIECE P1 player 122.7 20.1 #d7263d P1
PIECE P2 player 120 60 #d7263d P2
PATH P2 L 145,55 L 160,45 L ${lastWp}
PIECE PK1 puck 115 20 #14171a on=P1 rim=0:P2@3~-18`;
    const { pieces } = parseDrill(dsl);
    const t = createTiming({ pieces, pace: 1, segRefs: { current: {} },
      planCache: { current: { key: null, plans: {}, warp: {}, rel: {} } } });
    return t.getPlan().plans.PK1.legs;
  };
  const far = rig('168.8,34.7');               // ~29ft off the right wall
  T('far collect: never collected (no catch leg)', far.some(L => L.type === 'ride' && L.catch), false);
  T('far collect: the puck rests where it died', far[far.length - 1].type, 'rest');
  const near = rig('194,34.7');                // ~3.5ft off the wall — stick reach
  T('wall-side collect: still collected', near.some(L => L.type === 'ride' && L.catch), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
